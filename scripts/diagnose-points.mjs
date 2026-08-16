/**
 * Does hovering a COUNTRY rebuild the event-marker layer?
 *
 * ## The report
 *
 * Three symptoms from a fresh clone on a 60fps machine: earthquake markers
 * unclickable while a country is selected, markers blinking, and hovering a
 * country visibly restarting the markers' animation.
 *
 * The third is the diagnostic gift. Hovering a country should not touch the
 * points layer at all, so if it restarts marker animations then the polygon
 * hover path is rebuilding `pointsData` wholesale — which would explain all
 * three at once: a layer mid-replacement is unclickable, and replacement
 * re-triggers globe.gl's point transition, which is both the blink and the
 * animation restart.
 *
 * This measures the claim rather than assuming it (rule 35): it counts
 * `pointsData` re-assignments across a load, a selection, and a series of
 * hover moves.
 *
 *   npm run build && npx tsx scripts/diagnose-points.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4319;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
  cwd: process.cwd(),
  shell: true,
  stdio: 'ignore',
});

await new Promise((resolve) => setTimeout(resolve, 6000));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const read = () => page.evaluate(() => window.__worldpulse?.pointsAssignments() ?? -1);

const afterLoad = await read();
console.log('after load:              ', afterLoad);

await page.evaluate(() => {
  const el = document.querySelector('[data-select]');
  if (el instanceof HTMLElement) el.click();
});
await page.waitForTimeout(900);
const afterSelect = await read();
console.log('after selecting a country:', afterSelect);

const box = await page.locator('#globe').boundingBox();
for (let i = 0; i < 8; i += 1) {
  await page.mouse.move(box.x + box.width / 2 + i * 14, box.y + box.height / 2 + i * 9);
  await page.waitForTimeout(140);
}
const afterHover = await read();
console.log('after 8 hover moves:     ', afterHover);

console.log('');
console.log(`selecting cost ${afterSelect - afterLoad} re-assignment(s)`);
console.log(`hovering  cost ${afterHover - afterSelect} re-assignment(s)`);
console.log('');
console.log(
  afterHover > afterSelect
    ? 'CONFIRMED — hovering a country rebuilds the points layer.'
    : 'NOT REPRODUCED by this path — the mechanism is elsewhere.',
);

await browser.close();
preview.kill();
process.exit(0);
