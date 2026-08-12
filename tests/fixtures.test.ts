import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIXTURES } from './fixtures/index';
import { getSource } from '../src/facts/registry';
import { loadCountries } from '../src/countries';
import { ECONOMY_COUNTRIES } from '../src/dossier/economy-provider';
import { NEWS_COUNTRIES } from '../src/dossier/news-provider';
import { FIXTURE_COUNTRIES } from '../src/dossier/provider';
import { GOVERNMENT_COUNTRIES } from '../src/dossier/government-provider';

/**
 * TESTING.md rule 10: every fixture must assert its subject is reachable
 * through the UI path a test would use.
 *
 * A fixture mapped to a country that is not on the globe is unreachable, and
 * any browser check aimed at it silently runs against whatever was selected
 * before — passing, and proving nothing.
 */
describe('fixture subjects are reachable', () => {
  const codes = new Set(loadCountries().map((country) => country.code));

  const providers: Array<[string, readonly string[]]> = [
    ['dossier', FIXTURE_COUNTRIES],
    ['government', GOVERNMENT_COUNTRIES],
    ['economy', ECONOMY_COUNTRIES],
    ['news', NEWS_COUNTRIES],
  ];

  for (const [name, mapped] of providers) {
    it(`every ${name} fixture country exists on the globe`, () => {
      assert.ok(mapped.length > 0, `${name} provider maps no countries`);
      for (const code of mapped) {
        assert.ok(codes.has(code), `${name}: ${code} is mapped to a fixture but is not on the globe`);
      }
    });
  }
});

/**
 * A fixture records what a request returns. If the request it records is not one
 * the app can issue, the fixture documents nothing — and worse, it is a trap:
 * re-capturing from that URL yields a different shape, which looks like a
 * correction and is a regression.
 *
 * Where this came from: the wikidata-sparql fixture body carried `itemLabel` and
 * `capitalLabel` bindings while its recorded requestUrl omitted
 * `SERVICE wikibase:label`. Wikidata only populates `*Label` variables when that
 * service is invoked, so the recorded request could not have produced the
 * recorded response. Re-capturing from it returns a label-free body, which would
 * have silently emptied the government tab's label-driven classification —
 * decision D3's failure mode arriving through the fixture rather than the data.
 */
describe('fixture requests are requests the app can issue', () => {
  const entries = Object.entries(FIXTURES);

  it('examines every registered fixture', () => {
    // Rule 16: a loop asserting a property must first assert it had subjects.
    assert.ok(entries.length > 0, 'no fixtures registered — this suite would pass vacuously');
  });

  for (const [name, fixture] of entries) {
    it(`${name}: requestUrl points at its own source's host`, () => {
      const source = getSource(fixture.sourceId);
      assert.ok(source, `${name} names source "${fixture.sourceId}", which is not in the registry`);
      const probeUrl = source?.probeUrl;
      assert.ok(probeUrl, `${name}: source has no probeUrl to compare hosts against`);
      assert.equal(
        new URL(fixture.requestUrl).host,
        new URL(probeUrl as string).host,
        `${name}: the fixture requests a different host than its source describes`,
      );
    });

    it(`${name}: a body with *Label bindings records a request that invokes the label service`, () => {
      const body = fixture.body as { results?: { bindings?: Array<Record<string, unknown>> } };
      const bindings = body?.results?.bindings;
      if (!Array.isArray(bindings) || bindings.length === 0) return;

      const labelVars = [...new Set(bindings.flatMap((row) => Object.keys(row)))].filter((key) =>
        key.endsWith('Label'),
      );
      if (labelVars.length === 0) return;

      const query = decodeURIComponent(fixture.requestUrl);
      assert.match(
        query,
        /SERVICE\s+wikibase:label/i,
        `${name}: body carries ${labelVars.join(', ')} but its requestUrl never invokes ` +
          'the label service, so that request cannot return this response',
      );
    });
  }
});
