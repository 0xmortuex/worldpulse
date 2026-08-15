/**
 * Does each source's licence class match what the app actually does with it?
 *
 * ## Why this exists
 *
 * `restricted` used to mean two different things at once. Its written definition
 * was "No licence grant for reuse. Not ingested. Link-out only." — and fifteen
 * RSS feeds carried it while being ingested every render, rendering headline,
 * outlet, timestamp and link. The description was strictly correct and the
 * practice was defensible; what was wrong was that one name covered both, so
 * neither could be checked.
 *
 * Stretching the description to fit would have made the strict posture
 * unavailable — and some future source will need exactly it. So the class was
 * split, and this guard is what stops the split from decaying back into one
 * meaning by convention:
 *
 *   restricted          no grant, NOT ingested, link-out only
 *   restricted-minimal  no general grant; minimal attributed elements ingested;
 *                       never bulk redistribution
 *
 * ## What makes ingestion checkable
 *
 * `transport` is the app declaring how it fetches a source. A source the app
 * never fetches has no transport to declare, so **a strict `restricted` source
 * with a transport is a contradiction in the registry itself** — the licence
 * says we do not ingest it and the transport says how we do.
 *
 * Pure, per rule 32: the caller reads the registry and passes it in.
 */

/**
 * Which classes actually express each obligation.
 *
 * A licence text saying "NonCommercial" and a class that does not carry the
 * non-commercial constraint is a source whose obligation exists only in prose —
 * which is how `restricted` came to cover two postures, and how WHO's
 * CC BY-NC-SA sat in `share-alike` with its NC term recorded nowhere a check
 * could see it.
 */
/**
 * Satisfied A FORTIORI, not only by exact match.
 *
 * `restricted` and `restricted-minimal` grant less than NC or SA require, so a
 * source held under either is already being treated more conservatively than the
 * licence demands. Requiring an exact class there would force a WEAKER
 * classification onto four RSS feeds to satisfy a guard — the guard bending the
 * data rather than describing it.
 *
 * `restricted-minimal` satisfies share-alike for the same reason from the other
 * end: it ingests a headline, a timestamp and a link, which creates no derived
 * dataset for copyleft to be viral into.
 *
 * What this still catches is the case it was built for: a class that expresses
 * ONE of two obligations and silently drops the other.
 */
const SATISFIES_NC = new Set(['nc', 'share-alike-nc', 'restricted-minimal', 'restricted']);
const SATISFIES_SA = new Set(['share-alike', 'share-alike-nc', 'restricted-minimal', 'restricted']);

/** Does the licence TEXT claim an obligation the CLASS has to carry? */
const CLAIMS_NC = /\bNC\b|non-?commercial/i;
const CLAIMS_SA = /\bSA\b|share-?alike/i;

/**
 * @param {{sources: Array<Record<string, unknown>>}} registry
 * @returns {string[]} one problem per contradiction, empty when consistent
 */
export function licenceProblems(registry) {
  const problems = [];

  for (const source of registry.sources) {
    if (source.excluded) continue;
    const id = source.id;

    if (source.licenseClass === 'restricted' && source.transport !== undefined) {
      problems.push(
        `${id}: licenceClass "restricted" means not ingested, link-out only — ` +
          `but it declares transport "${source.transport}", which is the app saying how it fetches it. ` +
          'Use "restricted-minimal" if minimal attributed elements are genuinely ingested, ' +
          'or remove the transport if they are not',
      );
    }

    /**
     * THE CLASS MUST CARRY EVERY OBLIGATION THE LICENCE TEXT CLAIMS.
     *
     * Fail closed: a licence saying NonCommercial and a class that does not
     * express it leaves the constraint in prose, where no check can enforce it
     * and a future reader may reasonably assume it was considered. WHO's
     * CC BY-NC-SA sat in `share-alike` exactly this way — the SA obligation was
     * carried, the NC obligation was not, and the registry looked consistent.
     *
     * Read from the licence STRING rather than a curated flag, because the
     * string is what someone transcribes from the source and is the last place a
     * mistake can still be caught mechanically.
     */
    const licence = String(source.license ?? '');

    if (CLAIMS_NC.test(licence) && !SATISFIES_NC.has(String(source.licenseClass))) {
      problems.push(
        `${id}: licence text claims a non-commercial term ("${licence.slice(0, 48)}…") but ` +
          `licenceClass "${source.licenseClass}" does not express it — use "nc" or "share-alike-nc"`,
      );
    }

    if (CLAIMS_SA.test(licence) && !SATISFIES_SA.has(String(source.licenseClass))) {
      problems.push(
        `${id}: licence text claims a share-alike term ("${licence.slice(0, 48)}…") but ` +
          `licenceClass "${source.licenseClass}" does not express it — use "share-alike" or "share-alike-nc"`,
      );
    }

    /**
     * A minimal-ingest posture is only honest if the attribution it rests on
     * actually exists. The licence grants nothing; attribution is the whole
     * basis for rendering anything at all.
     */
    if (source.licenseClass === 'restricted-minimal') {
      const attribution = String(source.attribution ?? '').trim();
      if (attribution === '') {
        problems.push(
          `${id}: licenceClass "restricted-minimal" ingests attributed elements, ` +
            'but the source declares no attribution text to render',
        );
      }
    }
  }

  return problems;
}
