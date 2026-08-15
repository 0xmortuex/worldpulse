/**
 * Loads the built app in Chromium and asserts the step-1 interaction actually
 * works: globe renders, default selection lands on the USA, relations mode
 * classifies, multi-select opens compare, and the weight sliders recolour.
 *
 * Usage: node scripts/verify-render.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findChromiumCandidates, resolveChromium } from './chromium-path.mjs';
import { freshnessProblem, readBranchState } from './branch-freshness.mjs';
import { acquireRunLock } from './run-lock.mjs';
import { describeRenderer, glArgs, isSoftwareRenderer } from './gl-config.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { layoutProblems } from './layout-rules.mjs';

/**
 * What Playwright would launch if left to itself. It throws rather than
 * returning when no browser is registered for this platform, and that is a
 * "cannot answer", not a path — see rule 30.
 */
function pinnedChromiumPath() {
  try {
    return chromium.executablePath();
  } catch {
    return null;
  }
}

/**
 * The base URL is the first POSITIONAL argument, not `argv[2]`.
 *
 * It was `argv[2]` until `--only` was added, at which point `--only` itself
 * became the base URL and the run died with "Cannot navigate to invalid URL" —
 * a failure that named the symptom and not the cause. Flags and their values are
 * skipped explicitly so adding another one cannot repeat it.
 */
const BASE = (() => {
  const rest = process.argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--only') {
      i += 1; // its value, not a base URL
      continue;
    }
    if (arg.startsWith('--')) continue;
    return arg;
  }
  return 'http://localhost:4173';
})();
const SHOTS = 'artifacts';

/**
 * Refuse to verify a bundle older than the source it claims to verify.
 *
 * The harness talks to whatever is already serving :4173, and a preview server
 * started hours ago happily serves a stale `dist/` forever. Every check below
 * then passes against code that is not the code in the working tree — which is
 * indistinguishable from having verified the change, and is how a rendering
 * regression ships green. This is the harness's own version of TESTING.md rule 1:
 * the checks must be about the thing that actually ran.
 */
async function newestMtime(dir, skip = new Set()) {
  let newest = 0;
  const walk = async (path) => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else newest = Math.max(newest, (await stat(full)).mtimeMs);
    }
  };
  await walk(dir);
  return newest;
}

async function assertBundleIsCurrent() {
  const root = resolve(import.meta.dirname, '..');
  let builtAt;
  try {
    builtAt = (await stat(join(root, 'dist/index.html'))).mtimeMs;
  } catch {
    console.error('no dist/ to verify — run `npm run build` first');
    process.exit(1);
  }

  const sources = Math.max(
    await newestMtime(join(root, 'src')),
    await newestMtime(join(root, 'data')),
    await newestMtime(join(root, 'tests/fixtures')),
    (await stat(join(root, 'index.html'))).mtimeMs,
  );

  if (sources > builtAt) {
    console.error(
      'STALE BUNDLE: dist/ is older than the sources it was built from.\n' +
        `  built  ${new Date(builtAt).toISOString()}\n` +
        `  source ${new Date(sources).toISOString()}\n` +
        'Every check would run against code that is not in the working tree. ' +
        'Rebuild (`npm run build`) and restart the preview server.',
    );
    process.exit(1);
  }
}

/**
 * The branch must be what origin says it is, asserted before anything is
 * measured — the sibling of the stale-bundle check directly above.
 *
 * Both answer the same question: is the thing under test the thing the report
 * will name? A stale `dist/` and a stale checkout are the same failure at
 * different distances, and the second is quieter, because a clean tree that
 * builds gives no sign it is two commits behind the branch.
 */
async function assertBranchIsCurrent() {
  const state = await readBranchState(async (args) => {
    const { stdout } = await execFileAsync('git', args, { cwd: resolve(import.meta.dirname, '..') });
    return stdout;
  });
  const problem = freshnessProblem(state);
  if (problem === null) return;
  console.error(`\nBRANCH IS NOT WHAT ORIGIN SAYS IT IS:\n\n  ${problem}\n`);
  process.exit(1);
}

if (/localhost|127\.0\.0\.1/.test(BASE)) {
  await assertBranchIsCurrent();
  await assertBundleIsCurrent();
}

/**
 * Screenshots are evidence for a human, not assertions.
 *
 * Under software rasterisation each capture of a WebGL canvas costs seconds and
 * there are two dozen of them. Skipping them changes no verdict — which is
 * exactly why it is safe to skip, and exactly why a screenshot can never
 * substitute for a check.
 */
const SKIP_SHOTS = process.env['WORLDPULSE_SKIP_SHOTS'] === '1';
async function shot(page, path) {
  if (SKIP_SHOTS) return;
  await page.screenshot({ path });
}

/** Poll until a condition holds, so timing-sensitive checks are not flaky. */
async function waitFor(page, fn, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(150);
  }
}

/**
 * Wait until a subtree stops changing, measured in ANIMATION FRAMES.
 *
 * Rule 15 says waits in this harness must be conditions, never durations, and
 * `selectCountry` was still parking for 250ms and 500ms. On the sandbox those
 * were several frames; on a 750ms/frame box they are each under one, so the
 * function returned while the dossier was still rebuilding.
 *
 * What that costs is not a slow test — it is a FLAKY one. Re-selecting a country
 * replaces the tab strip: measured, 18 mutations and 2 replacements of
 * `[data-tab="economy"]` in the 3s after a scenario switch. Playwright resolves
 * the locator, waits for the element to be stable, the node is swapped underneath
 * it, and it retries — until 15s runs out and reports `locator.click: Timeout`.
 * The element was never unclickable; it kept being a different element.
 *
 * Frames rather than milliseconds because the thing being waited for is renders,
 * and a machine that renders slowly needs to wait longer for the same number of
 * them. This is the same reason the frame profile is recorded per configuration.
 */
/**
 * THE BUDGET IS IN FRAMES, NOT MILLISECONDS, AND THAT IS THE POINT.
 *
 * Both waits here poll on `requestAnimationFrame`, so their cost is measured in
 * renders. Budgeting them in wall-clock reintroduces the exact error the fixed
 * durations had: this machine's frame period is 750ms at the median and spikes
 * past 2400ms under the suite's own load, so a 10s budget is anywhere between
 * four frames and thirteen. `waitForStableNode` was timing out at its edge —
 * four frames at 2.4s is 9.6s against a 10s budget — and then clicking anyway.
 *
 * `maxFrames` is the real budget. `hardStopMs` exists only so a page whose rAF
 * has stopped entirely cannot hang the suite; it is not a deadline anything is
 * expected to reach.
 */
