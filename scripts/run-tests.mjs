/**
 * Run the unit suite, and fail if it ran nothing.
 *
 * Two separate hazards, both of which produce a green exit over zero coverage:
 *
 * 1. The glob. `tsx --test 'tests/*.test.ts'` works in a POSIX shell and matches
 *    NOTHING on Windows, where cmd.exe does not strip single quotes — node then
 *    receives a pattern with literal quote characters in it. `npm test` printed
 *    "tests 0" and exited 0. Passing the pattern from here, rather than through
 *    a shell, removes the quoting question entirely.
 *
 * 2. Zero tests exiting zero. Node's test runner is happy to run nothing and
 *    report success, so a broken pattern, a renamed directory or a bad filter
 *    all look exactly like a passing suite. This is the same failure as the
 *    stale bundle and the empty selector: a result that covers nothing, printed
 *    in the same green as a result that covers everything.
 *
 * So the count is asserted. Below the floor is a failure regardless of what the
 * runner said.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { judgeTestRun } from './test-count.mjs';
import { censusProblems, declaredSuites, parseSuiteCounts } from './suite-census.mjs';


// Resolved rather than looked up on PATH: `tsx` is only on PATH when npm puts
// it there, so invoking this script directly found no binary, ran nothing, and
// leaned on the guard below to notice. A runner that works only under `npm test`
// is a runner that quietly does nothing everywhere else.
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

/**
 * Overridable so the guard below can be SHOWN to fire:
 *
 *   WORLDPULSE_TEST_GLOB=tests/nothing-here/*.test.ts npm test   # must exit 1
 *
 * Pointing it at anything empty is a loud failure by design, which is the whole
 * point — a guard that has never been observed failing is not a guard, and this
 * one exists because a suite that ran nothing exited zero.
 */
const pattern = process.env['WORLDPULSE_TEST_GLOB'] ?? 'tests/*.test.ts';

/**
 * TAP goes to a file alongside the human-readable spec output.
 *
 * The spec reporter names a file only when it fails, so a suite that ran zero
 * tests is invisible in it. TAP nests every suite and every assertion, which is
 * what makes "ran three of eleven" distinguishable from "passed".
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CENSUS_PATH = join(ROOT, 'tests/suite-census.json');
const tapDir = mkdtempSync(join(tmpdir(), 'worldpulse-tap-'));
const tapPath = join(tapDir, 'run.tap');

const args = [
  /**
   * Load `.env` so the checks that need real key values can actually run.
   *
   * Without this the secret scan reported "no keys configured, nothing to look
   * for" on every run — honest, and useless: the guard that exists to keep a key
   * out of committed provenance had no key to look for. A guard that cannot fire
   * on the machine where the secrets live is not a guard.
   *
   * `--env-file-if-exists` rather than `--env-file`: a checkout without a `.env`
   * must still run its tests, and a missing file is a degraded state here
   * exactly as it is for every key-gated panel.
   */
  '--env-file-if-exists=.env',
  tsxCli,
  '--test',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=tap',
  `--test-reporter-destination=${tapPath}`,
  pattern,
  ...process.argv.slice(2),
];
const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'inherit'] });

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});

child.on('close', (code) => {
  // The judgement lives in test-count.mjs so a planted case can drive it
  // (rule 32). This is the guard that stops every other test from passing
  // vacuously, and it was the last one reachable only by running the suite it
  // protects.
  const verdict = judgeTestRun(output);
  if (!verdict.ok) {
    console.error(`\n${verdict.problem}`);
    process.exit(1);
  }

  /**
   * The per-suite census. The total-count floor above catches a suite that ran
   * nothing; this catches a suite that ran *most* things, which is what nine
   * crashed imports looked like — 381 tests reported where 496 existed, with
   * only a failure count to say so.
   *
   * `WORLDPULSE_TEST_CENSUS=write` records the current run as the baseline.
   * It is deliberately explicit: a baseline that rewrote itself on every run
   * would ratify whatever just happened, including a crash.
   */
  let observed = {};
  try {
    observed = parseSuiteCounts(readFileSync(tapPath, 'utf8'));
  } catch {
    console.error('\ncould not read TAP output — the per-suite census did not run');
    process.exit(1);
  } finally {
    rmSync(tapDir, { recursive: true, force: true });
  }

  if (process.env['WORLDPULSE_TEST_CENSUS'] === 'write') {
    const sorted = Object.fromEntries(Object.entries(observed).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(CENSUS_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
    console.error(`\nwrote suite census: ${Object.keys(sorted).length} suites`);
    process.exit(code ?? 0);
  }

  if (existsSync(CENSUS_PATH)) {
    const baseline = JSON.parse(readFileSync(CENSUS_PATH, 'utf8'));

    // Which suites does the tree still declare? A suite that vanished because
    // its file was deleted is a baseline update; one that vanished while still
    // declared did not run, and that is the failure.
    const declared = new Set();
    for (const name of readdirSync(join(ROOT, 'tests'))) {
      if (!name.endsWith('.test.ts')) continue;
      for (const suite of declaredSuites(readFileSync(join(ROOT, 'tests', name), 'utf8'))) declared.add(suite);
    }

    const { problems, drifted } = censusProblems(baseline, observed, declared);
    for (const note of drifted) console.error(`census drift: ${note}`);
    if (problems.length > 0) {
      console.error(`\nSUITE CENSUS FAILED — ${problems.length} suite(s) were meant to run and did not:`);
      for (const problem of problems) console.error(`  ${problem}`);
      console.error('\nRe-record with WORLDPULSE_TEST_CENSUS=write once the cause is fixed.');
      process.exit(1);
    }
  }

  process.exit(code ?? 0);
});
