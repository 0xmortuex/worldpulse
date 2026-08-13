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
import { judgeTestRun } from './test-count.mjs';


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
const args = [tsxCli, '--test', pattern, ...process.argv.slice(2)];
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

  process.exit(code ?? 0);
});
