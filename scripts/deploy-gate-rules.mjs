/**
 * The deploy gate's per-source verdict, as a pure function.
 *
 * Extracted from check-deploy-gate.mjs so it can be run against a PLANTED
 * VIOLATION as well as against the real registry. TESTING.md rule 27: a guard
 * without a permanent planted case is unverified, and a guard embedded in the
 * loop that uses it cannot be pointed at a synthetic input without inventing a
 * whole registry.
 *
 * Pure by construction — every input is passed in, including whether an evidence
 * file exists, so the caller does the I/O and the rule does the deciding.
 */

/**
 * @param {{ id: string, verifiedAgainst?: string }} source
 * @param {{
 *   fixtureIds: Set<string>,
 *   contractIds: Set<string>,
 *   bundledEvidence: Record<string, string>,
 *   evidenceExists: (path: string) => boolean,
 * }} world
 * @returns {{ status: string, detail: string, problem: string | null }}
 */
export function verdictFor(source, world) {
  const status = source.verifiedAgainst ?? 'documentation';

  if (status === 'bundled') {
    const evidence = world.bundledEvidence[source.id];
    if (!evidence) {
      return {
        status,
        detail: 'NO EVIDENCE REGISTERED',
        problem: `${source.id}: claims "bundled" but no byte-level shape assertion is registered for it`,
      };
    }
    if (!world.evidenceExists(evidence)) {
      return {
        status,
        detail: `missing ${evidence}`,
        problem: `${source.id}: claims "bundled" but its evidence file ${evidence} is missing`,
      };
    }
    return { status, detail: `asserted by ${evidence}`, problem: null };
  }

  if (status === 'documentation') {
    return {
      status,
      detail: 'never seen a live response',
      problem: `${source.id}: contract read from documentation only, never confirmed against a live response`,
    };
  }

  if (status === 'live') {
    // "Live" requires a registered fixture AND a contract test naming the
    // source. Confirming a response by hand and flipping the flag leaves
    // nothing that would notice the shape drifting tomorrow — which is how
    // nasa-eonet, wikipedia-rest and wikimedia-commons came to have shipped
    // panels with no fixture, no contract test and no recorded shape.
    const missing = [];
    if (!world.fixtureIds.has(source.id)) missing.push('no fixture registered in tests/fixtures/index.ts');
    if (!world.contractIds.has(source.id)) missing.push('no contract test names it in tests/contracts.test.ts');
    if (missing.length > 0) {
      return {
        status,
        detail: `LIVE WITHOUT COVERAGE — ${missing.join('; ')}`,
        problem: `${source.id}: claims "live" but ${missing.join(' and ')}`,
      };
    }
    return {
      status,
      detail: 'confirmed against a live response, fixture and contract test registered',
      problem: null,
    };
  }

  return {
    status,
    detail: 'unknown status',
    problem: `${source.id}: unknown verifiedAgainst value ${JSON.stringify(status)}`,
  };
}
