import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
