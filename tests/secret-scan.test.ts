import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { secretEnvNames, secretsIn } from '../scripts/secret-scan.mjs';
import { fetchProvenance } from '../src/sources/adapter';
import { FIXTURES, loadSample } from './fixtures/index';
import registry from '../data/sources.json';
import probeResults from '../data/probe-results.json';

/**
 * The RECORDED lifecycle of a secret.
 *
 * A secret is sent, received, and recorded. The first two were guarded — the URL
 * builder emits no key and the capture refuses if it does; `redactKeys` scrubs
 * anything derived from a response. Nothing guarded the third, and that is where
 * it nearly went wrong: `loadSample` put the KEYED url into `ctx.requestUrl`,
 * which flows into `FetchProvenance` and is rendered by the inspector.
 *
 * Both existing guards passed throughout. They watched the wire; neither watched
 * the ledger.
 */
describe('secrets must not reach anything that is recorded', () => {
  const ENV = { EMBER_API_KEY: 'sk-planted-secret-value', EMPTY_KEY: '   ' };
  const NAMES = ['EMBER_API_KEY', 'EMPTY_KEY'];

  /**
   * THE PLANTED CASE THIS GUARD EXISTS FOR — the exact bug, reconstructed.
   *
   * A keyed URL written into the FetchContext, exactly as the first version of
   * `loadSample` did it, carried into a real `FetchProvenance`.
   */
  it('fires on a keyed URL recorded in provenance', () => {
    const leaked = fetchProvenance(
      'ember-electricity',
      {
        requestUrl: `https://api.ember-energy.org/v1/x?entity_code=AUT&api_key=${ENV.EMBER_API_KEY}`,
        httpStatus: 200,
        fetchedAt: '2026-08-15T00:00:00.000Z',
        cache: 'miss',
      },
      { note: 'body' },
      'planted',
    );

    const problems = secretsIn(leaked, ENV, NAMES);
    assert.ok(problems.length > 0, 'the guard did not see a key in requestUrl');
    assert.match(problems[0] as string, /EMBER_API_KEY/);
    assert.match(problems[0] as string, /requestUrl/);
  });

  it('fires when a secret is nested in a raw response body', () => {
    const echoed = { raw: { echo: { url: `https://x/y?api_key=${ENV.EMBER_API_KEY}` } } };
    assert.equal(secretsIn(echoed, ENV, NAMES).length, 1);
  });

  it('fires on a secret used as a property name', () => {
    const odd = { [ENV.EMBER_API_KEY]: 'value' };
    assert.match(secretsIn(odd, ENV, NAMES)[0] as string, /property NAME/);
  });

  it('an unset or blank variable matches nothing', () => {
    /**
     * The failure mode that would make this guard useless: an empty secret
     * matched by `String.includes` matches EVERY string, so every scan would
     * report everything and the guard would be turned off within a day.
     */
    assert.deepEqual(secretsIn({ a: 'anything at all' }, { EMPTY_KEY: '' }, ['EMPTY_KEY']), []);
    assert.deepEqual(secretsIn({ a: 'anything at all' }, ENV, ['EMPTY_KEY']), []);
    assert.deepEqual(secretsIn({ a: 'anything at all' }, {}, ['MISSING_KEY']), []);
  });

  it('does not choke on a cyclic structure', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic['self'] = cyclic;
    assert.deepEqual(secretsIn(cyclic, ENV, NAMES), []);
  });

  it('reads the secret list from the registry, not a hand-kept list', () => {
    const names = secretEnvNames(registry);
    assert.ok(names.includes('EMBER_API_KEY'));
    assert.ok(names.includes('COMTRADE_KEY'));
    assert.equal(names.includes(''), false);
  });

  /**
   * THE REAL CHECK. Every artefact that is committed or rendered, scanned with
   * the machine's ACTUAL key values.
   *
   * Silent when no keys are configured — which is honest rather than convenient:
   * with nothing to look for, the scan proves nothing, and saying so is better
   * than a green tick that means "no keys on this machine".
   */
  it('no configured key appears in any committed artefact', () => {
    const names = secretEnvNames(registry);
    const configured = names.filter((name) => (process.env[name] ?? '').trim() !== '');
    if (configured.length === 0) {
      // Recorded, never silent — rule 17: a check that did not run must not look
      // like one that passed.
      process.stderr.write('SECRET SCAN: no keys configured, nothing to look for this run\n');
      return;
    }

    const artefacts: Array<[string, unknown]> = [
      ['data/sources.json', registry],
      ['data/probe-results.json', probeResults],
      ['tests/fixtures (all registered bodies)', Object.values(FIXTURES).map((f) => f.body)],
      ['tests/fixtures (all registered URLs)', Object.values(FIXTURES).map((f) => f.requestUrl)],
      ['.env.example', readFileSync(new URL('../.env.example', import.meta.url), 'utf8')],
    ];

    for (const [label, value] of artefacts) {
      const problems = secretsIn(value, process.env, configured);
      assert.deepEqual(problems, [], `${label}:\n  ${problems.join('\n  ')}`);
    }
  });

  /**
   * The regression case, on the real code path: what `loadSample` hands back must
   * be clean even for a key-gated source.
   */
  it('loadSample records nothing secret, for a key-gated source', async () => {
    const configured = secretEnvNames(registry).filter(
      (name) => (process.env[name] ?? '').trim() !== '',
    );
    if (configured.length === 0) return;

    const { body, ctx } = await loadSample('ember-electricity');
    assert.deepEqual(secretsIn(ctx, process.env, configured), [], 'the FetchContext carried a key');
    assert.deepEqual(secretsIn(body, process.env, configured), [], 'the body carried a key');

    const provenance = fetchProvenance('ember-electricity', ctx, body, 'secret scan');
    assert.deepEqual(
      secretsIn(provenance, process.env, configured),
      [],
      'the provenance the inspector renders carried a key',
    );
  });
});
