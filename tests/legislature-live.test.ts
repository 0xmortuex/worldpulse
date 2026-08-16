import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadLegislatureLive } from '../src/dossier/legislature-live';
import { fetcherFor } from '../src/fetch/scenario';

/**
 * The first panel converted through the generalised scenario harness.
 *
 * All four fetch states are driven here, because that is what the
 * generalisation was for: they are properties of the TRANSPORT, and a harness
 * that only ever proved them for the World Bank had proved them for one source.
 */

describe('legislature: the four fetch states, on a second source', () => {
  it('ok — chambers parse from the captured response', async () => {
    const load = await loadLegislatureLive(fetcherFor('?econ=ok'), 'GBR');
    assert.equal(load.failure, null);
    assert.ok(load.chambers);
    assert.deepEqual(
      load.chambers.map((chamber) => chamber.label).sort(),
      ['House of Commons', 'House of Lords'],
      'the parent-body defect is back, or the fixture changed',
    );
  });

  it('and the provenance names WIKIDATA, not the World Bank', async () => {
    /**
     * The subtlest part of the old harness: it hardcoded `api.worldbank.org`
     * into every URL it reported, and the inspector renders that URL to the
     * reader. A Wikidata request claiming a World Bank origin is a false
     * provenance — the failure class this whole project is built around.
     */
    const load = await loadLegislatureLive(fetcherFor('?econ=ok'), 'GBR');
    assert.match(load.ctx?.requestUrl ?? '', /query\.wikidata\.org/);
    assert.doesNotMatch(load.ctx?.requestUrl ?? '', /worldbank/);
    assert.equal(load.ctx?.fromFixture, true, 'a scenario response must announce it is not live');
  });

  it('unavailable — a failed request is a failure, not an empty legislature', async () => {
    /**
     * The distinction the panel depends on. An empty chamber list renders "no
     * chambers are recorded for this country", which is a claim about our
     * source's coverage. A failed request is a claim about the request. The
     * loader must not turn the second into the first.
     */
    const load = await loadLegislatureLive(fetcherFor('?econ=unavailable'), 'GBR');
    assert.equal(load.chambers, null, 'a failed request produced a chamber list');
    assert.ok(load.failure);
    assert.equal(load.failure.sourceId, 'wikidata-sparql');
    assert.match(load.failure.requestUrl, /query\.wikidata\.org/);
  });

  it('stale — the body is served, and announces its age', async () => {
    const load = await loadLegislatureLive(fetcherFor('?econ=stale'), 'GBR');
    assert.ok(load.chambers, 'a stale response must still be servable');
    assert.equal(load.ctx?.cache, 'stale-revalidating');
  });

  it('degraded — one country answers and another does not', async () => {
    /**
     * Partial by construction. A degraded state where every country fails is
     * indistinguishable from `unavailable`, which would leave one of the four
     * states untested while looking covered.
     */
    const answered = await loadLegislatureLive(fetcherFor('?econ=degraded'), 'GBR');
    const refused = await loadLegislatureLive(fetcherFor('?econ=degraded'), 'ISL');

    assert.ok(answered.chambers, 'the answering country did not answer');
    assert.equal(refused.chambers, null, 'the refusing country answered — degraded is not partial');
  });

  it('loading — an aborted request resolves rather than wedging the panel', async () => {
    const controller = new AbortController();
    controller.abort();
    const load = await loadLegislatureLive(fetcherFor('?econ=loading'), 'GBR', { signal: controller.signal });
    assert.equal(load.chambers, null);
    assert.ok(load.failure);
  });

  it('fixtures — a country with no capture FAILS rather than reading as empty', async () => {
    // Rendering "no chambers recorded" for a country we simply never captured
    // would assert something about that country that no source told us.
    const load = await loadLegislatureLive(fetcherFor('?econ=fixtures'), 'FRA');
    assert.equal(load.chambers, null);
    assert.ok(load.failure);
  });

  it('fixtures — a captured country is served', async () => {
    // Positive control: without it the test above passes on a broken handler.
    const load = await loadLegislatureLive(fetcherFor('?econ=fixtures'), 'ISL');
    assert.ok(load.chambers);
    assert.equal(load.chambers[0]?.label, 'Althing');
  });
});