async function waitForDomQuiet(page, selector, { quietFrames = 3, maxFrames = 300, hardStopMs = 15_000 } = {}) {
  return page.evaluate(
    ({ sel, frames, budget, hardStop }) =>
      new Promise((resolve) => {
        /**
         * NO FALLBACK TO document.body — that was a bug, and an expensive one.
         *
         * An earlier version observed `body` when the selector was absent. The
         * globe rewrites its tooltip container continuously, so `body` never
         * goes quiet: every call burned its full timeout, the suite slowed by
         * 270s, and step 7 went from one failure to five because the globe had
         * moved on by the time anything clicked.
         *
         * A missing subtree is not a busy one. There is nothing to wait for, so
         * this returns immediately and lets the caller's own assertions speak.
         *
         * WHICH MAKES QUIESCENCE THE WRONG INSTRUMENT FOR AN ELEMENT THAT DOES
         * NOT EXIST YET. "Absent" quiets instantly, so waiting for a list that
         * has not rendered waits for nothing at all. Use `waitFor` on content —
         * as `selectCountry` does for `.search-results` having children — when
         * the question is "has it appeared", and this only when the question is
         * "has it stopped changing".
         *
         * AND THE TARGET MUST SURVIVE THE RE-RENDER. A detached node never
         * mutates again, so observing one that gets replaced reports "quiet"
         * immediately while the page churns on — failing by succeeding, which no
         * timeout catches. Pass the persistent container (`#panel`), never a
         * child that `innerHTML =` throws away (`.dossier`).
         */
        const target = document.querySelector(sel);
        if (target === null) {
          resolve(true);
          return;
        }
        let dirty = true;
        const observer = new MutationObserver(() => {
          dirty = true;
        });
        observer.observe(target, { childList: true, subtree: true, attributes: true });

        const started = performance.now();
        let quiet = 0;
        let seen = 0;
        const tick = () => {
          seen += 1;
          if (dirty) {
            quiet = 0;
            dirty = false;
          } else {
            quiet += 1;
          }
          if (quiet >= frames) {
            observer.disconnect();
            resolve(true);
            return;
          }
          if (seen >= budget || performance.now() - started > hardStop) {
            observer.disconnect();
            resolve(false);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { sel: selector, frames: quietFrames, budget: maxFrames, hardStop: hardStopMs },
  );
}

/**
 * Poll until `fn` returns non-null, and return THAT value.
 *
 * `waitFor` answers 'did it happen'. A caller that then re-reads the DOM to learn
 * WHAT happened has opened a gap, and anything the page rewrites in between falls
 * into it. Returning the value the passing evaluation itself saw closes the gap.
 */
async function waitForValue(page, fn, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await page.evaluate(fn);
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(60);
  }
}

const failures = [];

/**
 * Which step each check belongs to.
 *
 * Attribution comes from the runner rather than from someone reading the script
 * and counting: a per-step total that is maintained by hand is a number that
 * drifts, and the whole point of this report is to say precisely which step's
 * assertions ran.
 */
/**
 * `--only <substring>`: run up to and including the matching step, then stop.
 *
 * ## What this flag does NOT do, said plainly
 *
 * It does not run one step in isolation, and it cannot. The steps share one
 * browser and one page: step 4 asserts against a dossier that step 1 navigated
 * to, and step 7's markers exist because earlier steps selected a country.
 * Running step 4 alone would mean re-deriving its preconditions, which is a
 * restructure of the whole script rather than a flag.
 *
 * So this is "stop after", not "only" — and it is named `--only` because that is
 * the name S4 and the goal document use. **The doc is here rather than in a
 * commit message because a flag whose name overstates what it does will be
 * misread by whoever reads the name first.**
 *
 * ## Why it is still worth having
 *
 * The cost being avoided is everything AFTER the step under test, which for step
 * 1 is nine tenths of the run. Regenerating three per-step tables this session
 * meant three whole verifies to read three tables.
 *
 * The report says so: a run stopped early lists the steps that never ran as
 * skipped, and exits non-zero, because a partial run that exits green is exactly
 * the "a check that did not run must not look like one that passed" failure this
 * harness already refuses everywhere else.
 */
const ONLY = (() => {
  const index = process.argv.indexOf('--only');
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error('--only needs a step substring, e.g. --only "2 —" or --only economy');
    process.exit(1);
  }
  return value;
})();

let currentStep = 'harness';
const steps = [];
let stoppedEarly = false;

function step(name) {
  /**
   * Stop BEFORE starting the step after the requested one, so the requested
   * step is complete when the run ends.
   */
  if (ONLY !== null && stoppedEarly) return;
  if (ONLY !== null && currentStep !== 'harness' && currentStep.includes(ONLY)) {
    stoppedEarly = true;
    console.log(`\n--only "${ONLY}": stopping after ${currentStep}`);
    report(null);
    return;
  }
  currentStep = name;
  steps.push({ name, ok: 0, failed: 0, skipped: [] });
}
function currentBucket() {
  return steps.find((entry) => entry.name === currentStep);
}

function check(label, condition, detail = '') {
  const bucket = currentBucket();
  if (condition) {
    console.log(`  ok   ${label}`);
    if (bucket) bucket.ok += 1;
  } else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(`[${currentStep}] ${label}`);
    if (bucket) bucket.failed += 1;
  }
}

/**
 * Withdraw the most recent failure, for probes whose failing IS the result.
 *
 * The layout self-test deliberately breaks the page to prove the geometry
 * harness can detect an overlap. Its failure was already removed from the
 * failure list; without removing it from the step tally too, the report shows a
 * permanent phantom failure against layout geometry and a reader stops trusting
 * the column.
 */
function unfail() {
  failures.pop();
  const bucket = currentBucket();
  if (bucket) bucket.failed -= 1;
}

/**
 * A check that did not run.
 *
 * Several assertions sit behind an `if` — the camera checks only run if a marker
 * was picked, the occlusion pick only if a back-facing marker exists. When the
 * guard is false those checks silently vanish and the suite still prints "all
 * checks passed", which is the stale-bundle failure in miniature: a green result
 * that covers less than it claims. Recording them means a skip is visible in the
 * report, and a skip exits non-zero.
 */
function skipped(label, why) {
  console.log(`  SKIP ${label} — ${why}`);
  const bucket = currentBucket();
  if (bucket) bucket.skipped.push(`${label} (${why})`);
}

/**
 * Print the per-step table and exit.
 *
 * Printed on EVERY exit path, including a crash. This script is one long linear
 * sequence, so an exception anywhere — a click that times out because some
 * element now covers its target — used to kill the process with a stack trace
 * and nothing else: no table, no failure line, no indication of how much of the
 * suite had actually run. A run that stops after step 2 and says nothing is
 * indistinguishable from a run that never started.
 *
 * On a crash the aborting step is recorded as a failure and every step after it
 * is reported as never having run, so the output says what was and was not
 * covered rather than leaving the reader to guess from a stack trace.
 */
function report(abortError) {
  /**
   * A run stopped by `--only` names every step it did not reach, exactly as an
   * aborted run does. The two are different events with the same obligation:
   * a step that never ran must not be silently absent from the table, or the
   * report reads as full coverage.
   */
  if (stoppedEarly) {
    const reached = ALL_STEPS.indexOf(currentStep);
    for (const entry of ALL_STEPS.slice(reached + 1)) {
      if (!steps.some((started) => started.name === entry)) {
        steps.push({ name: entry, ok: 0, failed: 0, skipped: [`entire step — --only "${ONLY}" stopped the run first`] });
      }
    }
  }

  if (abortError) {
    const bucket = currentBucket();
    const label = `${currentStep} aborted: ${String(abortError.message ?? abortError).split('\n')[0].slice(0, 120)}`;
    console.log(`  FAIL ${label}`);
    failures.push(`[${currentStep}] ${label}`);
    if (bucket) bucket.failed += 1;
    // Steps that never started cannot have passed. Naming them is the whole
    // point: silence about them is what made an early crash unreadable.
    const reached = steps.findIndex((entry) => entry.name === currentStep);
    for (const entry of ALL_STEPS.slice(reached + 1)) {
      if (!steps.some((started) => started.name === entry)) {
        steps.push({ name: entry, ok: 0, failed: 0, skipped: ['entire step — the run aborted before reaching it'] });
      }
    }
  }

  const nameWidth = Math.max(...steps.map((entry) => entry.name.length), 4);
  console.log('\nper-step results');
  console.log(`  ${'step'.padEnd(nameWidth)}  assert  pass  fail  skipped`);
  for (const entry of steps) {
    const stepTotal = entry.ok + entry.failed;
    console.log(
      `  ${entry.name.padEnd(nameWidth)}  ${String(stepTotal).padStart(6)}  ${String(entry.ok).padStart(4)}  ` +
        `${String(entry.failed).padStart(4)}  ${entry.skipped.length === 0 ? '-' : entry.skipped.length}`,
    );
  }
  const allSkipped = steps.flatMap((entry) => entry.skipped.map((label) => `[${entry.name}] ${label}`));
  if (allSkipped.length > 0) {
    console.log('\nchecks that did NOT run:');
    for (const label of allSkipped) console.log(`  - ${label}`);
  }
  const total = steps.reduce((sum, entry) => sum + entry.ok + entry.failed, 0);
  console.log(`\n  ${total} assertions across ${steps.length} steps, ${allSkipped.length} skipped`);

  console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
  console.log(`screenshots in ${SHOTS}/`);
  // A skipped check is not a pass. Exiting green with assertions that never ran
  // is precisely the class of lie this audit exists to remove.
  process.exit(failures.length === 0 && allSkipped.length === 0 ? 0 : 1);
}

/** Declared up front so a crash can name the steps that never ran. */
const ALL_STEPS = [
  '1 — globe, selection, relations',
  '2 — confidence badges, provenance inspector',
  '3 — dossier header, leader resolution',
  '4 — government tab',
  '5 — economy tab',
  '6 — news tab',
  '7 — globe event layers',
  '7b — economy fetch states',
  'cross-cutting — text fidelity (rule 9)',
  'cross-cutting — layout geometry (rule 8)',
];

for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    console.error(`\n${event}: ${String(error?.stack ?? error).slice(0, 600)}`);
    report(error instanceof Error ? error : new Error(String(error)));
  });
}

/**
 * TESTING.md rule 8: existing is not working.
 *
 * Presence and text assertions are blind to layout. This measures geometry:
 * nothing overflows its container, no two siblings overlap, and nothing has
 * collapsed to zero size — a collapsed element is invisible, not absent, so
 * presence checks pass on it.
 */
/**
 * Click something, and record a FAILURE rather than aborting the suite if it
 * cannot be clicked.
 *
 * A `locator.click` that times out throws, and an uncaught throw ends the whole
 * run: three mutation runs in a row were blocked because step 7's flake took the
 * three steps after it down, leaving four of eleven mutations unmeasured with
 * verdicts assembled from step 7's failures.
 *
 * THIS DOES NOT SOFTEN ANY CHECK. The failed click is still a failed check, it
 * still counts as a failure, and it still fails the run. What changes is that a
 * failure in one step stops invalidating measurements of unrelated steps.
 */
/**
 * Wait until a selector resolves to the SAME node for several frames running.
 *
 * This measures the thing that actually breaks clicks here. Playwright's own
 * actionability wait handles an element that moves or is covered; it cannot help
 * with an element that is *replaced*, because each retry re-resolves the
 * selector and starts again. Measured on this app: re-selecting a country
 * swapped `[data-tab="economy"]` twice within 3s, and the click burned its full
 * 15s retrying a node that kept becoming a different node.
 *
 * Scoped to the element, never to `document.body` — the globe rewrites its
 * tooltip container continuously, so a body-wide wait never returns. That
 * mistake cost a whole verify run earlier tonight.
 *
 * Frames, not milliseconds: what is being waited on is renders, and a slow
 * machine needs longer to produce the same number of them.
 */
/**
 * Wait until the CAMERA stops moving.
 *
 * `controls.enableDamping = true` with `dampingFactor = 0.12`, so `flyTo` eases
 * toward its target over many frames rather than snapping — even with a 0ms
 * duration.
 *
 * `pickEvent` used to park for a fixed 500ms after focusing a cluster. At 1.3fps
 * that was two-thirds of ONE frame: the camera could not move between computing
 * a marker's screen position and moving the pointer there, so the two always
 * agreed. At 59.9fps the same 500ms is thirty frames of continuous easing, the
 * coordinates are read mid-glide, and the marker has moved by the time the
 * pointer arrives.
 *
 * That is why switching to the GPU took `hover-missed` from 0 in 30 trials to 24
 * in 30. The pick was never robust; it was aiming at a stationary target by
 * accident of frame rate. Waiting for the camera to settle is the condition that
 * makes it robust at any frame rate — rule 15, at a site that had escaped it.
 */
