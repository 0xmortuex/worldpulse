/**
 * Why does clicking the flat-map toggle do nothing?
 *
 * Step 8c reports the toggle clicked and no flat map appearing. Step 1's
 * page-error assertion runs BEFORE that point, so an error thrown later —
 * during a click handler or a re-render — passes every check the suite makes
 * and then shows up as a missing element far away from its cause.
 *
 * This captures pageerror and console for the whole session, clicks the toggle,
 * and reports what actually happened. Rule 35: prove the mechanism.
 *
 *   npm run build && npx tsx scripts/diagnose-flat-toggle.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4321;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
  cwd: process.cwd(),
  shell: true,
  stdio: 'ignore',
});

await new Promise((resolve) => setTimeout(resolve, 6000));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

/*
 * Dismiss the first-run tour before measuring anything.
 *
 * On a fresh profile the tour opens itself and its scrim covers the page, so
 * every click reports "intercepts pointer events" — a true observation about
 * the tour and a useless one about the toggle. The verify suite reaches 8c
 * with the tour already dismissed, so this reproduces its state rather than a
 * first-run state.
 */
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => window.localStorage.setItem('worldpulse.tour.seen.v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

console.log('page errors after load:', pageErrors.length);
for (const error of pageErrors) console.log('  ', error.slice(0, 300));

/**
 * Did main.ts run to the end? Every mount below `mountDashboard` in main.ts
 * leaves a trace in the DOM, so their presence bounds where execution stopped.
 */
const wiring = await page.evaluate(() => ({
  dashLaunch: document.querySelector('#dash-launch') !== null,
  flatLaunch: document.querySelector('#flat-launch') !== null,
  flatmap: document.querySelector('#flatmap') !== null,
  dashHiddenAttr: document.querySelector('#dash')?.hasAttribute('hidden') ?? null,
  paletteHiddenAttr: document.querySelector('#palette')?.hasAttribute('hidden') ?? null,
}));
console.log('wiring:', JSON.stringify(wiring));

/*
 * REPRODUCE STEP 8c, including the part my earlier runs left out: it selects a
 * country before touching the toggle. The first version of this script clicked
 * the toggle with nothing selected AND after the 4s auto-switch had already
 * fired, so each click merely flipped a map that was already open — which is
 * why it read as "the listener never attached" when the listener was fine.
 */
await page.evaluate(() => {
  const el = document.querySelector('[data-select]');
  if (el instanceof HTMLElement) el.click();
});
await page.waitForTimeout(800);

const beforeToggle = await page.evaluate(() => ({
  flatmapHidden: document.querySelector('#flatmap')?.hasAttribute('hidden') ?? null,
  ariaPressed: document.querySelector('#flat-launch')?.getAttribute('aria-pressed') ?? null,
  selected: document.querySelectorAll('.flat-country--selected').length,
}));
console.log('before the toggle:', JSON.stringify(beforeToggle));

const errorsBefore = pageErrors.length;
await page.locator('#flat-launch').click();
await page.waitForTimeout(1200);
console.log('errors raised BY the click:', pageErrors.length - errorsBefore);
for (const error of pageErrors.slice(errorsBefore)) console.log('  CLICK-ERROR', error.slice(0, 400));

const after = await page.evaluate(() => ({
  flatSvg: document.querySelectorAll('.flat-svg').length,
  flatmapHidden: document.querySelector('#flatmap')?.hasAttribute('hidden') ?? null,
  ariaPressed: document.querySelector('#flat-launch')?.getAttribute('aria-pressed') ?? null,
}));
console.log('after clicking the toggle:', JSON.stringify(after));

console.log('page errors total:', pageErrors.length);
for (const error of pageErrors) console.log('  PAGEERROR', error.slice(0, 400));
console.log('console errors:', consoleErrors.length);
for (const error of consoleErrors.slice(0, 5)) console.log('  CONSOLE', error.slice(0, 300));

await browser.close();
preview.kill();
process.exit(0);
