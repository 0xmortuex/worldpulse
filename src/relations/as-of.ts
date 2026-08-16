import type { Finding } from './types';

/**
 * Step 13's time scrub — scoring a pair as of a past date.
 *
 * ## The architectural constraint, and why it is the whole design
 *
 * `BUILD-ORDER` specifies: **the scrub must score a pair as of a past date
 * without the scoring module knowing about time.**
 *
 * That is not a style preference. A scoring engine that takes a date is one
 * that has to be re-verified for every date — every branch, every threshold,
 * every tier boundary, times however many years the scrub covers. Keeping time
 * out of it means the engine has exactly one behaviour, already tested, and the
 * time dimension lives in **what is fed to it**.
 *
 * So `score()` keeps its signature. This module answers a different question:
 * *which findings existed as of year Y*, and hands the survivors over.
 *
 * ## What "existed as of Y" can and cannot mean here
 *
 * A `Finding` records `coverageEnd` — the year through which its dataset is
 * asserted to hold. It does **not** record when the fact began. So this can
 * honestly answer "was this finding's evidence current as of Y" and cannot
 * answer "was this relationship true in Y".
 *
 * The difference matters and is stated on the surface rather than buried:
 * scrubbing to 2015 shows **what this app would have said in 2015 from the
 * evidence it holds now**, which is not the same as what was true in 2015 and
 * not the same as what the app would have said in 2015.
 */

/**
 * Findings whose evidence was current as of `year`.
 *
 * A finding with `coverageEnd` in the future relative to `year` is excluded:
 * its dataset had not yet been compiled, so using it would let the scrub see
 * evidence that did not exist at the date being shown — which would make every
 * past year look better-evidenced than it was.
 */
export function findingsAsOf(findings: readonly Finding[] | undefined, year: number): Finding[] {
  if (!findings) return [];
  return findings.filter((finding) => finding.coverageEnd <= year);
}

/**
 * The earliest year worth scrubbing to, from the data itself.
 *
 * Hardcoding a floor would either cut off real evidence or offer years where
 * every pair reads as `nodata` — a scrub that spends half its travel showing
 * nothing teaches the reader that the control is broken.
 */
export function earliestYear(all: Iterable<readonly Finding[]>): number | null {
  let earliest: number | null = null;
  for (const findings of all) {
    for (const finding of findings) {
      if (earliest === null || finding.coverageEnd < earliest) earliest = finding.coverageEnd;
    }
  }
  return earliest;
}

/**
 * The sentence the scrub shows when it is not at the present.
 *
 * It says three things a reader needs and would otherwise assume wrongly:
 * that this is our evidence rather than the past's, that findings are excluded
 * rather than reweighted, and how many were excluded — because a scrub that
 * silently drops half the evidence looks like a country that simply had fewer
 * relationships.
 */
export function asOfCaveat(year: number, excluded: number, total: number): string {
  return (
    `As of ${year}: showing only the ${total - excluded} of ${total} findings whose evidence was ` +
    `current by then. This is what this app's PRESENT evidence says about ${year} — not what was ` +
    'known in ' +
    `${year}, and not a claim about what was true.`
  );
}