async function waitForCameraSettled(page, { quietFrames = 3, maxFrames = 300, hardStopMs = 10_000 } = {}) {
  return page.evaluate(
    ({ frames, budget, hardStop }) =>
      new Promise((resolve) => {
        const read = () => {
          const pov = window.__worldpulse?.pointOfView?.();
          return pov ? `${pov.lat.toFixed(4)},${pov.lng.toFixed(4)},${pov.altitude.toFixed(4)}` : null;
        };
        let last = read();
        let still = 0;
        let seen = 0;
        const started = performance.now();
        const tick = () => {
          seen += 1;
          const now = read();
          if (now !== null && now === last) still += 1;
          else {
            still = 0;
            last = now;
          }
          if (still >= frames) {
            resolve(true);
            return;
          }
          if (seen >= budget || performance.now() - started > hardStop) {
            resolve(false);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { frames: quietFrames, budget: maxFrames, hardStop: hardStopMs },
  );
}

/**
 * Frame budgets re-based for the GPU default.
 *
 * `maxFrames: 24` was chosen when a frame cost 750ms — eighteen seconds. At
 * 16.7ms it is four tenths of a second, which is not long enough for anything
 * involving an async load to settle. The budget is sized for the configuration
 * that is now the default, with `hardStopMs` as the backstop when the software
 * fallback makes frames expensive again.
 */
async function waitForStableNode(page, selector, { quietFrames = 3, maxFrames = 300, hardStopMs = 15_000 } = {}) {
  return page.evaluate(
    ({ sel, frames, budget, hardStop }) =>
      new Promise((resolve) => {
        let last = document.querySelector(sel);
        let stable = 0;
        let seen = 0;
        const started = performance.now();
        const tick = () => {
          seen += 1;
          const now = document.querySelector(sel);
          if (now !== null && now === last) {
            stable += 1;
          } else {
            stable = 0;
            last = now;
          }
          if (stable >= frames) {
            resolve(true);
            return;
          }
          if (seen >= budget || performance.now() - started > hardStop) {
            resolve(false);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { sel: selector, frames: quietFrames, budget: maxFrames, hardStop: hardStopMs },
  );
}

async function clickOrFail(page, selector, label) {
  // Stop handing Playwright a moving target. This does not relax the click's own
  // 15s budget — it stops that budget being spent re-resolving a replaced node.
  await waitForStableNode(page, selector);
  try {
    await page.locator(selector).click({ timeout: 15_000 });
    return true;
  } catch (error) {
    check(`${label}: clickable`, false, String(error?.message ?? error).split('\n')[0].slice(0, 120));
    return false;
  }
}

/**
 * Read text, or fail this check instead of ending the suite.
 *
 * Third location of the same fault. `locator.innerText()` waits the full default
 * timeout for an element that never appears, then throws — and the throw aborted
 * step 7b before the cross-cutting steps could run, which is why two mutations
 * were unmeasurable across four consecutive runs while nine caught reliably.
 *
 * The two earlier sites were clicks; this one is a read. The lesson generalises
 * past "wrap clicks": ANY Playwright call that waits can abort the suite, and an
 * aborted suite silently invalidates every later step's mutations.
 *
 * A shorter timeout is deliberate. 90s of waiting produces the same verdict as
 * 10s — the element is not there — while costing 80 seconds of a run that is
 * already the slowest thing in this project.
 */
async function textOrFail(page, selector, label, kind = 'innerText') {
  try {
    return kind === 'innerHTML'
      ? await page.locator(selector).innerHTML({ timeout: 15_000 })
      : await page.locator(selector).innerText({ timeout: 15_000 });
  } catch (error) {
    check(`${label}: present to read`, false, String(error?.message ?? error).split('\n')[0].slice(0, 120));
    return '';
  }
}

async function assertLayout(page, containerSelector, childSelector, label) {
  const report = await page.evaluate(
    ([container, child]) => {
      const root = document.querySelector(container);
      if (!root) return { error: `container ${container} not found` };
      const rootBox = root.getBoundingClientRect();
      const kids = [...root.querySelectorAll(child)]
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
        .map((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            tag: el.className || el.tagName,
            x: Math.round(box.x), y: Math.round(box.y),
            w: Math.round(box.width), h: Math.round(box.height),
            // Vertical clipping, the counterpart to rule 9's horizontal test.
            // Only where the overflow is actually unreachable: content that
            // spills out of a visible-overflow box is still on screen, and the
            // overlap test below is what catches that.
            clipsY: ['hidden', 'clip'].includes(style.overflowY),
            scrollH: el.scrollHeight,
            clientH: el.clientHeight,
          };
        });
      return { rootBox: { x: rootBox.x, y: rootBox.y, w: rootBox.width, h: rootBox.height }, kids };
    },
    [containerSelector, childSelector],
  );

  if (report.error) {
    check(`${label}: layout`, false, report.error);
    return;
  }
  if (report.kids.length === 0) {
    check(`${label}: layout`, false, `no visible children matched ${childSelector}`);
    return;
  }

  // The judgement is in layout-rules.mjs so it can be called with synthetic
  // boxes (rule 32). Measuring needs a DOM; deciding never did.
  const problems = layoutProblems(report);

  check(`${label}: no overlap or overflow`, problems.length === 0, problems.slice(0, 3).join('; '));
}

/**
 * TESTING.md rule 9: geometry cannot prove readability.
 *
 * scrollWidth > clientWidth means the text does not fit its box — the direct
 * test for clipping, independent of formatting strategy. SVG text is measured
 * with getComputedTextLength() instead, since scrollWidth does not apply.
 *
 * Rule 9b: a value clipped without an ellipsis is a DIFFERENT NUMBER, not an
 * approximation. Prose may ellipsize visibly; values may not.
 */
async function assertTextFits(page, selector, label, options = {}) {
  const result = await page.evaluate(
    ([sel, allowEllipsis]) => {
      const out = [];
      let examined = 0;
      for (const el of document.querySelectorAll(sel)) {
        if (el.getClientRects().length === 0) continue;
        const text = (el.textContent ?? '').trim();
        if (text.length === 0) continue;
        examined += 1;
        const style = getComputedStyle(el);
        // A visible ellipsis is permitted on prose only, and the caller says so.
        const ellipsized = style.textOverflow === 'ellipsis';
        if (allowEllipsis && ellipsized) continue;
        if (el.scrollWidth > el.clientWidth + 1) {
          out.push({ cls: String(el.className).slice(0, 40), text: text.slice(0, 48), scroll: el.scrollWidth, client: el.clientWidth });
        }
      }
      return { clipped: out, examined };
    },
    [selector, options.allowEllipsis === true],
  );
  // TESTING.md rule 10, applied to the selector rather than to the data: a
  // selector matching nothing produced an empty offender list, which scored
  // identically to "everything fits". Every rule-9 check in this suite would
  // have gone on passing through a renamed class.
  check(`${label}: matched something to measure`, result.examined > 0,
    `selector ${selector} matched no visible non-empty element`);
  check(`${label}: text not clipped`, result.clipped.length === 0, JSON.stringify(result.clipped.slice(0, 3)));
}

/** SVG text has no scrollWidth; measure the rendered advance instead. */
async function assertSvgTextFits(page, selector, maxPx, label) {
  const result = await page.evaluate(
    ([sel, budget]) => {
      const nodes = [...document.querySelectorAll(sel)].filter((el) => el.getComputedTextLength);
      return {
        examined: nodes.length,
        overflowing: nodes
          .filter((el) => el.getComputedTextLength() > budget)
          .map((el) => ({ text: el.textContent, width: Math.round(el.getComputedTextLength()) })),
      };
    },
    [selector, maxPx],
  );
  check(`${label}: matched something to measure`, result.examined > 0,
    `selector ${selector} matched no measurable SVG text`);
  check(`${label}: SVG text within ${maxPx}px`, result.overflowing.length === 0,
    JSON.stringify(result.overflowing.slice(0, 3)));
}

const BREAKPOINTS = [
  { width: 360, height: 780, name: '360px' },
  { width: 900, height: 800, name: '900px' },
  { width: 1600, height: 950, name: 'desktop' },
];

// This environment ships Chromium out of band; PLAYWRIGHT_CHROMIUM_PATH points
// at it so the npm package's pinned build number does not have to match.
//
// Resolved rather than passed through: an unset variable here used to become a
// launch failure inside Playwright, which this harness reported as a FAIL and
// the mutation suite scored as a catch. Failing before the run starts, with the
// export line to paste, is the difference between a misconfiguration and an
// hour spent reading a green table that measured nothing.
/**
 * Refuse to start while another measuring run holds the machine.
 *
 * Taken here rather than at the top of the file so that a mutation run — which
 * spawns this harness as a child — is not blocked by its own parent's lock.
 * MUTATE_CHILD is set by mutation-check.mjs for exactly that reason: the parent
 * already holds the lock on the whole machine, and the child is the work the
 * lock was taken for.
 */
if (process.env['MUTATE_CHILD'] !== '1') acquireRunLock('verify', undefined);

const { executablePath, note: chromiumNote } = resolveChromium({
  envPath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  pinnedPath: pinnedChromiumPath(),
  exists: existsSync,
  candidates: findChromiumCandidates(process.env.PLAYWRIGHT_BROWSERS_PATH, { readdirSync, existsSync }, join),
});
console.log(`chromium: ${chromiumNote}`);
/**
 * GPU by default; `WORLDPULSE_SOFTWARE_GL=1` opts out.
 *
 * This inverts what stood here before, and the comment it replaces was wrong in
 * a way worth recording. It said hardware GL "is roughly twice as fast — but it
 * is NOT equivalent", and that software should stay authoritative. Both halves
 * came from measurements of a configuration that was never hardware:
 * `WORLDPULSE_HARDWARE_GL=1` merely dropped the swiftshader flags, and headless
 * Chromium falls back to SwiftShader without an explicit ANGLE backend. Four
 * sessions of "hardware" numbers were software.
 *
 * With `--use-angle=gl` the same machine renders the globe at 59.9fps against
 * SwiftShader's 1.3 — 46× — with a flat frame time (p95 16.8ms against
 * 1533.3ms). See FOUND.md.
 */
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: glArgs(),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

/**
 * Print the renderer the run ACTUALLY got, and refuse a silent fallback.
 *
 * The label is a request; this is the answer. Asking cost one `getParameter`
 * call and would have caught the mislabelled configuration immediately, so it is
 * now unconditional — every run states its renderer beside its numbers, per
 * rule 20a.
 */
const renderer = await describeRenderer(page);
console.log(`renderer: ${renderer}`);
if (process.env['WORLDPULSE_SOFTWARE_GL'] !== '1' && isSoftwareRenderer(renderer)) {
  console.error(
    `\nREQUESTED THE GPU AND GOT SOFTWARE: ${renderer}\n` +
      'Every timing and flake number from this run would describe a renderer nobody asked for, ' +
      'under a label saying otherwise — which is exactly how four sessions of "hardware GL" ' +
      'measurements turned out to be SwiftShader. Set WORLDPULSE_SOFTWARE_GL=1 to run software ' +
      'deliberately, or fix the ANGLE backend.\n',
  );
  process.exit(1);
}

// Patience for a machine that is doing other things. Playwright's 30s default is
// comfortable on a dedicated container and marginal on a working desktop under
// software rasterisation, where an ordinary click timed out and aborted a run
// that had otherwise passed. This changes no assertion — only how long the
// harness waits before calling something stuck.
page.setDefaultTimeout(90_000);

/**
 * Portrait images are blocked by this harness, not by the environment.
 *
 * The degradation path — a portrait that cannot load must fall back to initials
 * rather than a broken-image icon or a blank frame that reads as an unnamed
 * person — used to be exercised only because the sandbox happened to block every
 * external host. Run the same suite on a machine with working egress and the
 * images load, the failure never happens, and the check passes for an unrelated
 * reason: a different fixture that has no portrait at all.
 *
 * That is the Tuvalu bug wearing a network. Blocking the requests here makes the
 * failure deterministic on any machine, and the counter below is the positive
 * control that the block actually had something to block.
 */
let blockedPortraits = 0;
await page.route(/(commons|upload)\.wikimedia\.org/, (route) => {
  blockedPortraits += 1;
  return route.abort('failed');
});

// Uncaught exceptions are always fatal. Resource-load failures are separated
// out because portrait requests are deliberately aborted above — the app is
// required to degrade gracefully, and that degradation is asserted directly
// further down rather than inferred from a silent console.
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

step('1 — globe, selection, relations');
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
// Five is structural, not incidental: the relation vocabulary has exactly five
// tiers and the next line destructures all five. The number IS the claim here,
// which is what separates this from the tab and layer counts (rule 25).
check('tier counts rendered', counts.length === 5, counts.join(','));
const [allies, , , , nodata] = counts.map(Number);
check('USA has allies from the seed set', allies > 20, `allies=${allies}`);
check('most countries read as no data', nodata > 100, `nodata=${nodata}`);

/**
 * B1: no relation row may carry its tier in colour alone.
 *
 * Roughly one man in twelve cannot use hue to separate `adversary` from
 * `strained`, and before this the list row's only tier signal was a 10px
 * coloured chip. Asserted on the rendered DOM rather than on the palette,
 * because a palette that is safe in a unit test and a row that renders the
 * label are different claims — rule 8's argument, applied to encoding.
 */
const rowTiers = await page.locator('.relation-list li .relation-tier').allTextContents();
const rowCount = await page.locator('.relation-list li').count();
check('every relation row names its tier in text', rowCount > 0 && rowTiers.length === rowCount,
  `rows=${rowCount} labelled=${rowTiers.length}`);
check('the tier labels are real words, not empty spans',
  rowTiers.length > 0 && rowTiers.every((text) => text.trim().length > 0),
  rowTiers.slice(0, 5).join(' | '));

// The shape channel, which is what survives when colour and text both fail —
// a monochrome print, a very small swatch, a reader who does not read English.
const glyphs = await page.locator('.relation-list li .swatch').allTextContents();
check('every relation row carries a tier glyph',
  glyphs.length === rowCount && glyphs.every((glyph) => glyph.trim().length > 0),
  `glyphs=${glyphs.filter((g) => g.trim()).length}/${rowCount}`);

// Positive control: the rows must actually span more than one tier, or the
// three checks above are satisfied by a list that happens to be all one kind.
check('the rows under test span more than one tier',
  new Set(rowTiers.map((text) => text.trim())).size > 1,
  [...new Set(rowTiers.map((t) => t.trim()))].join(','));

await shot(page, `${SHOTS}/01-relations-usa.png`);

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
if (tooltipSeen) await shot(page, `${SHOTS}/04-traceability-popover.png`);

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

await shot(page, `${SHOTS}/02-compare.png`);

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

await shot(page, `${SHOTS}/03-weights-inverted.png`);

step('2 — confidence badges, provenance inspector');
// ---- step 2: confidence badges and the provenance inspector ----
//
// Per docs/TESTING.md rule 1, these assert on behaviour a broken component
// could not fake: the inspector must actually surface the request URL and raw
// body for the clicked fact.

await page.locator('.rail-reset').click();
await page.waitForTimeout(400);

const tiers = await page.locator('.gallery .badge').allTextContents();
check('gallery renders every badge state', tiers.length >= 6, tiers.join(' | '));

/**
 * P3, asserted in a browser — P12's requirement, that a decision specifying
 * user-visible behaviour ships with an assertion or it is only a note.
 *
 * A derivation whose REQUIRED input came back empty must render as no data, not
 * as a confident computed value. Before P3 the empty input was invisible to the
 * derivation: `inputs` held provenances, and "no data" is a property of a value,
 * so this fact would have rendered its arithmetic as though every term were
 * present.
 */
const p3Card = page.locator('.gallery li', { hasText: 'a required input came back empty' });
check('P3: a derivation with an empty required input is rendered', (await p3Card.count()) === 1);

/**
 * The claim is about the VALUE, not the badge.
 *
 * A `nodata` fact keeps its tier badge — `badgeMarkup` special-cases only
 * broken, unconfigured and unavailable — and renders the absence in the value,
 * via `valueMarkup`'s `.fact-value--nodata`. An earlier version of this check
 * asserted on the badge text and failed reading `ƒ DERIVED`, which was the
 * assertion being wrong about the design rather than the app being wrong.
 *
 * What P3 actually has to deliver is that the derivation does not print a
 * computed number it had no complete inputs for.
 */
check('P3: the value renders as no data, not as a computed number',
  (await p3Card.locator('.fact-value--nodata').count()) === 1,
  await p3Card.locator('.fact-value').first().textContent() ?? '(no value element)');

// Positive control: the ordinary DERIVED card in the same gallery still renders
// its value, so the check above is detecting P3 rather than a broken gallery.
const plainDerived = page.locator('.gallery li', { hasText: 'A count this app computed' });
check('positive control: an ordinary derivation still shows its value',
  (await plainDerived.locator('.badge--derived').count()) === 1);

/**
 * P3's SECOND half in a browser: a shortfall among merely-contributing inputs.
 *
 * The two cases are only meaningful against each other. A required input coming
 * back empty must suppress the value; a contributing one must NOT — it must
 * leave the number standing and say what was missing. Assert both, or the first
 * assertion is equally satisfied by an app that renders everything as no data.
 *
 * Unreachable in production today: relations is the only `required: false`
 * caller and its input values are typed `number`, so nothing can be empty
 * (OPEN-QUESTIONS 13). Asserted here anyway — the disclosure is watched working
 * before a source depends on it.
 */
const shortfallCard = page.locator('.gallery li', { hasText: 'fewer inputs than were consulted' });
check('P3: a contributing shortfall renders as its own card', (await shortfallCard.count()) === 1);

check('P3: a contributing shortfall KEEPS its value — it is not "no data"',
  (await shortfallCard.locator('.fact-value--nodata').count()) === 0
    && ((await shortfallCard.locator('.fact-value').first().textContent()) ?? '').includes('5'),
  await shortfallCard.locator('.fact-value').first().textContent() ?? '(no value element)');

check('P3: the shortfall is disclosed as a caveat on the fact',
  /fewer inputs than were consulted/.test(
    (await shortfallCard.locator('.fact-note').first().textContent().catch(() => '')) ?? ''),
  await shortfallCard.locator('.fact-note').first().textContent().catch(() => '(no note element)'));

// And where the arithmetic is shown, because the formula "+3 +2 = 5" cannot
// disclose a missing term — a term that is absent simply is not in it.
await shortfallCard.locator('.badge').first().click();
await page.waitForTimeout(400);
const shortfallInspector = await page.locator('.inspector-body').innerText().catch(() => '');
check('P3: the inspector states the shortfall next to the arithmetic',
  /2 contributing inputs returned no value|1 of 3 contributing inputs returned no value/.test(
    shortfallInspector.replace(/\s+/g, ' ')),
  shortfallInspector.replace(/\s+/g, ' ').slice(0, 200));
check('P3: the shortfall inspector still shows the formula it computed from',
  shortfallInspector.includes('+3 +2 = 5'), shortfallInspector.slice(0, 120));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
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
// The invariant is that the inspector STATES the verification status, not that
// the status is any particular value — worldbank went live, and an assertion
// pinned to "documentation" broke on a legitimate change. Rule 25.
check('inspector states the source verification status',
  /documentation|live|bundled/i.test(inspectorText), inspectorText.slice(0, 160));

const rawShown = await page.locator('.inspector-raw pre').innerText();
check('inspector shows the raw response body', rawShown.includes('NY.GDP.MKTP.CD'), rawShown.slice(0, 60));

await shot(page, `${SHOTS}/05-inspector.png`);

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
await shot(page, `${SHOTS}/06-broken.png`);
await page.keyboard.press('Escape');

// A derived fact must expose its arithmetic and walk down to its seed inputs.
await page.waitForTimeout(300);
await page.locator('.relation-list .badge').first().click();
await page.waitForTimeout(400);
const derivedText = await page.locator('.inspector-body').innerText().catch(() => '');
check('a derived fact shows its arithmetic', /Arithmetic/i.test(derivedText), derivedText.slice(0, 80));
check('a derived fact lists its inputs', /Inputs \(\d+\)/i.test(derivedText));
check('derived inputs resolve to seed citations', /Checked against/i.test(derivedText));
await shot(page, `${SHOTS}/07-derived-provenance.png`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

step('3 — dossier header, leader resolution');
// ---- step 3: dossier header and leader resolution ----

async function selectCountry(name) {
  await page.locator('.search-input').fill(name);
  /**
   * A condition on CONTENT, not on quiescence.
   *
   * The old 250ms park was under half a frame here. Quiescence is the wrong
   * instrument for this half: the results list is absent until the filter runs,
   * and "absent" quiets instantly, which would wait for nothing at all. What
   * Enter actually needs is a result to select.
   */
  await waitFor(page, () => (document.querySelector('.search-results')?.children.length ?? 0) > 0, 10_000);
  await page.keyboard.press('Enter');

  /**
   * The dossier rebuild has to FINISH before anything clicks into it.
   *
   * The old 500ms park was under one frame here, so a caller could click a tab
   * that was about to be replaced — which is precisely how `economy tab:
   * clickable` timed out while every assertion after it passed.
   *
   * Reported on failure only, matching `clickOrFail`: a healthy run adds no
   * assertions, and a dossier that never settles says so instead of failing
   * something later and unrelated.
   */
  /**
   * Observe `#panel`, the element that SURVIVES the re-render — not `.dossier`,
   * which does not.
   *
   * `mountPanel` does `root.innerHTML = render(state)`, so every store update
   * replaces the panel's entire subtree. Watching `.dossier` grabbed the current
   * one, the re-render detached it, and **a detached node never mutates again** —
   * so the observer reported "quiet" after three frames while the real panel was
   * still churning. It failed by succeeding, which is worse than timing out.
   *
   * Same class as the `document.body` fallback this helper already warns about:
   * both are cases of observing the wrong node. The rule that covers both is
   * that a quiescence target must be an element the re-render keeps.
   */
  /**
   * The WAIT stays; the failure REPORT does not, and the difference matters.
   *
   * Waiting here demonstrably fixed step 7b — `economy tab: clickable` went from
   * failing twice to clean. But reporting "did not settle" as a failure was
   * measuring the wrong thing. `#panel` mutates roughly once every four frames
   * at rest (measured), so three consecutive quiet frames inside a budget of
   * twenty-four is marginal by construction, and the one call site that tripped
   * it had every downstream assertion pass. A check that goes red over a
   * condition which breaks nothing is rule 15's cry-wolf: it teaches people that
   * red means "run it again".
   *
   * What guards the real failure is `waitForStableNode` inside `clickOrFail`,
   * which asserts the specific thing that used to break — the node under the
   * click being replaced mid-click — and which now passes.
   */
  return waitForDomQuiet(page, '#panel');
}

// Rule 2 — presidential, one portrait.
await selectCountry('United States');
const usHeader = await page.locator('.dossier').innerText();
check('dossier header renders vitals', /Capital/i.test(usHeader) && /Population/i.test(usHeader));
check('header states which resolution rule fired', /Rule 2/i.test(usHeader), usHeader.slice(0, 120));
check('presidential renders a single portrait', (await page.locator('.dossier .portrait').count()) === 1);
check('office title is shown verbatim', /President of the United States/.test(usHeader));
await shot(page, `${SHOTS}/08-dossier-presidential.png`);

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
await shot(page, `${SHOTS}/09-dossier-dual-portrait.png`);

// Rule 1 — de facto authority, with the override citation on screen.
await selectCountry('Iran');
const iranHeader = await page.locator('.dossier').innerText();
check('de facto authority fires rule 1', /Rule 1/i.test(iranHeader), iranHeader.slice(0, 140));
check('override citation is shown', /Reviewed override/i.test(iranHeader));
check('the supreme authority leads, not the president', /Supreme authority/i.test((await page.locator('.dossier .portrait-role').first().innerText())));
await shot(page, `${SHOTS}/10-dossier-de-facto.png`);

// Rule 5 — junta title is not normalised.
await selectCountry('Mali');
const maliHeader = await page.locator('.dossier').innerText();
check('transitional government fires rule 5', /Rule 5/i.test(maliHeader));
check('the literal junta title survives to the DOM', /Chairman, Transitional Military Council/.test(maliHeader));
check('the junta title is not smoothed to President', !/\bPresident\b/.test(maliHeader), maliHeader.slice(0, 160));
await shot(page, `${SHOTS}/11-dossier-junta.png`);

// Missing P18 — initials placeholder, and never a substitute photograph.
await selectCountry('Canada');
check('a leader with no P18 falls back to an initials placeholder',
  (await page.locator('.dossier .portrait-frame--placeholder').count()) >= 1);
check('the placeholder carries no image element',
  (await page.locator('.dossier .portrait-img').count()) === 0);

// A portrait whose image cannot load must fall back to initials, not to a
// broken-image icon and not to a blank frame that reads as an unnamed person.
// Commons requests are aborted by the route installed at the top of this file,
// so the failure happens on every machine rather than only inside a sandbox.
await selectCountry('United States');
// Polled rather than timed: the image has to 403 and the error handler has to
// run, and a fixed wait makes this flaky under load.
check('a portrait whose image fails to load degrades to initials',
  await waitFor(page, () => {
    const placeholder = document.querySelector('.dossier .portrait-frame--placeholder');
    if (!placeholder) return false;
    const img = document.querySelector('.dossier .portrait-img');
    return img === null && placeholder.textContent.trim().length > 0;
  }));
// Rule 10. Without this the degradation check above could pass on a country
// whose fixture simply has no portrait, having never exercised a failed load.
check('positive control: portrait requests were attempted and blocked', blockedPortraits > 0,
  `the route aborted ${blockedPortraits} Commons request(s); zero means the fallback was never exercised`);

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
await shot(page, `${SHOTS}/12-leader-sheet.png`);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes the leader sheet without clearing the selection',
  !(await page.locator('.sheet-body').isVisible().catch(() => false)) &&
    (await page.locator('#mode').textContent())?.trim() === 'Relations mode');

step('4 — government tab');
// ---- step 4: government tab ----

await selectCountry('United Kingdom');
/**
 * Every specced section has a tab. Asserted as CONTAINMENT, not as a total:
 * `=== 7` encoded how many tabs exist today, and `military` is already declared
 * in TABS, so the step that ships it would have failed this check and read as a
 * regression. Rule 25 — the invariant is that no section is missing, not that
 * there are seven of them.
 */
const tabLabels = (await page.locator('.tabs .tab').allTextContents()).map((label) => label.trim().toLowerCase());
const missingTabs = ['government', 'legislature', 'military', 'economy', 'news', 'tv', 'risk']
  .filter((section) => !tabLabels.some((label) => label.includes(section)));
check('every specced dossier section has a tab', missingTabs.length === 0,
  `missing: ${missingTabs.join(', ')} | present: ${tabLabels.join(', ')}`);
check('government is the default tab', (await page.locator('.tab--active').innerText()).trim() === 'Government');

const govGbr = await page.locator('.gov').innerText();
check('cabinet renders ministries', (await page.locator('.ministry').count()) > 0);
check('a ministry gloss comes from Wikidata', /foreign relations/i.test(govGbr));
check('a missing gloss says so instead of inventing one', /No plain-English description/i.test(govGbr));
check('legislature seat totals render', /650/.test(govGbr));
check('a complete party split draws a bar', (await page.locator('.party-bar').count()) === 1);
check('a chamber with no party data draws no bar', /records no party composition/i.test(govGbr));
await shot(page, `${SHOTS}/13-government-gbr.png`);

// Hard case: partial party data must NOT be drawn as a bar.
await selectCountry('Saudi Arabia');
const govSau = await page.locator('.gov').innerText();
check('partial party data is refused, not drawn', (await page.locator('.party-bar').count()) === 0);
check('the refusal explains itself', /seats are accounted for/i.test(govSau), govSau.slice(0, 200));

// Hard case: 58-post cabinet.
await selectCountry('Germany');
const ministriesShown = await page.locator('.ministry:not(.ministry--hidden)').count();
check('a large cabinet collapses rather than dumping 58 rows', ministriesShown <= 12, `shown=${ministriesShown}`);
check('the full count is stated up front', /58 posts/.test(await page.locator('.gov').innerText()));
await page.locator('[data-expand="cabinet"]').click();
await page.waitForTimeout(300);
check('expanding reveals every post', (await page.locator('.ministry:not(.ministry--hidden)').count()) === 58);
await shot(page, `${SHOTS}/14-government-large-cabinet.png`);

// Hard case: untranslated portfolios.
await selectCountry('Iran');
const govIrn = await page.locator('.gov').innerText();
check('untranslated portfolios are flagged, not translated', /no English label/i.test(govIrn));
check('an untranslated portfolio keeps its identifier', /Q500[12]/.test(govIrn), govIrn.slice(0, 200));
check('a non-English label is kept rather than dropped', /Ministerio de Hacienda/.test(govIrn));

// Hard case: positions exist, no officeholders at all.
await selectCountry('Mali');
const govMli = await page.locator('.gov').innerText();
check('a cabinet with no holders still lists its posts', (await page.locator('.ministry').count()) === 3);
check('vacancies are counted rather than hidden', /3 of 3 positions have no current officeholder/i.test(govMli), govMli.slice(0, 200));
await shot(page, `${SHOTS}/15-government-no-holders.png`);

// Leadership timeline and the leader sheet's filled sections.
await selectCountry('United States');
const govUsa = await page.locator('.gov').innerText();
check('leadership timeline renders ended terms', /→/.test(govUsa) && /present/i.test(govUsa));
check('an undated term is kept and labelled', /dates not recorded/i.test(govUsa));

await page.locator('.dossier .portrait').first().click();
await page.waitForTimeout(400);
const sheet4 = await page.locator('.sheet-body').innerText();
check('leader sheet now shows a career timeline', /Career timeline/i.test(sheet4) && /Senator/i.test(sheet4));
check('predecessor and successor render from qualifiers', /after Robin Fixture/i.test(sheet4) && /succeeded by Kim Fixture/i.test(sheet4));
await shot(page, `${SHOTS}/16-leader-sheet-history.png`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Tab switching by keyboard, and unbuilt tabs naming their step.
// Key 6 is Live TV, which is still unbuilt. Retarget this whenever the tab it
// points at gets built, or it silently stops testing the pending-tab path.
await page.keyboard.press('6');
await page.waitForTimeout(300);
check('number keys switch dossier tabs', (await page.locator('.tab--active').innerText()).trim() === 'Live TV');
check('an unbuilt tab names the step that fills it', /step 11/.test(await page.locator('.gov').innerText()));
await page.keyboard.press('1');
await page.waitForTimeout(300);

step('5 — economy tab');
// ---- step 5: economy tab ----

/**
 * Step 5's hard cases run against `?econ=fixtures`, which serves exactly what the
 * fixture provider used to serve.
 *
 * The panel is live now, and live World Bank data will not produce a mid-series
 * gap, a redenomination or an eight-year-old latest observation on demand. Left
 * on the live path these assertions would silently become assertions about
 * whatever the API happens to return today, which is not a test of the branches
 * they were written for.
 */
await page.evaluate(() => window.__worldpulse.setEconScenario('fixtures'));
await page.waitForTimeout(200);

async function openEconomy(country) {
  await selectCountry(country);
  await clickOrFail(page, '[data-tab="economy"]', 'economy tab');
  await page.waitForTimeout(600);
}

await openEconomy('United States');
check('economy tab renders indicator blocks', (await page.locator('.econ-block').count()) > 0);
const econUsa = await page.locator('.econ').innerText();
check('every indicator states its own latest year', (await page.locator('.econ-asof').count()) > 1);
check('the panel refuses a single panel-wide as-of', /no single "as of" for this panel/i.test(econUsa));
check('a monetary value states its currency and basis', /US\$/.test(econUsa) && /Not adjusted for inflation/i.test(econUsa));
check('a chart is drawn', (await page.locator('svg.chart').count()) > 0);
await shot(page, `${SHOTS}/17-economy-usa.png`);

// Hard case: an indicator with no data must not plot a flat line at zero.
check('an empty indicator renders a no-data card, not a zero line',
  (await page.locator('.chart--empty').count()) > 0);
check('the no-data card explains why nothing is plotted', /different claim/i.test(econUsa));
const emptyBlockHasLine = await page.evaluate(() => {
  const empty = document.querySelector('.chart--empty');
  return empty?.closest('.econ-block')?.querySelector('polyline') !== null;
});
check('the empty indicator has no polyline anywhere in its block', emptyBlockHasLine === false);

// Hard case: a gap must break the line.
await openEconomy('Kosovo');
const econGap = await page.locator('.econ').innerText();
const gapSegments = await page.locator('.econ-block[data-indicator="gdp"] polyline').count();
check('a mid-series gap breaks the line into two segments', gapSegments === 2, `segments=${gapSegments}`);
check('the gap is marked on the chart', (await page.locator('.chart-gap').count()) > 0);
check('the gap years are named and non-interpolation is stated',
  /2011–2014/.test(econGap) && /not interpolated/i.test(econGap), econGap.slice(0, 240));
await shot(page, `${SHOTS}/18-economy-gap.png`);

// Hard case: a stale series.
await openEconomy('Eritrea');
const econStale = await page.locator('.econ').innerText();
check('a stale indicator states its age', /8 years old/.test(econStale), econStale.slice(0, 200));
check('a stale indicator states its latest year', /latest 2018/.test(econStale));

// Hard case: redenomination — log offered, and the toggle actually changes the plot.
await openEconomy('Zimbabwe');
const econZwe = await page.locator('.econ').innerText();
check('a wide-span series suggests a log scale', /orders of magnitude/i.test(econZwe), econZwe.slice(0, 200));
check('linear is the active scale before toggling', /linear scale/.test(econZwe));
const beforeToggle = await page.locator('.econ-block[data-indicator="gdp"] polyline').getAttribute('points');
await page.locator('.econ-block[data-indicator="gdp"] .econ-scale-toggle').click();
await page.waitForTimeout(400);
const afterToggle = await page.locator('.econ-block[data-indicator="gdp"] polyline').getAttribute('points');
check('the log toggle changes the plotted geometry', beforeToggle !== afterToggle);
check('the active scale is stated after toggling', /log scale/.test(await page.locator('.econ').innerText()));
await shot(page, `${SHOTS}/19-economy-log.png`);

// Hard case: log refused where the indicator can go negative.
await openEconomy('Venezuela');
const econVen = await page.locator('.econ').innerText();
check('log is refused for an indicator that can go negative', /log unavailable/i.test(econVen), econVen.slice(0, 200));
check('no log toggle is offered where log is undefined',
  (await page.locator('.econ-block[data-indicator="inflation"] .econ-scale-toggle').count()) === 0);

// Scale choice must not leak across a country change.
await openEconomy('Zimbabwe');
await page.locator('.econ-block[data-indicator="gdp"] .econ-scale-toggle').click();
await page.waitForTimeout(300);
await openEconomy('United States');
check('a log toggle does not follow the user to another country',
  /linear scale/.test(await page.locator('.econ').innerText()));


step('6 — news tab');
// ---- step 6: news tab ----

async function openNews(country) {
  await selectCountry(country);
  await page.locator('[data-tab="news"]').click();
  await page.waitForTimeout(400);
}

await openNews('United States');
check('news tab renders articles', (await page.locator('.news-item').count()) > 0);
const newsUsa = await page.locator('.news').innerText();
check('coverage volume is framed as a property of the index',
  /indexes English-language online news that it crawls/i.test(newsUsa));
await shot(page, `${SHOTS}/20-news-usa.png`);

// Hard case: sparse coverage must read as an index limitation.
await openNews('Fiji');
const newsTuv = await page.locator('.news').innerText();
check('sparse coverage says little is INDEXED, not that little is happening',
  /Little English-language coverage/i.test(newsTuv) && /limitation of the source/i.test(newsTuv), newsTuv.slice(0, 200));
check('sparse coverage is visually flagged', (await page.locator('.news-coverage--sparse').count()) === 1);
await shot(page, `${SHOTS}/21-news-sparse.png`);

// Hard case: non-Latin and RTL.
await openNews('Iran');
check('RTL headlines get dir=rtl', (await page.locator('.news-title[dir="rtl"]').count()) >= 3);
check('non-Latin outlet names render', await page.evaluate(() =>
  [...document.querySelectorAll('.news-outlet')].some((el) => /[\u0600-\u06FF]/.test(el.textContent))));
check('CJK headlines render', await page.evaluate(() =>
  [...document.querySelectorAll('.news-title')].some((el) => /[\u4E00-\u9FFF]/.test(el.textContent))));
await assertTextFits(page, '.news-item .news-title', 'RTL and CJK headlines');
await assertTextFits(page, '.news-item .news-outlet', 'non-Latin outlet names');
await shot(page, `${SHOTS}/22-news-multiscript.png`);

// Hard case: degraded rows counted, not dropped silently.
await openNews('Mali');
const newsMli = await page.locator('.news').innerText();
check('unusable feed rows are counted and explained',
  /4 item\(s\) in the feed could not be shown/.test(newsMli), newsMli.slice(0, 240));
check('the reasons are named', /no usable web link|no usable timestamp/.test(newsMli));

// Hard case: syndication is deduplicated AND counted.
await openNews('United Kingdom');
const newsGbr = await page.locator('.news').innerText();
check('syndicated copies collapse to one row', (await page.locator('.news-item').count()) === 3);
check('the outlet count is shown rather than the copies hidden',
  /\+11 more outlets/.test(newsGbr), newsGbr.slice(0, 200));

// Topic filters.
await openNews('United States');
await page.locator('[data-topic="economy"]').click();
await page.waitForTimeout(300);
check('a topic filter narrows the list', (await page.locator('.news-item').count()) < 6);
check('filters are described as a convenience, not a classification',
  /not a classification/i.test(await page.locator('.news').innerText()));
await page.locator('[data-topic=""]').click();
await page.waitForTimeout(300);

step('7 — globe event layers');
// ---- step 7: globe layers ----
//
// A globe check must prove a rendered point is REAL. pointsData having a length
// proves nothing, so every assertion here goes through picking and reads back
// which event was hit.

await page.setViewportSize({ width: 1600, height: 950 });
await selectCountry('United States');
await page.waitForTimeout(600);

/**
 * Every declared layer has a toggle. Containment again, not a total — `=== 4`
 * broke when eonet:floods was registered under L12, which is the same defect as
 * the tab count.
 */
const toggleText = (await page.locator('.layer-toggle').allTextContents()).map((t) => t.trim().toLowerCase());
const missingToggles = ['earthquakes', 'volcanoes', 'wildfires', 'severe storms', 'floods']
  .filter((layer) => !toggleText.some((t) => t.includes(layer)));
check('every declared layer has a toggle', missingToggles.length === 0,
  `missing: ${missingToggles.join(', ')} | present: ${toggleText.join(' / ')}`);

/**
 * Pick a marker by brute-force hover across the globe and read back the event id
 * from the tooltip.
 *
 * Deriving screen coordinates from the renderer's own projection would be
 * circular — it would prove the projection agrees with itself. Sweeping the
 * canvas and reading the id back verifies the point is genuinely hit-testable
 * and resolves to a specific event.
 */
/**
 * Aim at a known event and read back which event the renderer says is there.
 *
 * The aim uses the renderer's projection; the ASSERTION is the id that comes
 * back. If the projection were wrong, this returns a different id or null —
 * which is exactly what the check is for. A blind sweep would be
 * non-circular too, but 500+ raycasts kill the software rasteriser.
 */
async function pickEvent(eventId, { focus = true } = {}) {
  // Centre the camera on the target first. A marker near the limb is a sliver a
  // few pixels wide; aiming at it tests the rasteriser's luck, not the app. The
  // assertion is unchanged — aim, then require THAT event's id back.
  //
  // focus:false for the occlusion check, where centring the camera on the
  // back-facing marker would bring it into view and defeat the point.
  if (focus) {
    await page.evaluate((id) => window.__worldpulse.focusCluster(id), eventId);
    // A CONDITION, not a park. Damping means flyTo eases over many frames, so
    // coordinates read mid-glide are stale by the time the pointer arrives.
    await waitForCameraSettled(page);
  }
  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);
  const target = await page.evaluate((id) => window.__worldpulse.screenCoordsOf(id), eventId);
  if (!target) return { aimed: false, id: null };
  await page.mouse.move(target.x, target.y);
  // Polled, not timed: under software rendering globe.gl's raycast can take
  // many frames, and a fixed wait made this intermittently return null even
  // though the marker was perfectly pickable.
  // The result is consumed, not discarded. TESTING.md recorded "discarded
  // waitFor results" as a checked-and-clean class while this call site — in the
  // flakiest check in the suite — threw its result away, so a tooltip that
  // never appeared was indistinguishable from one that appeared with the wrong
  // id. Callers can now tell those apart.
  /**
   * ONE evaluation: presence and identity together.
   *
   * This fix was written, measured green and REVERTED four sessions ago, and the
   * revert was correct at the time: rule 15 recorded that the '.evt'-exists wait
   * was vacuous — the previous hover's tooltip satisfied it instantly — so a fix
   * that removed failures without removing that vacuity was rule 34's forbidden
   * shape. FOUND.md named the condition for landing it: fix the vacuity first,
   * then measure the read race separately.
   *
   * The GPU met that condition. At 60fps the tooltip actually clears when the
   * pointer parks, so the guard is real, and with it real the two-round-trip race
   * is measurable: hover-missed went from 22-of-30 to 0-of-30 with this change,
   * on the frame-profile tool, under a renderer that reports itself.
   */
  const seen = await waitForValue(
    page,
    () => {
      const tip = document.querySelector('.evt');
      return tip ? { id: tip.getAttribute('data-event-id') } : null;
    },
    5000,
  );
  return { aimed: true, settled: seen !== null, id: seen?.id ?? null, x: target.x, y: target.y };
}

// Aim at a specific front-facing event and require THAT event back.
await page.evaluate(() => window.__worldpulse.pointOfView());
const frontEvent = await page.evaluate(() => {
  const counts = window.__worldpulse.counts();
  void counts;
  // Pick any cluster currently facing the camera, so the aim is not occluded.
  return window.__worldpulse.frontFacingClusterId();
});
check('at least one marker faces the camera to aim at', frontEvent !== null);

const picked = frontEvent ? await pickEvent(frontEvent) : { aimed: false, id: null };
check('a rendered marker is pickable', picked.aimed && picked.id !== null, JSON.stringify(picked));
check('the pick resolves to the event that was aimed at, not a neighbour',
  picked.id === frontEvent, `aimed ${frontEvent} got ${picked.id}`);
await shot(page, `${SHOTS}/23-globe-layers.png`);

// Camera: flying to an event must actually move the camera, from somewhere else.
// Start the camera OFF the target, or a flyTo that no-ops would pass.
await page.evaluate((id) => window.__worldpulse.focusCluster(id, 14, 14), picked.id ?? '');
await page.waitForTimeout(600);
const cameraBefore = await page.evaluate(() => window.__worldpulse?.pointOfView?.() ?? null);
check('the app exposes camera state for verification', cameraBefore !== null);
const targetCoords = await page.evaluate((id) => window.__worldpulse.eventById(id), picked.id ?? '');
check('positive control: the camera starts away from the target',
  cameraBefore !== null && targetCoords !== null &&
    (Math.abs(cameraBefore.lat - targetCoords.lat) > 5 || Math.abs(cameraBefore.lng - targetCoords.lng) > 5),
  `camera ${JSON.stringify(cameraBefore)} target ${JSON.stringify(targetCoords)}`);
if (!picked.id || !cameraBefore) {
  skipped('clicking a marker moved the camera at all', 'no marker was picked to click');
  skipped("the camera landed on that event's coordinates", 'no marker was picked to click');
  skipped('positive control: the marker is hovered before the click', 'no marker was picked to click');
}
if (picked.id && cameraBefore) {
  // Hover must actually register before the click: globe.gl resolves the
  // clicked object from its hover state, and under software rendering the
  // raycast can take several frames. Waiting on the tooltip rather than a fixed
  // delay is what makes this deterministic.
  // Park the pointer off the marker first, then re-pick. Moving to coordinates
  // the pointer already occupies dispatches no pointermove, so globe.gl never
  // re-runs its raycast and the click lands with no hovered object.
  const target = await page.evaluate((id) => {
    const found = window.__worldpulse.eventById(id);
    window.__wpTargetLat = found?.lat ?? NaN;
    window.__wpTargetLng = found?.lng ?? NaN;
    return found;
  }, picked.id);

  /**
   * Hover, click, and wait for the camera — retried, because the RACE is
   * flaky, not the behaviour.
   *
   * globe.gl resolves a click against the object its own raycast last hovered.
   * Under swiftshader that raycast lands some indeterminate number of frames
   * after the pointer moves, so a click occasionally arrives with no hovered
   * object and is simply dropped. One attempt fails roughly one run in three.
   *
   * Retrying does NOT weaken the assertion: each attempt still has to hover the
   * SAME event and the camera still has to land on that event's real
   * coordinates. What the retry removes is a frame-timing coin flip, and a check
   * that fails a third of the time for reasons unrelated to the app is a check
   * everyone learns to re-run rather than read.
   */
  let repick = { id: null };
  let arrived = false;
  let attempts = 0;
  // Which way each attempt failed, so the assertion below can say what the
  // retry absorbed rather than only how many times it ran. A hover that never
  // landed and a click that was dropped after a correct hover are different
  // faults with different fixes.
  const attemptLog = [];
  while (attempts < 3 && !arrived) {
    attempts += 1;
    // Park the pointer off the marker first, then re-pick. Moving to coordinates
    // the pointer already occupies dispatches no pointermove, so globe.gl never
    // re-runs its raycast and the click lands with no hovered object.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(250);
    repick = await pickEvent(picked.id, { focus: false });
    if (repick.id !== picked.id) {
      // `settled` distinguishes a tooltip that never appeared from one that
      // appeared naming a different event. Both used to read as "hover-missed".
      attemptLog.push(
        repick.settled === false
          ? 'hover-missed (no tooltip appeared within 5s)'
          : `hover-missed (tooltip named ${repick.id})`,
      );
      continue;
    }

    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();

    arrived = await waitFor(
      page,
      // eslint-disable-next-line no-undef
      () => {
        const pov = window.__worldpulse.pointOfView();
        return Math.abs(pov.lat - window.__wpTargetLat) < 1.5 && Math.abs(pov.lng - window.__wpTargetLng) < 1.5;
      },
      5000,
    );
    attemptLog.push(arrived ? 'arrived' : 'click-dropped after a correct hover');
  }

  check('positive control: the marker is hovered before the click', repick.id === picked.id,
    `re-pick got ${repick.id}`);

  const after = await page.evaluate(() => window.__worldpulse.pointOfView());

  check('clicking a marker moved the camera at all',
    Math.abs(after.lat - cameraBefore.lat) > 0.5 || Math.abs(after.lng - cameraBefore.lng) > 0.5,
    `before ${JSON.stringify(cameraBefore)} after ${JSON.stringify(after)} in ${attempts} attempt(s)`);
  check('the camera landed on that event\'s coordinates', arrived,
    `camera ${JSON.stringify(after)} target ${JSON.stringify(target)} in ${attempts} attempt(s)`);

  /**
   * The retry may absorb a frame-timing coin flip. It may not absorb a broken
   * guard, and until this assertion existed there was no way to tell which one
   * it was doing.
   *
   * Reporting the attempt count in the failure detail above is not visibility:
   * those strings print only when the check fails, so a run needing all three
   * attempts printed exactly like a run that worked first time. Measured on
   * this machine, the first attempt succeeded 2 of 30 times — the retry was not
   * smoothing a race, it was carrying the check.
   *
   * This is deliberately a check and not a warning. A degraded mechanism that
   * still produces a green suite is the thing this project keeps being bitten
   * by, and rule 15's whole claim was that needing all three attempts would be
   * visible rather than silent.
   */
  check('the marker click worked on the first attempt', attempts === 1,
    `needed ${attempts} attempt(s): ${attemptLog.join(', ')}. ` +
    'The retry is masking a guard failure, not a frame-timing coin flip — see TESTING.md rule 15.');
}

// Occlusion: a marker on the far side must not be pickable.
const occlusion = await page.evaluate(() => {
  const api = window.__worldpulse;
  const pov = api.pointOfView();
  const antipodeLat = -pov.lat;
  const antipodeLng = pov.lng > 0 ? pov.lng - 180 : pov.lng + 180;
  return {
    front: api.facesCamera(pov.lat, pov.lng),
    back: api.facesCamera(antipodeLat, antipodeLng),
  };
});
check('a point facing the camera passes the occlusion test', occlusion.front === true);
check('a point on the far side of the globe fails the occlusion test', occlusion.back === false,
  'back-face points would let a user click a marker they cannot see');

// The geometric test above is necessary but not sufficient: prove a back-facing
// MARKER is actually unpickable, with a front-facing pick as positive control.
const backId = await page.evaluate(() => window.__worldpulse.backFacingClusterId());
check('positive control: a back-facing marker exists to test', backId !== null);
if (!backId) skipped('a marker behind the globe cannot be picked', 'no back-facing marker existed to test');
if (backId) {
  const backPick = await pickEvent(backId, { focus: false });
  check('a marker behind the globe cannot be picked', backPick.id === null,
    `picked ${backPick.id} through the planet`);
}

// Count fidelity, with the rule-10 positive control on every absence.
const countsBefore = await page.evaluate(() => window.__worldpulse.counts());
check('rendered marker count equals the filtered event count',
  countsBefore.clusters + countsBefore.clusteredAway === countsBefore.rendered,
  JSON.stringify(countsBefore));
check('stale events are excluded by default', countsBefore.staleHidden > 0, JSON.stringify(countsBefore));

// Toggle one layer off and assert the delta, not merely "fewer".
const quakeTotal = await page.evaluate(() => window.__worldpulse.counts().byLayer['usgs:earthquakes'] ?? 0);
await clickOrFail(page, '[data-layer="usgs:earthquakes"]', 'earthquake layer toggle');
await page.waitForTimeout(500);
const countsAfter = await page.evaluate(() => window.__worldpulse.counts());
check('toggling a layer off removes exactly that layer\'s events',
  countsAfter.rendered === countsBefore.rendered - quakeTotal,
  `${countsBefore.rendered} - ${quakeTotal} != ${countsAfter.rendered}`);
// Rule 10: the absence claim needs a positive control that the toggle happened
// AND the globe still rendered something.
check('positive control: the toggle actually flipped',
  (await page.locator('[data-layer="usgs:earthquakes"]').getAttribute('aria-pressed')) === 'false');
check('positive control: other layers still render markers', countsAfter.clusters > 0,
  'an empty globe would make the previous assertion vacuous');
const remainingId = await page.evaluate(() => window.__worldpulse.frontFacingClusterId());
const stillPickable = remainingId ? await pickEvent(remainingId) : { aimed: false, id: null };
check('positive control: a remaining marker is still pickable', stillPickable.id !== null, JSON.stringify(stillPickable));
check('no earthquake marker survives the toggle', /^EONET_/.test(remainingId ?? ''), String(remainingId));

await clickOrFail(page, '[data-layer="usgs:earthquakes"]', 'earthquake layer toggle');
await page.waitForTimeout(500);
check('re-enabling the layer restores the exact count',
  (await page.evaluate(() => window.__worldpulse.counts().rendered)) === countsBefore.rendered);

// Stale toggle, with its own positive control.
await clickOrFail(page, '[data-stale-toggle]', 'stale toggle');
await page.waitForTimeout(500);
const withStale = await page.evaluate(() => window.__worldpulse.counts());
check('including stale events adds exactly the hidden ones',
  withStale.rendered === countsBefore.rendered + countsBefore.staleHidden,
  `${countsBefore.rendered} + ${countsBefore.staleHidden} != ${withStale.rendered}`);
check('positive control: the stale toggle flipped',
  (await page.locator('[data-stale-toggle]').getAttribute('aria-pressed')) === 'true');
await clickOrFail(page, '[data-stale-toggle]', 'stale toggle');
await page.waitForTimeout(400);

// Clustering: an aftershock sequence must remain reachable.
const clusterInfo = await page.evaluate(() => window.__worldpulse.clusterFor('after-0'));
check('an aftershock sequence renders as one marker', clusterInfo !== null && clusterInfo.memberCount === 7,
  JSON.stringify(clusterInfo));
check('the cluster marker sits on the strongest member, not an average',
  clusterInfo !== null && clusterInfo.id === 'after-0', JSON.stringify(clusterInfo));

// Derived centroid must say so on the marker.
const centroidLabel = await page.evaluate(() => window.__worldpulse.tooltipFor('EONET_2'));
check('a polygon-derived marker is labelled DERIVED on the marker itself',
  /badge--derived/.test(centroidLabel ?? '') && /centroid of a 5-vertex perimeter/.test(centroidLabel ?? ''),
  (centroidLabel ?? '').slice(0, 120));
check('the derived marker says it is not the event location',
  /not the\s+event's location/.test(centroidLabel ?? ''));

// The magnitude in a tooltip is a USGS measurement, so it must carry its tier
// rather than print as a bare number. An unreviewed automatic solution reading
// identically to an analyst-reviewed one is exactly the confident-wrong-number
// failure the badge exists to prevent.
const reviewedLabel = await page.evaluate(() => window.__worldpulse.tooltipFor('spread-0'));
const automaticLabel = await page.evaluate(() => window.__worldpulse.tooltipFor('prov-automatic'));
const noMagLabel = await page.evaluate(() => window.__worldpulse.tooltipFor('prov-nomag'));

check('positive control: all three magnitude cases render a tooltip',
  reviewedLabel !== null && automaticLabel !== null && noMagLabel !== null,
  `reviewed ${reviewedLabel !== null}, automatic ${automaticLabel !== null}, none ${noMagLabel !== null}`);
check('a reviewed magnitude is badged OFFICIAL on the marker',
  /badge--official/.test(reviewedLabel ?? ''), (reviewedLabel ?? '').slice(0, 160));
check('an unreviewed automatic magnitude is badged ESTIMATE, not OFFICIAL',
  /badge--estimate/.test(automaticLabel ?? '') && !/badge--official/.test(automaticLabel ?? ''),
  (automaticLabel ?? '').slice(0, 160));
check('the unreviewed magnitude still shows its value and its revision caveat',
  /4\.4/.test(automaticLabel ?? '') && /subject to revision/i.test(automaticLabel ?? ''),
  (automaticLabel ?? '').slice(0, 200));
check('a magnitude the source never published reads "no data", not a number',
  /no data/.test(noMagLabel ?? '') && !/fact-value">[\d.]/.test(noMagLabel ?? ''),
  (noMagLabel ?? '').slice(0, 200));

step('7b — economy fetch states');
// ---- step 7b: the four states the fetch layer introduces ----
//
// Placed AFTER the globe steps deliberately. This block reloads the page five
// times, and running it earlier measurably worsened step 7's marker-click check
// — which is frame-rate sensitive and already the suite's known flake. Five
// extra WebGL context teardowns ahead of it took that check from one failure to
// five. The reloads are necessary; running them before a check they degrade is
// not.
//
// Driven by `?econ=<scenario>`, which installs a deterministic fetcher. Each
// response it serves is marked fromFixture, so a scenario run says on screen
// that it is not live data.
//
// These states are each reachable only through a specific remote failure.
// Demonstrating them against the live World Bank would mean waiting for it to
// break, which is not a test.

/**
 * Switch scenario WITHOUT reloading.
 *
 * Navigating instead of calling this cost step 7 three extra failures: its
 * marker-click check is frame-rate sensitive and is the suite's known flake, and
 * repeated WebGL context teardowns ahead of it made it fail four ways instead of
 * one. Measured, both ways round.
 */
async function openEconomyScenario(scenario) {
  await page.evaluate((name) => window.__worldpulse.setEconScenario(name), scenario);
  await selectCountry('United States');
  await clickOrFail(page, '[data-tab="economy"]', 'economy tab');
  await page.waitForTimeout(600);
}

await openEconomyScenario('loading');
check(
  'a panel awaiting its first response renders a loading state, not an empty one',
  (await page.locator('.econ[data-panel-state="loading"]').count()) === 1,
);
check(
  'the skeleton reserves a block per indicator rather than collapsing the panel',
  (await page.locator('.econ-block--skeleton').count()) > 0,
);
await shot(page, `${SHOTS}/17b-economy-loading.png`);

await openEconomyScenario('unavailable');
const econUnavailable = await textOrFail(page, '.econ', 'unavailable panel');
check(
  'a panel whose every request failed renders unavailable, not "no data"',
  (await page.locator('.econ[data-panel-state="unavailable"]').count()) === 1,
);
check(
  'the unavailable panel says the failure is about our request, not the country',
  /fact about our request/i.test(econUnavailable),
);
check(
  'a failed indicator carries an UNAVAILABLE badge rather than a tier badge',
  (await page.locator('.econ-block .badge--unavailable').count()) > 0 &&
    (await page.locator('.econ-block .badge--official').count()) === 0,
);
check(
  'no failed indicator is worded as the country having no data',
  !/>\s*no data\s*</i.test(await textOrFail(page, '.econ', 'unavailable panel markup', 'innerHTML')),
);
await shot(page, `${SHOTS}/17c-economy-unavailable.png`);

await openEconomyScenario('degraded');
const econDegraded = await textOrFail(page, '.econ', 'degraded panel');
check(
  'a partially-answered panel renders degraded, distinct from both ok and unavailable',
  (await page.locator('.econ[data-panel-state="degraded"]').count()) === 1,
);
check('the degraded panel names what is missing rather than only counting it', /unavailable:/i.test(econDegraded));
check(
  'the indicators that did answer still render their values',
  (await page.locator('.econ-block svg.chart').count()) > 0,
);
await shot(page, `${SHOTS}/17d-economy-degraded.png`);

await openEconomyScenario('stale');
const econCached = await textOrFail(page, '.econ', 'stale panel');
check(
  'a stale value never renders silently — the panel states its age',
  (await page.locator('.econ-stale[data-stale="true"]').count()) === 1 && /ago while refreshing/i.test(econCached),
);
check('the stale notice says these may not be the newest values', /not the newest values/i.test(econCached));
await shot(page, `${SHOTS}/17e-economy-stale.png`);

/**
 * Restore the fixture scenario for the steps that follow.
 *
 * NOT the default app. Every later economy assertion measures text fidelity and
 * layout geometry, which need data that is the same on every run — and the
 * default path is live, so in an environment that cannot reach api.worldbank.org
 * those checks would measure an unavailable panel and report "matched something
 * to measure" failures that say nothing about the geometry they exist to test.
 *
 * The live path is exercised end to end in tests/worldbank-live.test.ts under
 * PROBE_LIVE=1, where a real response can actually be obtained.
 */
await page.evaluate(() => window.__worldpulse.setEconScenario('fixtures'));
await page.waitForTimeout(200);

step('cross-cutting — text fidelity (rule 9)');
// ---- text fidelity (TESTING.md rule 9), retroactive ----

/**
 * B1's new tier label is text, so rule 9 owns it: a label clipped to "Advers…"
 * or to nothing has removed the very channel the dual encoding added. Checked
 * before the economy work below because it belongs to the relations panel, which
 * is already on screen.
 */
await assertTextFits(page, '.relation-list li .relation-tier', 'relation tier labels');

await selectCountry('Germany');
await clickOrFail(page, '[data-tab="economy"]', 'economy tab');
await page.waitForTimeout(400);
await assertTextFits(page, '.econ-block .fact-value', 'economy values');
await assertTextFits(page, '.econ-block .econ-name', 'economy indicator names');
await assertTextFits(page, '.econ-block .econ-asof', 'economy as-of labels');
await assertSvgTextFits(page, '.econ-block .chart-axis', 42, 'economy axis labels');

// The extreme-value fixture: the longest plausible strings on this surface.
await selectCountry('Zimbabwe');
await clickOrFail(page, '[data-tab="economy"]', 'economy tab');
await page.waitForTimeout(400);
await assertTextFits(page, '.econ-block .fact-value', 'economy values at extreme magnitude');
await assertSvgTextFits(page, '.econ-block .chart-axis', 42, 'economy axis labels at extreme magnitude');
const zweAxis = await page.locator('.econ-block[data-indicator="gdp"] .chart-axis').allTextContents();
check('axis labels are compacted, not truncated', zweAxis.every((t) => /^-?[\d.]+[kMBTP]?$|^\d{4}$/.test(t.trim())), zweAxis.join(' | '));

await selectCountry('Germany');
await page.locator('[data-tab="government"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.ministry:not(.ministry--hidden) .ministry-label', 'ministry labels');
await assertTextFits(page, '.ministry:not(.ministry--hidden) .ministry-holder', 'ministry holders');
await assertTextFits(page, '.gov-count', 'cabinet count');

await selectCountry('United Kingdom');
await page.locator('[data-tab="government"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.party-legend .party-name', 'party names');
await assertTextFits(page, '.party-legend .party-seats', 'party seat counts');

// The timeline fixture is mapped to the USA, not the UK. Asserted here against
// the UK, this matched nothing and passed — the Tuvalu bug again, in a check
// written after the rule that forbids it. The helper enforces the control now;
// the selector is aimed at the country that actually has the data.
await selectCountry('United States');
await page.locator('[data-tab="government"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.term .term-dates', 'timeline dates');

await selectCountry('Germany');
await page.locator('[data-tab="news"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.news-item .news-title', 'extreme-length headlines');
await assertTextFits(page, '.news-item .news-outlet', 'extreme-length outlet names');

// Header vitals, which carry population and dates.
await selectCountry('United Kingdom');
await assertTextFits(page, '.dossier-vitals .fact-value', 'header vitals');
await assertTextFits(page, '.portrait-vitals .fact-value', 'portrait vitals');

step('cross-cutting — layout geometry (rule 8)');
// ---- layout geometry at every breakpoint (TESTING.md rule 8) ----
//
// Applied retroactively to the dossier header, whose dual-portrait case
// rendered as overlapping soup with every other assertion green.

for (const breakpoint of BREAKPOINTS) {
  await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
  await page.waitForTimeout(400);

  // Parliamentary: the densest header, two portraits plus captions.
  await selectCountry('United Kingdom');
  await assertLayout(page, '.dossier', ':scope > *', `${breakpoint.name} header rows`);
  await assertLayout(page, '.dossier-main', ':scope > *', `${breakpoint.name} flag and titles`);
  await assertLayout(page, '.dossier-portraits', ':scope > .portrait', `${breakpoint.name} dual portraits`);
  await assertLayout(page, '.dossier-vitals', 'dd', `${breakpoint.name} vitals values`);

  // Rule 1: the widest rule block, with an override citation.
  await selectCountry('Iran');
  await assertLayout(page, '.rule-block', ':scope > *', `${breakpoint.name} rule block`);

  // Government tab: the densest panel in the app. The tab is selected
  // explicitly — a previous section may have left another tab active, and a
  // layout assertion against an absent container is a false pass waiting to
  // happen.
  await selectCountry('United Kingdom');
  await page.locator('[data-tab="government"]').click();
  await page.waitForTimeout(300);
  await assertLayout(page, '.tabs', ':scope > .tab', `${breakpoint.name} tab strip`);
  await assertLayout(page, '.gov', ':scope > .gov-block', `${breakpoint.name} government sections`);
  await assertLayout(page, '.ministry-list', ':scope > .ministry:not(.ministry--hidden)', `${breakpoint.name} ministry rows`);
  await assertLayout(page, '.party-legend', ':scope > li', `${breakpoint.name} party legend`);

  await selectCountry('Germany');
  await page.locator('[data-tab="government"]').click();
  await page.waitForTimeout(300);
  await assertLayout(page, '.ministry-list', ':scope > .ministry:not(.ministry--hidden)', `${breakpoint.name} large cabinet rows`);

  // Economy tab: charts are the first non-list layout in the app.
  await openEconomy('Zimbabwe');
  await assertLayout(page, '.econ', ':scope > .econ-block', `${breakpoint.name} economy blocks`);
  await assertLayout(page, '.econ-block[data-indicator="gdp"]', ':scope > *', `${breakpoint.name} indicator internals`);
  await assertTextFits(page, '.econ-block .fact-value', `${breakpoint.name} economy values`);
  await assertSvgTextFits(page, '.econ-block .chart-axis', 42, `${breakpoint.name} economy axis`);

  // News at every breakpoint: the multiscript feed is where a Latin-calibrated
  // layout fails, and 360px is where nobody screenshots.
  await openNews('Iran');
  await assertLayout(page, '.news-list', ':scope > .news-item', `${breakpoint.name} news rows`);
  await assertTextFits(page, '.news-item .news-title', `${breakpoint.name} RTL headlines`);
  await assertTextFits(page, '.news-item .news-outlet', `${breakpoint.name} RTL outlets`);

  await openNews('Germany');
  await assertTextFits(page, '.news-item .news-title', `${breakpoint.name} extreme headlines`);
  await assertTextFits(page, '.news-item .news-outlet', `${breakpoint.name} extreme outlets`);

  await shot(page, `${SHOTS}/layout-${breakpoint.width}.png`);
}

await page.setViewportSize({ width: 1600, height: 950 });
await selectCountry('United Kingdom');
await page.waitForTimeout(400);

// Self-test: the geometry harness must be able to fail. Recreate the exact bug
// it was written for — the portraits laid back beside the title block, which is
// what produced the overlapping soup — and confirm it is caught.
const injected = await page.addStyleTag({
  content: `.dossier { position: relative; }
            .dossier-portraits { position: absolute; top: 0; left: 0; right: 0;
              margin-top: 0; padding-top: 0; border-top: none; }`,
});
await page.waitForTimeout(300);

const caughtOverlap = await (async () => {
  const before = failures.length;
  await assertLayout(page, '.dossier', ':scope > *', 'self-test (expected to fail)');
  const detected = failures.length > before;
  if (detected) unfail(); // the failure was the point
  return detected;
})();
check('the layout harness detects an overlap it is shown', caughtOverlap,
  'a geometry check that cannot fail is not a check');

await injected.evaluate((node) => node.remove());
await page.waitForTimeout(300);
await assertLayout(page, '.dossier', ':scope > *', 'header recovers after self-test');

// Second self-test: a row squashed until its content is clipped away.
//
// The overlap case above was the only thing this harness had ever been shown
// failing, and that was not enough — "collapsed" was defined as exactly zero
// height, so a row at 2px with its text clipped entirely away passed as healthy.
// A mutation proved it by surviving. The check that replaced it now gets its own
// proof, because every presence and text assertion passes on such a row: this
// geometry check is the only thing between that defect and a green suite.
await selectCountry('United Kingdom');
await page.locator('[data-tab="government"]').click();
await page.waitForTimeout(400);
await assertLayout(page, '.party-legend', ':scope > li', 'party legend before the collapse self-test');

const squashed = await page.addStyleTag({
  content: '.party-legend li { height: 0 !important; overflow: hidden !important; }',
});
await page.waitForTimeout(300);

const caughtClip = await (async () => {
  const before = failures.length;
  await assertLayout(page, '.party-legend', ':scope > li', 'collapse self-test (expected to fail)');
  const detected = failures.length > before;
  if (detected) unfail(); // the failure was the point
  return detected;
})();
check('the layout harness detects a row clipped to a sliver', caughtClip,
  'a 2px row with its text clipped away is invisible, and presence checks pass on it');

await squashed.evaluate((node) => node.remove());
await page.waitForTimeout(300);
await assertLayout(page, '.party-legend', ':scope > li', 'party legend recovers after collapse self-test');

await browser.close();
report();
