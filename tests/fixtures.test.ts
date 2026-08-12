import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

/**
 * A contract test must issue the request the app issues.
 *
 * Twice now a fixture URL has diverged from the app's real request and the test
 * still passed: the wikidata-sparql fixture omitted `SERVICE wikibase:label`
 * while its body carried `*Label` bindings, and the wikimedia-commons probe URL
 * omitted `origin=*`, without which MediaWiki emits no ACAO at all. In both
 * cases the divergence was a defect in the test, not a property of the source.
 *
 * Host equality (asserted above) is too weak to catch either. This compares the
 * QUERY PARAMETERS: every parameter the app puts on a request to a host must
 * appear on the fixture's request to that host. The app's URLs are read out of
 * `src/` rather than maintained as a second list here, because a second list is
 * a thing that drifts from the first.
 */
describe('fixture requests carry the parameters the app sends', () => {
  const SRC = join(resolve(import.meta.dirname, '..'), 'src');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (path.endsWith('.ts')) out.push(path);
    }
    return out;
  }

  /** URLs the app builds, by host, with their parameter names. */
  const appParamsByHost = new Map<string, Set<string>>();
  for (const file of walk(SRC)) {
    /**
     * Join adjacent string-literal concatenations before scanning.
     *
     * Without this the scanner stops at the first closing quote, so a URL
     * assembled as `'https://host/path?a=1' + '&b=2'` contributes only `a`.
     * That is not hypothetical — it is exactly how the Commons imageinfo URL is
     * built, and this guard PASSED a planted removal of `origin=*` because it
     * could not see the second fragment. A guard against vacuous passes that
     * passes vacuously is the failure it was written to prevent.
     */
    const text = readFileSync(file, 'utf8').replace(/['"`]\s*\+\s*['"`]/g, '');
    for (const match of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      // Template placeholders make the URL unparseable; strip them to a token.
      const cleaned = (match[0] as string).replace(/\$\{[^}]*\}/g, 'X');
      let url: URL;
      try {
        url = new URL(cleaned);
      } catch {
        continue;
      }
      if (url.search === '') continue;
      const names = appParamsByHost.get(url.host) ?? new Set<string>();
      for (const name of url.searchParams.keys()) names.add(name);
      appParamsByHost.set(url.host, names);
    }
  }

  it('found app-constructed URLs to compare against', () => {
    assert.ok(appParamsByHost.size > 0, 'no parameterised URLs found in src/ — this suite would pass vacuously');
  });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name}: sends every parameter the app sends to that host`, () => {
      const url = new URL(fixture.requestUrl);
      const appParams = appParamsByHost.get(url.host);
      if (!appParams || appParams.size === 0) return;

      const fixtureParams = new Set(url.searchParams.keys());
      const missing = [...appParams].filter((param) => !fixtureParams.has(param));
      assert.deepEqual(
        missing,
        [],
        `${name}: the app sends ${missing.join(', ')} to ${url.host} and this fixture does not. ` +
          'A contract test that omits a parameter the app sends is measuring a different request ' +
          'than the app makes — origin=* on MediaWiki changes whether CORS headers appear at all.',
      );
    });
  }
});
