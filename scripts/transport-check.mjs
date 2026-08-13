/**
 * Does each source's declared `transport` match what the probe measured?
 *
 * `transport` decides whether the browser calls an origin directly or goes
 * through the Worker. It is derived from the probe verdict — and then it sits in
 * a JSON file that anyone can edit, with nothing checking it afterwards.
 *
 * This is the same shape as the `verifiedAgainst` cast that went unnoticed for
 * two whole steps: a value that was correct when written, in a place where being
 * wrong later is silent. Getting it wrong is not cosmetic in either direction:
 *
 *   direct where the browser cannot read the response  → a panel that fails in
 *     the user's browser and passes every test here
 *   worker where direct would work  → an unnecessary proxy hop through
 *     infrastructure we pay for and rate-limit
 *
 * Pure, per rule 32: the caller reads both files and passes them in.
 */

/** Probe verdict → the transport it implies. Others imply nothing. */
const IMPLIED = {
  'CLIENT-FETCH': 'direct',
  'WORKER-REQUIRED': 'worker',
  'KEY-GATED': 'worker',
};

/**
 * @param {{sources: Array<object>}} registry
 * @param {Array<{id: string, verdict: string}>} probeResults
 * @returns {string[]} one problem per disagreement, empty when consistent
 */
export function transportProblems(registry, probeResults) {
  const verdicts = new Map(probeResults.map((row) => [row.id, row.verdict]));
  const problems = [];

  for (const source of registry.sources) {
    if (source.excluded) continue;

    const verdict = verdicts.get(source.id);
    const declared = source.transport;

    /**
     * A secret key forces the Worker whatever the probe saw, because the
     * question is not "can the browser read this" but "may the browser hold the
     * key". Checked before the verdict comparison for the same reason the probe
     * scores KEY-GATED above a permissive ACAO.
     */
    const keyIsSecret = Boolean(source.keyRequired) && !(source.keyEnv ?? '').startsWith('VITE_');
    if (keyIsSecret && declared !== undefined && declared !== 'worker') {
      problems.push(
        `${source.id}: transport is "${declared}" but ${source.keyEnv} is a server-side key — ` +
          'a direct transport would put the key in the browser',
      );
      continue;
    }

    if (verdict === undefined) {
      // Never probed. Absent transport is the correct state; a declared one is
      // a value nobody measured.
      if (declared !== undefined && !keyIsSecret) {
        problems.push(
          `${source.id}: transport is "${declared}" but the source has no probe verdict — ` +
            'run `npm run probe`, or remove the field until it has been measured',
        );
      }
      continue;
    }

    const implied = IMPLIED[verdict];
    if (implied === undefined) {
      // INCONCLUSIVE / UNREACHABLE imply nothing. Rule 30: the probe declined to
      // answer, which is not an answer of "direct".
      if (declared !== undefined && !keyIsSecret) {
        problems.push(
          `${source.id}: transport is "${declared}" but the probe verdict is ${verdict}, ` +
            'which says nothing about the success path — re-probe rather than guessing',
        );
      }
      continue;
    }

    if (declared === undefined) {
      problems.push(`${source.id}: probe says ${verdict} but no transport is declared`);
      continue;
    }

    if (declared !== implied && !(keyIsSecret && declared === 'worker')) {
      problems.push(
        `${source.id}: transport is "${declared}" but the probe measured ${verdict}, which implies "${implied}"`,
      );
    }
  }

  return problems;
}
