import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetcherFor, registerScenarioSource, registeredScenarioSources } from '../src/fetch/scenario';

/**
 * The scenario harness, generalised — item 4e's gating piece.
 *
 * It was World-Bank-shaped, because it was built for the one panel that needed
 * it: it read `spec.path.split('/indicator/')`, branched on `NY.GDP`, and
 * hardcoded `api.worldbank.org` into every URL it reported. `PROGRESS.md`
 * recorded that as the blocker gating three otherwise-ready panels —
 * legislature, government and the dossier header all fetch from
 * `wikidata-sparql`, which is CLIENT-FETCH with a 146-byte probe response.
 *
 * The dispatch key was already present on every request: `sourceId`.
 */

const spec = (sourceId: string) => ({ sourceId, path: '/v2/country/USA/indicator/NY.GDP.MKTP.CD' });

describe('the scenario harness dispatches on source', () => {
  it('the registry is populated, or every test below is vacuous', () => {
    /**
     * Rule 27's shape, and the fourth time this session a check needed its own
     * denominator asserted: a registry that is empty accepts nothing and would
     * make the "unregistered fails" test pass for the wrong reason.
     */
    const registered = registeredScenarioSources();
    assert.ok(registered.length > 0, 'no scenario source is registered at all');
    assert.ok(registered.includes('worldbank'), `worldbank missing; registered: ${registered.join(', ')}`);

    /**
     * A SECOND source is what makes the dispatch table load-bearing. A registry
     * with one entry has never dispatched, and would pass every test below
     * while proving the generalisation did nothing.
     */
    assert.ok(
      registered.includes('wikidata-sparql'),
      `only ${registered.join(', ')} registered — a one-entry registry is not a dispatch table`,
    );
  });

  it('AN UNREGISTERED SOURCE FAILS LOUDLY, rather than borrowing another\'s fixtures', async () => {
    /**
     * The failure this guard exists to prevent: falling through to the World
     * Bank's handler would serve GDP figures for a Wikidata query and still
     * look like a working demonstration. **A scenario that serves the wrong
     * source's data is worse than one that refuses, because it renders.**
     */
    /**
     * The id is deliberately one that cannot ever be registered.
     *
     * The first version used `wikidata-sparql` — a real source that was
     * unregistered at the time — and registering it one commit later turned
     * this into a test of a registered source. It failed, correctly, which is
     * the test noticing its own premise had expired. A negative case must name
     * something that stays negative.
     */
    const fetcher = fetcherFor('?econ=ok');
    await assert.rejects(
      () => fetcher.request(spec('not-a-real-source')),
      /no handler for source "not-a-real-source"/,
    );
  });

  it('the refusal names what IS registered, so the fix is obvious', async () => {
    const fetcher = fetcherFor('?econ=ok');
    await assert.rejects(() => fetcher.request(spec('nope')), /Registered: .*worldbank/);
    await assert.rejects(() => fetcher.request(spec('nope')), /registerScenarioSource/);
  });

  it('a registered source is served, with ITS origin in the provenance', async () => {
    /**
     * The hardcoded origin was the subtlest part of the old shape: a Wikidata
     * request would have reported `api.worldbank.org` as its request URL, and
     * the inspector renders that URL to the reader.
     */
    registerScenarioSource('test-source', {
      origin: 'https://example.invalid',
      fixture: () => ({ hello: 'fixture' }),
      sample: () => ({ hello: 'sample' }),
      degradedOk: () => true,
    });

    const outcome = await fetcherFor('?econ=ok').request(spec('test-source'));
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.match(outcome.ctx.requestUrl, /^https:\/\/example\.invalid/);
      assert.doesNotMatch(outcome.ctx.requestUrl, /worldbank/, 'the origin is still hardcoded');
      assert.equal(outcome.ctx.fromFixture, true, 'a scenario response must announce it is not live');
    }
  });

  it('a source with no fixture for a request FAILS rather than returning empty', async () => {
    // Rendering "no data" for something never captured would assert something
    // about the subject that no source ever said.
    registerScenarioSource('sparse-source', {
      origin: 'https://example.invalid',
      fixture: () => undefined,
      sample: () => ({}),
      degradedOk: () => true,
    });

    const outcome = await fetcherFor('?econ=fixtures').request(spec('sparse-source'));
    assert.equal(outcome.ok, false);
  });

  it('the four transport states stay generic across sources', async () => {
    /**
     * loading, stale, degraded and unavailable are properties of the
     * TRANSPORT, not of any source — which is why they did not need per-source
     * handling and `degradedOk` did.
     */
    const unavailable = await fetcherFor('?econ=unavailable').request(spec('test-source'));
    assert.equal(unavailable.ok, false);

    const stale = await fetcherFor('?econ=stale').request(spec('test-source'));
    assert.equal(stale.ok, true);
    if (stale.ok) assert.equal(stale.ctx.cache, 'stale-revalidating');

    const degraded = await fetcherFor('?econ=degraded').request(spec('sparse-source'));
    assert.equal(degraded.ok, true, 'degradedOk() returning true should still serve');
  });

  it('no scenario parameter means the real fetcher, with no stub in the path', () => {
    // The default path must have no fixture in it at all.
    const live = fetcherFor('');
    assert.ok(live);
    assert.notEqual(live.constructor.name, 'ScenarioFetcher');
  });
});
