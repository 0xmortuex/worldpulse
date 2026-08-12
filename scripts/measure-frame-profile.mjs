#!/usr/bin/env node
/**
 * Measure this machine's frame profile and the step-7 marker-click flake rate.
 *
 * Why this is a committed tool rather than a one-off script: a flake rate is a
 * property of a machine, not of a check. TESTING.md rule 15 recorded "about one
 * run in three" from a box rendering ~2100ms per frame, and that number tells
 * the next reader nothing unless they can measure their own. Recording a rate
 * without the profile it was measured on is recording a number that cannot be
 * compared with anything.
 *
 * Three configurations, run against the same page:
 *
 *   shipped   the harness sequence verbatim, including the 3-attempt retry.
 *             This is the rate a `npm run verify` run actually experiences.
 *   single    one attempt, no retry. This is the underlying race, and the
 *             number the retry loop is hiding.
 *   cleared   one attempt, but the pointer must be observed to have LEFT the
 *             marker — the tooltip gone — before it is moved back on. Tests
 *             whether a stale tooltip is what makes the hover wait vacuous.
 *
 * Usage:
 *   node scripts/measure-frame-profile.mjs [trials] [baseUrl]
 *   MODES=shipped,single,cleared  which configurations to run
 *
 * Needs a preview server on :4173 and Chromium; PLAYWRIGHT_CHROMIUM_PATH points
 * at an out-of-band build.
 */
import { chromium } from 'playwright';

const TRIALS = Number(process.argv[2] ?? 15);
const BASE = process.argv[3] ?? 'http://localhost:4173';
const MODES = (process.env.MODES ?? 'shipped,single,cleared').split(',');
const HARDWARE = process.env.WORLDPULSE_HARDWARE_GL === '1';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // Match verify-render.mjs exactly. A profile measured under a different
  // rasteriser describes a different machine.
  args: HARDWARE ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(90_000);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.locator('.search-input').fill('United States');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);

const eventId = await page.evaluate(() => window.__worldpulse.frontFacingClusterId());
if (!eventId) {
  console.error('no front-facing cluster to aim at; cannot measure');
  await browser.close();
  process.exit(1);
}

async function frameDeltas(frames) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const deltas = [];
        let last = performance.now();
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          if (deltas.length < n) requestAnimationFrame(tick);
          else resolve(deltas);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    median: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    fps: +(1000 / at(0.5)).toFixed(1),
  };
}

async function waitFor(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(120);
  }
}

const tooltipId = () =>
  page.evaluate(() => document.querySelector('.evt')?.getAttribute('data-event-id') ?? null);

/**
 * The harness's own pickEvent, unchanged, plus `requireCleared`.
 *
 * requireCleared is the only difference between the `single` and `cleared`
 * configurations: it waits for the tooltip to disappear after parking the
 * pointer, so the subsequent wait-for-tooltip is observing a NEW hover rather
 * than being satisfied instantly by the one still on screen.
 */
async function pickEvent(id, { focus = true, requireCleared = false } = {}) {
  if (focus) {
    await page.evaluate((eid) => window.__worldpulse.focusCluster(eid), id);
    await page.waitForTimeout(500);
  }
  await page.mouse.move(10, 10);
  if (requireCleared) {
    const cleared = await waitFor(() => document.querySelector('.evt') === null, 8000);
    if (!cleared) return { aimed: false, id: null, cleared: false };
  } else {
    await page.waitForTimeout(150);
  }
  const target = await page.evaluate((eid) => window.__worldpulse.screenCoordsOf(eid), id);
  if (!target) return { aimed: false, id: null };
  await page.mouse.move(target.x, target.y);
  await waitFor(() => document.querySelector('.evt') !== null, 5000);
  return { aimed: true, id: await tooltipId(), cleared: true, x: target.x, y: target.y };
}

/** Reproduce the state the check is in when it clicks. */
async function preamble() {
  await pickEvent(eventId);
  await page.evaluate((id) => window.__worldpulse.focusCluster(id, 14, 14), eventId);
  await page.waitForTimeout(600);
  await page.evaluate((id) => {
    const found = window.__worldpulse.eventById(id);
    window.__wpTargetLat = found?.lat ?? NaN;
    window.__wpTargetLng = found?.lng ?? NaN;
  }, eventId);
}

const arrived = () =>
  waitFor(() => {
    const pov = window.__worldpulse.pointOfView();
    return (
      Math.abs(pov.lat - window.__wpTargetLat) < 1.5 && Math.abs(pov.lng - window.__wpTargetLng) < 1.5
    );
  }, 5000);

async function clickAttempt({ requireCleared }) {
  await page.mouse.move(10, 10);
  if (!requireCleared) await page.waitForTimeout(250);
  const repick = await pickEvent(eventId, { focus: false, requireCleared });
  if (repick.id !== eventId) return { outcome: 'hover-missed', got: repick.id };
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  return { outcome: (await arrived()) ? 'arrived' : 'click-dropped' };
}

async function runMode(mode) {
  const maxAttempts = mode === 'shipped' ? 3 : 1;
  const requireCleared = mode === 'cleared';
  const trials = [];

  for (let trial = 1; trial <= TRIALS; trial += 1) {
    await preamble();
    const log = [];
    let ok = false;
    while (log.length < maxAttempts && !ok) {
      const attempt = await clickAttempt({ requireCleared });
      log.push(attempt.outcome);
      ok = attempt.outcome === 'arrived';
    }
    trials.push({ ok, attempts: log.length, log });
    process.stdout.write(`  ${mode} trial ${trial}: ${ok ? 'PASS' : 'FAIL'} (${log.join(',')})\n`);
  }

  const passed = trials.filter((t) => t.ok).length;
  const firstOk = trials.filter((t) => t.log[0] === 'arrived').length;
  const outcomes = trials.flatMap((t) => t.log);
  return {
    mode,
    passed,
    trials: TRIALS,
    firstOk,
    hoverMissed: outcomes.filter((o) => o === 'hover-missed').length,
    clickDropped: outcomes.filter((o) => o === 'click-dropped').length,
  };
}

console.log(`gl: ${HARDWARE ? 'hardware' : 'swiftshader'}   trials per mode: ${TRIALS}`);

const idle = stats(await frameDeltas(120));
await page.evaluate((id) => window.__worldpulse.focusCluster(id), eventId);
const busy = stats(await frameDeltas(120));
console.log(`frame profile — idle:  ${JSON.stringify(idle)}`);
console.log(`frame profile — flyTo: ${JSON.stringify(busy)}`);

const results = [];
for (const mode of MODES) results.push(await runMode(mode.trim()));

console.log('\n=== summary ===');
console.log(`gl ${HARDWARE ? 'hardware' : 'swiftshader'} · idle ${idle.median}ms/frame (${idle.fps}fps) · flyTo ${busy.median}ms/frame`);
console.log('| mode | passed | failure rate | first attempt | hover-missed | click-dropped |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  const rate = (((r.trials - r.passed) / r.trials) * 100).toFixed(0);
  console.log(
    `| ${r.mode} | ${r.passed}/${r.trials} | ${rate}% | ${r.firstOk}/${r.trials} | ${r.hoverMissed} | ${r.clickDropped} |`,
  );
}

await browser.close();
