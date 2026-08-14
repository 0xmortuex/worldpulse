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
