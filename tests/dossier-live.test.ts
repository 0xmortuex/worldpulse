import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadDossierLive } from '../src/dossier/dossier-live';
import { fetcherFor } from '../src/fetch/scenario';

/**
 * The second panel through the generalised harness.
 *
 * The point of a second one is not more coverage of the same thing — it is
 * whether the harness generalises at all. A registry that dispatches two
 * sources and a loader shape that survives being copied are the evidence; a
 * third conversion should be mechanical.
 */

describe('dossier: the harness carries a second consumer of the same source', () => {
  it('a failed request is a failure, not a country with no data', async () => {
    /**
     * Sharper here than on the legislature panel. `parseCountryDossier` has no
     * "empty" middle case — a country either has a Wikidata entity or the
     * response cannot be read — so a thrown parse is ALWAYS a failed request.
     * The header must never offer the second reading.
     */
    const load = await loadDossierLive(fetcherFor('?econ=unavailable'), 'GBR');
    assert.equal(load.record, null);
    assert.ok(load.failure);
    assert.equal(load.failure.sourceId, 'wikidata-sparql');
  });

  it('the provenance names Wikidata, not the World Bank', async () => {
    // The hardcoded-origin defect, asserted on the second consumer too: one
    // panel getting it right proves the handler, not the harness.
    const load = await loadDossierLive(fetcherFor('?econ=unavailable'), 'GBR');
    assert.match(load.failure?.requestUrl ?? '', /query\.wikidata\.org/);
    assert.doesNotMatch(load.failure?.requestUrl ?? '', /worldbank/);
  });

  it('an aborted load resolves rather than wedging the header', async () => {
    const controller = new AbortController();
    controller.abort();
    const load = await loadDossierLive(fetcherFor('?econ=loading'), 'GBR', { signal: controller.signal });
    assert.equal(load.record, null);
    assert.ok(load.failure);
  });

  it('a source with no dossier capture FAILS rather than reading as empty', async () => {
    /**
     * The scenario handler serves legislature captures, which
     * `parseCountryDossier` cannot read — so this exercises the parse-failure
     * path with a REAL mismatched body rather than a synthetic one, and
     * confirms the loader turns it into a failure rather than a null record
     * that the header would render as "no data".
     */
    const load = await loadDossierLive(fetcherFor('?econ=fixtures'), 'GBR');
    assert.equal(load.record, null);
    assert.ok(load.failure, 'an unreadable body produced no failure');
    assert.equal(load.failure.reason, 'shape', 'a shape failure was reported as something else');
  });
});
