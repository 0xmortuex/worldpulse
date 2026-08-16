/**
 * Fail with a sentence, not a stack trace.
 *
 * ## Why this exists
 *
 * Reported from a fresh clone on Node 18.20.4: `npm run dev` died inside
 * rolldown with
 *
 *     SyntaxError: The requested module 'node:util' does not provide an
 *     export named 'styleText'
 *
 * which tells a reader nothing about what to do. A first-run failure that
 * blames a bundler for a version problem is the doc-versus-tree class arriving
 * at the front door: the repository's requirements were real and written down
 * nowhere the tooling could enforce.
 *
 * ## The floor, and how it was derived
 *
 * Three features set it, and the highest wins. Each is listed so the number is
 * checkable rather than folklore:
 *
 * | Feature | Used by | Landed in |
 * | --- | --- | --- |
 * | `import.meta.dirname` | 27 call sites across src, scripts and tests | 20.11.0 |
 * | `util.styleText` | rolldown, our bundler — the reported crash | 20.12.0 |
 * | `--env-file-if-exists` | `npm run probe` | 20.18.0 |
 *
 * **Derived, not measured on those versions.** This machine runs Node 24, and
 * no Node 18 or 20 install was available to confirm the boundary empirically.
 * The requirement is stated from the features the code actually uses; if
 * someone finds a lower version that genuinely works, that is a measurement and
 * it beats this reasoning.
 */

const MINIMUM = [20, 18, 0];
const REASON = '--env-file-if-exists (npm run probe); styleText for rolldown needs 20.12, import.meta.dirname 20.11';

/** Exported so the rule can be driven at boundaries without spawning node. */
export function versionProblem(actual, minimum = MINIMUM) {
  const parts = String(actual).replace(/^v/, '').split('.').map((piece) => Number.parseInt(piece, 10));

  // An unparseable version is not evidence of anything. Rule 3: report the
  // inconclusive case rather than resolving it in whichever direction is
  // convenient — blocking a working install would be worse than the problem.
  if (parts.some((piece) => !Number.isFinite(piece))) return null;

  for (let index = 0; index < minimum.length; index += 1) {
    const have = parts[index] ?? 0;
    const need = minimum[index] ?? 0;
    if (have > need) return null;
    if (have < need) {
      return {
        actual: String(actual).replace(/^v/, ''),
        required: minimum.join('.'),
      };
    }
  }
  return null;
}

if (import.meta.filename === process.argv[1]) {
  const problem = versionProblem(process.versions.node);
  if (problem) {
    process.stderr.write(
      `\nworldpulse needs Node ${problem.required} or newer. You are running ${problem.actual}.\n\n` +
        `  Why: ${REASON}\n\n` +
        '  On an older Node this fails inside the bundler with a message about\n' +
        "  'styleText' missing from node:util, which is a symptom rather than the cause.\n\n" +
        '  Install a current LTS (nvm install --lts) and run this again.\n\n',
    );
    process.exit(1);
  }
}
