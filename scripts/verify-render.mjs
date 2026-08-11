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

// Uncaught exceptions are always fatal. Resource-load failures are separated
// out because this build environment blocks all external hosts, so portrait
// images legitimately 403 here — the app is required to degrade gracefully, and
// that degradation is asserted directly further down rather than inferred from
// a silent console.
const pageErrors = [];
const resourceErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/Failed to load resource/i.test(text)) resourceErrors.push(text);
  else pageErrors.push(text);
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

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

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

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

// ---- step 2: confidence badges and the provenance inspector ----
//
// Per docs/TESTING.md rule 1, these assert on behaviour a broken component
// could not fake: the inspector must actually surface the request URL and raw
// body for the clicked fact.

await page.locator('.rail-reset').click();
await page.waitForTimeout(400);

const tiers = await page.locator('.gallery .badge').allTextContents();
check('gallery renders every badge state', tiers.length >= 6, tiers.join(' | '));
check('an untraceable value renders as broken', tiers.some((t) => t.includes('UNTRACEABLE')));
check('a key-gated source renders as unconfigured', tiers.some((t) => t.includes('KEY NOT SET')));
check(
  'OFFICIAL, ESTIMATE and DERIVED are all present and distinct',
  ['OFFICIAL', 'ESTIMATE', 'DERIVED'].every((tier) => tiers.some((t) => t.includes(tier))),
);

// Tier styling must differ, not just the text — the spec requires ESTIMATE and
// DERIVED to be unmistakable for OFFICIAL at a glance.
const styles = await page.evaluate(() =>
  ['official', 'estimate', 'derived', 'broken'].map((tier) => {
    const el = document.querySelector(`.badge--${tier}`);
    if (!el) return null;
    const s = getComputedStyle(el);
    return `${s.color}|${s.borderStyle}|${s.backgroundColor}`;
  }),
);
check('each tier is visually distinct', new Set(styles.filter(Boolean)).size === styles.filter(Boolean).length, styles.join(' // '));

// Open the inspector on the World Bank fixture badge.
await page.locator('.gallery .badge--official').first().click();
await page.waitForTimeout(400);
const inspectorVisible = await page.locator('.inspector-body').isVisible();
check('clicking a badge opens the provenance inspector', inspectorVisible);

const inspectorText = await page.locator('.inspector-body').innerText();
check('inspector shows the request URL', inspectorText.includes('api.worldbank.org'), '');
check('inspector shows the fetch timestamp', /Fetched at/.test(inspectorText));
check('inspector shows cache state', /hit|miss/i.test(inspectorText));
check('inspector shows the licence class', /CC BY 4\.0/.test(inspectorText) && /open/i.test(inspectorText));
check('inspector flags fixture-sourced data', /fixture/i.test(inspectorText));
check('inspector marks the source as documentation-verified', /documentation/i.test(inspectorText));

const rawShown = await page.locator('.inspector-raw pre').innerText();
check('inspector shows the raw response body', rawShown.includes('NY.GDP.MKTP.CD'), rawShown.slice(0, 60));

await page.screenshot({ path: `${SHOTS}/05-inspector.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes the inspector', !(await page.locator('.inspector-body').isVisible().catch(() => false)));
check(
  'Escape closing the inspector does not also clear the selection',
  (await page.locator('#mode').textContent())?.trim() === 'Relations mode',
);

// The broken state must be loud in the inspector too, not just the badge.
await page.locator('.gallery .badge--broken').first().click();
await page.waitForTimeout(400);
const alarm = await page.locator('.inspector-alarm').isVisible().catch(() => false);
check('untraceable value raises an alarm in the inspector', alarm);
await page.screenshot({ path: `${SHOTS}/06-broken.png` });
await page.keyboard.press('Escape');

// A derived fact must expose its arithmetic and walk down to its seed inputs.
await page.waitForTimeout(300);
await page.locator('.relation-list .badge').first().click();
await page.waitForTimeout(400);
const derivedText = await page.locator('.inspector-body').innerText().catch(() => '');
check('a derived fact shows its arithmetic', /Arithmetic/i.test(derivedText), derivedText.slice(0, 80));
check('a derived fact lists its inputs', /Inputs \(\d+\)/i.test(derivedText));
check('derived inputs resolve to seed citations', /Checked against/i.test(derivedText));
await page.screenshot({ path: `${SHOTS}/07-derived-provenance.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---- step 3: dossier header and leader resolution ----

async function selectCountry(name) {
  await page.locator('.search-input').fill(name);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

// Rule 2 — presidential, one portrait.
await selectCountry('United States');
const usHeader = await page.locator('.dossier').innerText();
check('dossier header renders vitals', /Capital/i.test(usHeader) && /Population/i.test(usHeader));
check('header states which resolution rule fired', /Rule 2/i.test(usHeader), usHeader.slice(0, 120));
check('presidential renders a single portrait', (await page.locator('.dossier .portrait').count()) === 1);
check('office title is shown verbatim', /President of the United States/.test(usHeader));
await page.screenshot({ path: `${SHOTS}/08-dossier-presidential.png` });

// Rule 3 — parliamentary, two portraits, head of government first.
await selectCountry('United Kingdom');
check('parliamentary renders two portraits', (await page.locator('.dossier .portrait').count()) === 2);
const roles = await page.locator('.dossier .portrait-role').allTextContents();
check('head of government leads a parliamentary system', /head of government/i.test(roles[0] ?? ''), roles.join(' | '));
check('the monarch is the labelled secondary', /monarch/i.test(roles[1] ?? ''), roles.join(' | '));
check('primary portrait frame is larger than the secondary', await page.evaluate(() => {
  const frames = [...document.querySelectorAll('.dossier .portrait-frame')].map((f) => f.getBoundingClientRect().width);
  return frames.length === 2 && frames[0] > frames[1];
}), JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll('.dossier .portrait-frame')].map((f) => Math.round(f.getBoundingClientRect().width)))));
await page.screenshot({ path: `${SHOTS}/09-dossier-dual-portrait.png` });

