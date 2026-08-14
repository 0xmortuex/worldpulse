/**
 * Which suites ran, and how many tests each contributed.
 *
 * ## Why the total is not enough
 *
 * `MINIMUM_TESTS` catches a suite that ran nothing. It cannot catch a suite that
 * ran *most* things. Adding one value to a registry enum made nine test FILES
 * crash at import; the runner reported `tests 381` where it had reported `496`,
 * and `fail 9`. Nine failures is what a reader sees — but **115 tests did not
 * run at all**, and every assertion in those files was silently skipped. The
 * floor was clear at 381, so nothing fired.
 *
 * That is vacuity mechanism 1 wearing different clothes: a suite that shrinks
 * silently passes over everything the missing files asserted, and the summary
 * line looks like a normal bad afternoon rather than a hole.
 *
 * ## What this distinguishes
 *
 * A suite in the baseline that contributes nothing is one of two events, and
 * they have different fixes:
 *
 *   CRASHED   the file still declares the suite, so it was meant to run and
 *             didn't — an import error, a top-level throw. This is a failure.
 *   REMOVED   nothing declares the suite any more, so it was deleted on
 *             purpose. This is a baseline update, not a defect.
 *
 * Guessing between them would be wrong half the time, so the caller supplies
 * the set of suite names still declared on disk and this decides.
 *
 * Pure, per rule 32: no I/O, so every state is reachable from a planted case.
 */

/**
 * Count tests per top-level suite from TAP output.
 *
 * TAP nests by indentation: `# Subtest: <name>` at column 0 opens a suite, and
 * its tests arrive as `    ok N - ...` indented beneath. Counting the indented
 * assertions rather than the top-level `ok` lines is what makes a partial run
 * visible — a suite that ran three of eleven is not a suite that passed.
 *
 * @param {string} tap
 * @returns {Record<string, number>}
 */
export function parseSuiteCounts(tap) {
  const counts = {};
  let current = null;

  for (const line of tap.split(/\r?\n/)) {
    const top = line.match(/^# Subtest: (.+)$/);
    if (top) {
      current = top[1];
      counts[current] ??= 0;
      continue;
    }
    // Indented assertions belong to the open suite. `ok`/`not ok` both count:
    // a failing test still RAN, and this guard is about tests that did not.
    if (current !== null && /^\s+(ok|not ok) \d+ - /.test(line)) counts[current] += 1;
  }

  return counts;
}

/**
 * @param {Record<string, number>} baseline   suite -> count, as recorded
 * @param {Record<string, number>} observed   suite -> count, this run
 * @param {Set<string>} declared              suite names still declared on disk
 * @returns {{ problems: string[], drifted: string[] }}
 */
export function censusProblems(baseline, observed, declared) {
  const problems = [];
  const drifted = [];

  for (const [suite, expected] of Object.entries(baseline)) {
    const ran = observed[suite] ?? 0;

    /**
     * A suite whose baseline is already 0 contributes 0 correctly.
     *
     * `describe(..., { skip })` suites — the `PROBE_LIVE`-gated live checks —
     * run no tests by design, every run. Flagging them would fire on every
     * healthy suite, and a guard that cries wolf on a normal run is one people
     * learn to skip past, which is rule 15's whole argument.
     *
     * Found by planting the crash this guard was built for and watching it
     * report two suites when one had crashed.
     */
    if (expected === 0) continue;

    if (ran === 0) {
      if (declared.has(suite)) {
        problems.push(
          `suite "${suite}" contributed 0 tests but is still declared — ` +
            `it was meant to run ${expected} and did not. A crashed import or a top-level throw ` +
            'skips every assertion in its file while the summary reports only a failure count',
        );
      } else {
        drifted.push(`suite "${suite}" is gone from the tree (was ${expected}) — update the census baseline`);
      }
      continue;
    }

    /**
     * A suite that shrank still ran, so it is drift rather than a crash — but
     * it is reported, because tests silently disappearing one at a time is the
     * slow version of the same failure.
     */
    if (ran < expected) {
      drifted.push(`suite "${suite}" ran ${ran} tests, baseline says ${expected}`);
    }
  }

  return { problems, drifted };
}

/**
 * Suite names declared by a test file's source.
 *
 * Deliberately syntactic: it reads `describe('name'` and nothing cleverer. A
 * dynamic suite name would be missed, and the consequence of missing one is a
 * REMOVED verdict where CRASHED was true — reported either way, just filed
 * differently. Worth the simplicity.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function declaredSuites(source) {
  const names = [];
  const pattern = /\bdescribe\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match;
  while ((match = pattern.exec(source)) !== null) names.push(match[2]);
  return names;
}
