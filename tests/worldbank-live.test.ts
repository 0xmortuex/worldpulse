import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Fetcher } from '../src/fetch/transport';
import { MemoryCacheStore } from '../src/fetch/cache-store';
import { loadEconomyLive } from '../src/dossier/economy-live';
import { getSource, fetchDefaults } from '../src/facts/registry';
import { factState } from '../src/facts/types';
import { latestValueFact } from '../src/economy/series';

/**
 * The live path, end to end: registry → compose → transport → adapter → Fact.
 *
 * Gated on PROBE_LIVE because it makes real requests, matching the convention
 * the contract tests already use.
 *
 * THIS IS THE ONLY PLACE THE LIVE PATH IS EXERCISED, and that is an environment
 * limitation rather than a choice. Chromium in this container cannot reach
 * api.worldbank.org: outbound HTTPS goes through an agent proxy the browser is
 * not configured for, and the proxy's CA is not in its trust store. Pointing
 * Playwright at the proxy still fails, and the remaining fix — disabling
 * certificate verification — is not available. So the browser suite runs the
 * economy panel against deterministic scenarios, and the live request is proven
 * here, in Node, where it can actually be made. Recorded in docs/FOUND.md.
 */
const LIVE = process.env['PROBE_LIVE'] === '1';

describe('World Bank, live', { skip: LIVE ? false : 'set PROBE_LIVE=1 to run' }, () => {
  it('fetches, parses and renders a real indicator through the whole stack', async () => {
    const fetcher = new Fetcher({ store: new MemoryCacheStore(), lookupSource: getSource, defaults: fetchDefaults() });
    const window = { fromYear: 2000, toYear: 2026, referenceYear: 2026 };
    const load = await loadEconomyLive(fetcher, 'FRA', window);

    const gdp = load.rows.find((row) => row.id === 'gdp');
    assert.ok(gdp, 'the gdp indicator is not registered');
    assert.equal(gdp.failure, null, `gdp request failed: ${gdp.failure?.detail ?? ''}`);
    assert.ok(gdp.loaded, 'gdp produced no series');

    // The response is real, so the assertions are about invariants rather than
    // about specific values: a live figure that changes yearly must not be
    // pinned, or this test fails every spring for the wrong reason.
    assert.equal(gdp.loaded.raw.countryIso3, 'FRA');
    assert.ok(gdp.loaded.raw.observations.length > 10, 'suspiciously short series');

    const fact = latestValueFact(gdp.loaded.series, gdp.loaded.ctx, gdp.loaded.raw);
    assert.equal(factState(fact), 'ok', 'a live response did not produce a renderable fact');
    assert.equal(fact.provenance?.kind, 'fetch');
    assert.match(gdp.loaded.ctx.requestUrl, /api\.worldbank\.org/);
    assert.equal(gdp.loaded.ctx.httpStatus, 200);
    assert.notEqual(gdp.loaded.ctx.fromFixture, true, 'the live path served a fixture');
  });

  it('serves the second identical request from cache rather than the network', async () => {
    const fetcher = new Fetcher({ store: new MemoryCacheStore(), lookupSource: getSource, defaults: fetchDefaults() });
    const window = { fromYear: 2000, toYear: 2026, referenceYear: 2026 };
    await loadEconomyLive(fetcher, 'FRA', window);
    const second = await loadEconomyLive(fetcher, 'FRA', window);
    const gdp = second.rows.find((row) => row.id === 'gdp');
    assert.equal(gdp?.loaded?.ctx.cache, 'hit', 'the cache did not serve a repeat request');
  });
});
