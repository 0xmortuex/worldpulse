import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keyedProbeUrl, redactKeys } from '../scripts/probe-auth.mjs';

/**
 * Planted cases (rule 27) for the thing that could not previously happen: a
 * key-gated source being probed WITH its key.
 *
 * The prober used to assign `KEY-GATED` and have no way to clear it, so the
 * verdict described the prober rather than the source. These cases exist so each
 * distinct reason a key cannot be applied is separately visible — "no key yet"
 * and "we do not know where the key goes" are different problems with the same
 * old symptom.
 */
describe('probe key application', () => {
  const EMBER = {
    id: 'ember-electricity',
    probeUrl: 'https://api.ember-energy.org/v1/electricity-generation/yearly?entity_code=DEU&limit=2',
    keyRequired: true,
    keyEnv: 'EMBER_API_KEY',
    keyParam: 'api_key',
  };

  it('applies a declared query-parameter key without disturbing the existing query', () => {
    const result = keyedProbeUrl(EMBER, { EMBER_API_KEY: 'secret-value' });
    assert.equal(result.keyed, true);
    assert.equal(result.reason, null);

    const url = new URL(result.url);
    assert.equal(url.searchParams.get('api_key'), 'secret-value');
    // The measured mechanism: Ember reads entity_code and limit, and they must
    // survive having a key appended.
    assert.equal(url.searchParams.get('entity_code'), 'DEU');
    assert.equal(url.searchParams.get('limit'), '2');
  });

  it('leaves keyless sources exactly as they are', () => {
    const usgs = { id: 'usgs', probeUrl: 'https://earthquake.usgs.gov/x.geojson', keyRequired: false };
    const result = keyedProbeUrl(usgs, {});
    assert.equal(result.keyed, false);
    assert.equal(result.url, usgs.probeUrl);
    assert.equal(result.reason, null, 'a source that needs no key has no problem to report');
  });

  it('distinguishes "no key yet" from "we do not know where the key goes"', () => {
    /**
     * These produced the same symptom before — a 403 that reads as "still
     * blocked on provisioning" — and they need different actions: one waits for
     * a signup, the other waits for someone to measure the mechanism.
     */
    const unset = keyedProbeUrl(EMBER, {});
    assert.equal(unset.keyed, false);
    assert.match(unset.reason as string, /EMBER_API_KEY is not set/);

    const { keyParam, ...noMechanism } = EMBER;
    void keyParam;
    const undeclared = keyedProbeUrl(noMechanism, { EMBER_API_KEY: 'secret-value' });
    assert.equal(undeclared.keyed, false);
    assert.match(undeclared.reason as string, /does not declare HOW/);
  });

  it('never infers the mechanism, because a wrong guess looks exactly like no key', () => {
    // The whole reason keyParam is required rather than defaulted: sending a
    // query parameter to a source that wants a header fails as a plain 403.
    const result = keyedProbeUrl({ ...EMBER, keyParam: undefined }, { EMBER_API_KEY: 'v' });
    assert.equal(result.keyed, false);
    assert.equal(result.url, EMBER.probeUrl, 'the request is left unkeyed rather than sent wrong');
  });

  it('reports the unsatisfiable case rather than silently skipping it', () => {
    const acled = { id: 'acled', probeUrl: 'https://x/y', keyRequired: true, keyEnv: null };
    const result = keyedProbeUrl(acled, {});
    assert.equal(result.keyed, false);
    assert.match(result.reason as string, /no keyEnv/);
  });

  it('an empty environment value is not a key', () => {
    const result = keyedProbeUrl(EMBER, { EMBER_API_KEY: '   ' });
    assert.equal(result.keyed, false);
    assert.match(result.reason as string, /is not set/);
  });

  /**
   * The prober writes a committed file. A key reaching it would be a secret
   * leaked by the tool built to describe secrets' absence.
   */
  it('redacts key values out of anything derived from a response', () => {
    const env = { EMBER_API_KEY: 'abc123', OTHER_KEY: '' };
    const text = 'request failed for https://api.x/y?api_key=abc123 (key abc123)';
    const redacted = redactKeys(text, env, ['EMBER_API_KEY', 'OTHER_KEY']);
    assert.equal(redacted.includes('abc123'), false, 'the key survived redaction');
    assert.match(redacted, /«EMBER_API_KEY»/);
    // An empty variable must not turn every empty string into a marker.
    assert.equal(redacted.includes('«OTHER_KEY»'), false);
  });
});

/**
 * A key carried in the URL PATH — NASA FIRMS is the first source to need it.
 *
 * `/api/area/csv/<MAP_KEY>/VIIRS_NOAA20_NRT/...`. Measured: a valid key returns
 * 200, a bogus one returns `401 Invalid MAP_KEY.`, and no key returns the same
 * 401. Unlike a source hidden behind a bot wall, this API says exactly what is
 * wrong.
 */
describe('probe key application — key in the path', () => {
  const FIRMS = {
    id: 'nasa-firms',
    probeUrl: 'https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{MAP_KEY}/ALL',
    keyRequired: true,
    keyEnv: 'FIRMS_MAP_KEY',
    keyIn: 'path',
    keyPlaceholder: '{MAP_KEY}',
  };

  it('substitutes the placeholder rather than guessing a position', () => {
    const result = keyedProbeUrl(FIRMS, { FIRMS_MAP_KEY: 'abc123' });
    assert.equal(result.keyed, true);
    assert.equal(result.reason, null);
    assert.equal(
      result.url,
      'https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/abc123/ALL',
    );
    assert.equal(result.url.includes('{MAP_KEY}'), false);
  });

  it('refuses when keyIn is path but no placeholder is declared', () => {
    const { keyPlaceholder, ...noPlaceholder } = FIRMS;
    void keyPlaceholder;
    const result = keyedProbeUrl(noPlaceholder, { FIRMS_MAP_KEY: 'abc123' });
    assert.equal(result.keyed, false);
    assert.match(result.reason as string, /no keyPlaceholder is declared/);
  });

  it('refuses when the placeholder is not actually in the URL', () => {
    const wrong = { ...FIRMS, probeUrl: 'https://firms.modaps.eosdis.nasa.gov/api/x/ALL' };
    const result = keyedProbeUrl(wrong, { FIRMS_MAP_KEY: 'abc123' });
    assert.equal(result.keyed, false);
    assert.match(result.reason as string, /does not contain the declared placeholder/);
  });

  it('leaves the placeholder in place when the key is absent', () => {
    /**
     * The unkeyed URL is what gets RECORDED — in provenance, in a fixture's
     * requestUrl, in the probe's output. It must contain the placeholder rather
     * than a key, which is why the builder emits the placeholder and only the
     * fetch substitutes.
     */
    const result = keyedProbeUrl(FIRMS, {});
    assert.equal(result.keyed, false);
    assert.ok(result.url.includes('{MAP_KEY}'), 'the recorded URL lost its placeholder');
    assert.match(result.reason as string, /FIRMS_MAP_KEY is not set/);
  });

  it('percent-encodes a key with URL-significant characters', () => {
    // A path segment containing / or ? would otherwise change the route.
    const result = keyedProbeUrl(FIRMS, { FIRMS_MAP_KEY: 'a/b?c' });
    assert.equal(result.url.includes('a%2Fb%3Fc'), true, result.url);
  });
});
