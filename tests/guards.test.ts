import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  labelBindingsWithoutService,
  missingAppParams,
  paramsOf,
  unaccountedHosts,
  urlsInSource,
} from './guards';

/**
 * Every guard, run against a planted violation.
 *
 * Rule 27. These are not tests of the codebase — they are tests that the checks
 * WATCHING the codebase can see what they claim to. A scanner that matches
 * nothing and a codebase with nothing to match produce identical output, so a
 * guard's blind spots never appear in its own results.
 */
describe('guard: URL scanner sees the constructs the app uses', () => {
  it('finds a plain URL', () => {
    assert.deepEqual(urlsInSource(`const u = 'https://api.example.com/v1?a=1';`), [
      'https://api.example.com/v1?a=1',
    ]);
  });

  /**
   * The planted case that matters. The first version of this scanner stopped at
   * the first closing quote, so this URL contributed only `a` — and a planted
   * removal of the second fragment's parameter passed.
   */
  it('sees a URL assembled by string concatenation across lines', () => {
    const source = `const u =\n  'https://commons.wikimedia.org/w/api.php?action=query' +\n  '&origin=*&titles=X';`;
    const [found] = urlsInSource(source);
    assert.ok(found, 'the scanner found no URL at all');
    const params = paramsOf(found as string);
    assert.ok(params.has('action'), 'lost the first fragment');
    assert.ok(params.has('origin'), 'BLIND SPOT: the scanner cannot see concatenated fragments');
  });

  it('sees a URL built with a template placeholder', () => {
    const source = 'const u = `https://api.example.com/v1?id=${encodeURIComponent(x)}&fmt=json`;';
    const [found] = urlsInSource(source);
    assert.ok(found);
    assert.ok(paramsOf(found as string).has('fmt'));
  });
});

describe('guard: parameter parity catches an omitted parameter', () => {
  it('passes when the fixture sends everything the app sends', () => {
    assert.deepEqual(
      missingAppParams('https://h/api?a=1&b=2', new Set(['a', 'b'])),
      [],
    );
  });

  it('catches a planted omission', () => {
    assert.deepEqual(
      missingAppParams('https://h/api?a=1', new Set(['a', 'origin'])),
      ['origin'],
      'the guard did not notice a parameter the app sends and the fixture omits',
    );
  });
});

describe('guard: label-service check catches a request that cannot produce its response', () => {
  const withLabels = { results: { bindings: [{ itemLabel: { value: 'x' }, item: { value: 'y' } }] } };

  it('passes when the request invokes the label service', () => {
    const url =
      'https://query.wikidata.org/sparql?query=' +
      encodeURIComponent('SELECT ?itemLabel WHERE { SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . } }');
    assert.deepEqual(labelBindingsWithoutService(withLabels, url), []);
  });

  it('catches a planted violation — label bindings with no label service', () => {
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent('SELECT ?itemLabel WHERE { ?item wdt:P36 ?c }');
    assert.deepEqual(labelBindingsWithoutService(withLabels, url), ['itemLabel']);
  });

  it('does not fire on a body with no label bindings', () => {
    const plain = { results: { bindings: [{ item: { value: 'y' } }] } };
    assert.deepEqual(labelBindingsWithoutService(plain, 'https://query.wikidata.org/sparql?query=X'), []);
  });
});

describe('guard: host accounting catches an unregistered host', () => {
  it('passes when every host is registered or exempt', () => {
    assert.deepEqual(
      unaccountedHosts(['a.example', 'b.example'], new Set(['a.example']), new Set(['b.example'])),
      [],
    );
  });

  it('catches a planted unregistered host', () => {
    assert.deepEqual(
      unaccountedHosts(['a.example', 'rogue.example'], new Set(['a.example']), new Set()),
      ['rogue.example'],
    );
  });
});