// Rule 1 — de facto authority, with the override citation on screen.
await selectCountry('Iran');
const iranHeader = await page.locator('.dossier').innerText();
check('de facto authority fires rule 1', /Rule 1/i.test(iranHeader), iranHeader.slice(0, 140));
check('override citation is shown', /Reviewed override/i.test(iranHeader));
check('the supreme authority leads, not the president', /Supreme authority/i.test((await page.locator('.dossier .portrait-role').first().innerText())));
await page.screenshot({ path: `${SHOTS}/10-dossier-de-facto.png` });

// Rule 5 — junta title is not normalised.
await selectCountry('Mali');
const maliHeader = await page.locator('.dossier').innerText();
check('transitional government fires rule 5', /Rule 5/i.test(maliHeader));
check('the literal junta title survives to the DOM', /Chairman, Transitional Military Council/.test(maliHeader));
check('the junta title is not smoothed to President', !/\bPresident\b/.test(maliHeader), maliHeader.slice(0, 160));
await page.screenshot({ path: `${SHOTS}/11-dossier-junta.png` });

// Missing P18 — initials placeholder, and never a substitute photograph.
await selectCountry('Canada');
check('a leader with no P18 falls back to an initials placeholder',
  (await page.locator('.dossier .portrait-frame--placeholder').count()) >= 1);
check('the placeholder carries no image element',
  (await page.locator('.dossier .portrait-img').count()) === 0);

// A portrait whose image cannot load must fall back to initials, not to a
// broken-image icon and not to a blank frame that reads as an unnamed person.
// Every external host is blocked here, so every Commons URL fails — which makes
// this environment an unusually good test of the degradation path.
await selectCountry('United States');
await page.waitForTimeout(600);
check('a portrait whose image fails to load degrades to initials',
  await page.evaluate(() => {
    const placeholder = document.querySelector('.dossier .portrait-frame--placeholder');
    if (!placeholder) return false;
    const img = document.querySelector('.dossier .portrait-img');
    return img === null && placeholder.textContent.trim().length > 0;
  }));
check('blocked portrait requests were actually observed', resourceErrors.length > 0,
  'expected the sandbox to block commons.wikimedia.org');

// A country with no dossier fixture must say so, not render an empty header.
await selectCountry('Japan');
check('a country with no dossier data says so', /No dossier data/i.test(await page.locator('.dossier').innerText()));

// Leader detail sheet.
await selectCountry('United States');
await page.locator('.dossier .portrait').first().click();
await page.waitForTimeout(400);
const sheet = await page.locator('.sheet-body').innerText();
check('clicking a portrait opens the leader sheet', (await page.locator('.sheet-body').isVisible()));
check('sheet shows the biography', /synthetic person/i.test(sheet));
check('sheet lists unbuilt sections as no data rather than hiding them',
  /Career timeline/i.test(sheet) && /No data/i.test(sheet));
await page.screenshot({ path: `${SHOTS}/12-leader-sheet.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes the leader sheet without clearing the selection',
  !(await page.locator('.sheet-body').isVisible().catch(() => false)) &&
    (await page.locator('#mode').textContent())?.trim() === 'Relations mode');

await browser.close();

console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
console.log(`screenshots in ${SHOTS}/`);
process.exit(failures.length === 0 ? 0 : 1);
