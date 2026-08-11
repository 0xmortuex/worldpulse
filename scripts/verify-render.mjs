/**
 * Loads the built app in Chromium and asserts the step-1 interaction actually
 * works: globe renders, default selection lands on the USA, relations mode
 * classifies, multi-select opens compare, and the weight sliders recolour.
 *
 * Usage: node scripts/verify-render.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = 'artifacts';

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

// This environment ships Chromium out of band; PLAYWRIGHT_CHROMIUM_PATH points
// at it so the npm package's pinned build number does not have to match.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // Software rasterise: there is no GPU here, and without this the globe
  // renders as an empty canvas and every check below passes vacuously.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await mkdir(SHOTS, { recursive: true });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log('\nstep 1 render checks');

// Globe actually drew something, rather than failing silently to a black box.
const canvasPixels = await page.evaluate(() => {
  const canvas = document.querySelector('#globe canvas');
  if (!canvas) return null;
  return { width: canvas.width, height: canvas.height };
});
check('globe canvas present and sized', canvasPixels !== null && canvasPixels.width > 100, JSON.stringify(canvasPixels));

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const seedVisible = await page.locator('#seed-banner strong').first().isVisible();
check('seed-data banner is visible', seedVisible);

const mode = await page.locator('#mode').textContent();
check('opens in relations mode', mode?.trim() === 'Relations mode', `got "${mode}"`);

const heading = await page.locator('#panel h2').first().textContent();
check('default selection is the United States', /United States/.test(heading ?? ''), `got "${heading}"`);

// Tier counts must be populated, and no-data must dominate — the seed set is
// partial and the UI is supposed to make that obvious.
const counts = await page.locator('.tier-count-n').allTextContents();
check('tier counts rendered', counts.length === 5, counts.join(','));
const [allies, , , , nodata] = counts.map(Number);
check('USA has allies from the seed set', allies > 20, `allies=${allies}`);
check('most countries read as no data', nodata > 100, `nodata=${nodata}`);

await page.screenshot({ path: `${SHOTS}/01-relations-usa.png` });

// Hovering the globe must raise a tooltip. This is the only check that proves
// country polygons actually rendered: a bare sphere with no polygons still
// produces a correctly sized canvas, so pixel dimensions alone prove nothing.
const box = await page.locator('#globe canvas').boundingBox();
let tooltipSeen = false;
for (const [dx, dy] of [[0, 0], [-0.12, 0.05], [0.1, -0.08], [0.05, 0.15]]) {
  await page.mouse.move(box.x + box.width * (0.5 + dx), box.y + box.height * (0.5 + dy));
  await page.waitForTimeout(400);
  if (await page.locator('.pop-title').first().isVisible().catch(() => false)) {
    tooltipSeen = true;
    break;
  }
}
check('hovering the globe hits a country polygon', tooltipSeen);
if (tooltipSeen) await page.screenshot({ path: `${SHOTS}/04-traceability-popover.png` });

// Select a second country by keyboard, which doubles as the no-pointer path.
await page.locator('.search-input').fill('China');
await page.waitForTimeout(250);
await page.keyboard.down('Control');
await page.keyboard.press('Enter');
await page.keyboard.up('Control');
await page.waitForTimeout(600);

const compareMode = await page.locator('#mode').textContent();
check('ctrl-click adds a country and opens compare', /Compare mode · 2/.test(compareMode ?? ''), `got "${compareMode}"`);
const compareRows = await page.locator('table.compare tbody tr').count();
check('compare table renders a row per tier', compareRows === 5, `rows=${compareRows}`);

await page.screenshot({ path: `${SHOTS}/02-compare.png` });

// Back to single selection, then prove the sliders actually recolour.
await page.locator('.search-input').fill('United States');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('plain selection replaces rather than adds', (await page.locator('#mode').textContent())?.trim() === 'Relations mode');

const before = await page.locator('.tier-count-n').allTextContents();
const slider = page.locator('input[name="sharedDefenseBloc"]');
await slider.fill('-8');
await slider.dispatchEvent('input');
await page.waitForTimeout(600);
const after = await page.locator('.tier-count-n').allTextContents();
check('weight slider changes the classification', before.join() !== after.join(), `${before.join()} -> ${after.join()}`);

await page.screenshot({ path: `${SHOTS}/03-weights-inverted.png` });

await browser.close();

console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
console.log(`screenshots in ${SHOTS}/`);
process.exit(failures.length === 0 ? 0 : 1);
