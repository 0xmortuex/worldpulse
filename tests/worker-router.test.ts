import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PROXY_PREFIX, resolveProxyRoute, type RegistrySource } from '../worker/router';
import registryFile from '../data/sources.json';

const REGISTRY: RegistrySource[] = [
  { id: 'rss-npr', origin: 'https://feeds.npr.org', transport: 'worker', ttlMs: 900_000 },
  { id: 'eia', origin: 'https://api.eia.gov', transport: 'worker', keyRequired: true, keyEnv: 'EIA_API_KEY' },
  { id: 'pub-key', origin: 'https://pub.test', transport: 'worker', keyRequired: true, keyEnv: 'VITE_PUB_KEY' },
  { id: 'worldbank', origin: 'https://api.worldbank.org', transport: 'direct' },
  { id: 'no-origin', origin: null, transport: 'worker' },
];

function route(path: string, search = '') {
  return resolveProxyRoute(path, search, REGISTRY);
}

test('a registered worker source composes its upstream URL', () => {
  const result = route(`${PROXY_PREFIX}/rss-npr/1001/rss.xml`, '?x=1');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.upstream, 'https://feeds.npr.org/1001/rss.xml?x=1');
  assert.equal(result.sourceId, 'rss-npr');
  assert.equal(result.cacheSeconds, 900);
});

/**
 * PLANTED (rule 27) — the open-relay attempt this whole file exists for.
 *
 * `//evil.test/x` is a protocol-relative URL wearing the shape of a path. Left
 * to `new URL(path, origin)` it resolves to a DIFFERENT HOST, and the Worker
 * would fetch it with our egress and our reputation.
 */
test('planted: a protocol-relative path cannot escape the registered origin', () => {
  const result = route(`${PROXY_PREFIX}/rss-npr//evil.test/x`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);

  // And the refusal must not echo the attacker's host back to them.
  assert.ok(!result.reason.includes('evil.test'), 'refusals must not reflect attacker input');
});

/**
 * PLANTED (rule 27) — the escape that DEFEATS the shape check.
 *
 * `/\evil.test/x` starts with a single slash, so the `//` shape check passes
 * it straight through. WHATWG URL parsing then normalises the backslash to a
 * slash, and it resolves to `https://evil.test/x` — a different host.
 *
 * This was written expecting the opposite and the test corrected it, which is
 * the point of planting them: the shape check alone is NOT sufficient, and the
 * origin comparison is the only thing standing between this Worker and being
 * an open relay. If someone ever "simplifies" that line away, this fails.
 */
test('planted: a backslash escape defeats the shape check and the origin check still refuses', () => {
  const registered = new URL('https://feeds.npr.org');

  // First: demonstrate the escape is real, so the assertion below is not vacuous.
  assert.equal(new URL('/\\evil.test/x', registered).host, 'evil.test');

  // Second: the router refuses it anyway.
  const result = route(`${PROXY_PREFIX}/rss-npr/\\evil.test/x`);
  assert.equal(result.ok, false, 'a backslash escape must never resolve');
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.ok(!result.reason.includes('evil.test'), 'refusals must not reflect attacker input');
});

test('a dot-dot path cannot climb out of the origin', () => {
  const result = route(`${PROXY_PREFIX}/rss-npr/../../secret`);
  // It either normalises within the origin or is refused — never another host.
  if (result.ok) {
    assert.ok(result.upstream.startsWith('https://feeds.npr.org/'), result.upstream);
  } else {
    assert.equal(result.status, 400);
  }
});

test('an unregistered source is refused, so this is never an open proxy', () => {
  const result = route(`${PROXY_PREFIX}/not-a-source/x`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test('a direct-transport source is refused rather than widened', () => {
  const result = route(`${PROXY_PREFIX}/worldbank/v2/country`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
});

test('a source with no origin fails closed', () => {
  const result = route(`${PROXY_PREFIX}/no-origin/x`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 500);
});

test('paths outside the proxy prefix are not this router\'s business', () => {
  assert.equal(route('/index.html').ok, false);
  assert.equal(route('/api/other/x').ok, false);
});

test('a proxy path naming no upstream path is refused', () => {
  assert.equal(route(`${PROXY_PREFIX}/rss-npr`).ok, false);
  assert.equal(route(`${PROXY_PREFIX}/`).ok, false);
});

test('a SECRET key is named for injection; a public one is not', () => {
  const secret = route(`${PROXY_PREFIX}/eia/v2/petroleum`);
  assert.equal(secret.ok, true);
  if (!secret.ok) return;
  assert.equal(secret.keyEnv, 'EIA_API_KEY');

  /**
   * A `VITE_`-prefixed key already ships to the browser by definition, and
   * `compose.ts` puts it in the URL there. The Worker must not inject it a
   * second time.
   */
  const publicKey = route(`${PROXY_PREFIX}/pub-key/x`);
  assert.equal(publicKey.ok, true);
  if (!publicKey.ok) return;
  assert.equal(publicKey.keyEnv, null);
});

test('a malformed percent-encoded source id is refused, not thrown', () => {
  const result = route(`${PROXY_PREFIX}/%E0%A4%A/x`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
});

/**
 * THE REAL REGISTRY, not just the fixture above.
 *
 * A router that only works against hand-written rows proves nothing about the
 * 27 sources actually marked `transport: "worker"`. Every one of them must
 * resolve, or the Worker would refuse traffic the app is going to send it.
 */
test('every worker-transport source in the real registry resolves', () => {
  const raw = registryFile as unknown as { sources?: RegistrySource[] } | RegistrySource[];
  const all: RegistrySource[] = Array.isArray(raw) ? raw : raw.sources ?? [];
  const workerSources = all.filter((entry) => entry.transport === 'worker');

  assert.ok(workerSources.length > 20, `expected the real registry, got ${workerSources.length}`);

  const failures: string[] = [];
  for (const source of workerSources) {
    const result = resolveProxyRoute(`${PROXY_PREFIX}/${source.id}/probe`, '', all);
    if (!result.ok) failures.push(`${source.id}: ${result.reason}`);
  }
  assert.deepEqual(failures, [], failures.join(' | '));
});

test('every worker-transport source in the real registry is https', () => {
  const raw = registryFile as unknown as { sources?: RegistrySource[] } | RegistrySource[];
  const all: RegistrySource[] = Array.isArray(raw) ? raw : raw.sources ?? [];
  const bad = all
    .filter((entry) => entry.transport === 'worker')
    .filter((entry) => !(entry.origin ?? '').startsWith('https://'))
    .map((entry) => `${entry.id}=${entry.origin}`);
  assert.deepEqual(bad, [], bad.join(' | '));
});
