/**
 * The edge Worker's router — SPEC-FETCH-LAYER's proxy, as pure logic.
 *
 * `src/fetch/compose.ts` already emits `/api/s/<sourceId><path>?<query>` for
 * every source marked `transport: "worker"`, and refuses to route a secret key
 * any other way. This is the other half of that contract, and it is the half
 * that must not be got wrong: **a proxy that forwards wherever it is asked is
 * an open relay**, and ours would be one wearing our origin and our rate
 * limits.
 *
 * ## Allow-list, never a URL parameter
 *
 * The client names a REGISTERED SOURCE ID, never a destination. The upstream
 * origin comes from `data/sources.json` and from nowhere else, so the set of
 * hosts this Worker can ever reach is the set someone committed to the
 * registry after reading its licence (L15).
 *
 * ## The origin check is the load-bearing line
 *
 * Building the upstream as `new URL(path, origin)` is not by itself safe:
 * a path of `//evil.test/x` resolves to `https://evil.test/x`, silently
 * changing host while looking like a relative path. So the composed URL's
 * origin is compared against the registry's, and a mismatch is refused rather
 * than fetched. `tests/worker-router.test.ts` plants exactly that request.
 *
 * Kept free of `fetch`, `Request` and env bindings so every refusal above can
 * be asserted without a network or a Cloudflare runtime.
 */

export const PROXY_PREFIX = '/api/s';

export interface RegistrySource {
  id: string;
  origin?: string | null;
  transport?: string;
  keyRequired?: boolean;
  keyEnv?: string | null;
  ttlMs?: number | null;
}

export interface RouteRefusal {
  ok: false;
  /** The status the Worker should answer with. */
  status: number;
  /** Safe to return to the caller: never echoes an attacker-supplied URL. */
  reason: string;
}

export interface RouteResolution {
  ok: true;
  sourceId: string;
  upstream: string;
  /** Edge cache TTL in seconds, or null when the registry states none. */
  cacheSeconds: number | null;
  /**
   * The env binding holding this source's secret key, when it has one. The
   * router never reads it — it only says which one the handler must inject.
   */
  keyEnv: string | null;
}

export type RouteResult = RouteResolution | RouteRefusal;

function refuse(status: number, reason: string): RouteRefusal {
  return { ok: false, status, reason };
}

export function resolveProxyRoute(
  pathname: string,
  search: string,
  registry: readonly RegistrySource[],
): RouteResult {
  if (!pathname.startsWith(`${PROXY_PREFIX}/`)) {
    return refuse(404, 'not a proxy path');
  }

  const rest = pathname.slice(PROXY_PREFIX.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0) {
    return refuse(400, 'proxy path must name a source and an upstream path');
  }

  let sourceId: string;
  try {
    sourceId = decodeURIComponent(rest.slice(0, slash));
  } catch {
    return refuse(400, 'source id is not valid percent-encoding');
  }

  const upstreamPath = rest.slice(slash);
  if (!upstreamPath.startsWith('/')) {
    return refuse(400, 'upstream path must be rooted');
  }

  /**
   * A protocol-relative path changes HOST while looking relative. Rejected
   * here by shape as well as by the origin comparison below — two independent
   * refusals for the same attack, because this is the one that matters.
   */
  if (upstreamPath.startsWith('//')) {
    return refuse(400, 'upstream path must not be protocol-relative');
  }

  const source = registry.find((entry) => entry.id === sourceId);
  if (!source) {
    return refuse(404, 'unknown source');
  }

  /**
   * Only sources the registry ROUTES through the Worker. A direct-transport
   * source has a browser-reachable CORS policy and does not need us; proxying
   * it anyway would widen the reachable host set for no benefit, and every
   * host this Worker can reach is a host it can be made to hammer.
   */
  if (source.transport !== 'worker') {
    return refuse(403, 'source is not routed through the worker');
  }

  if (!source.origin) {
    return refuse(500, 'source has no origin in the registry');
  }

  let registered: URL;
  try {
    registered = new URL(source.origin);
  } catch {
    return refuse(500, 'source origin in the registry is not a URL');
  }

  let upstream: URL;
  try {
    upstream = new URL(`${upstreamPath}${search}`, registered);
  } catch {
    return refuse(400, 'upstream path does not compose into a URL');
  }

  // THE LOAD-BEARING CHECK. See the header.
  if (upstream.origin !== registered.origin) {
    return refuse(400, 'composed URL left the registered origin');
  }

  if (upstream.protocol !== 'https:') {
    return refuse(400, 'upstream must be https');
  }

  const secretKeyEnv =
    source.keyRequired && source.keyEnv && !source.keyEnv.startsWith('VITE_') ? source.keyEnv : null;

  return {
    ok: true,
    sourceId: source.id,
    upstream: upstream.toString(),
    cacheSeconds: typeof source.ttlMs === 'number' ? Math.floor(source.ttlMs / 1000) : null,
    keyEnv: secretKeyEnv,
  };
}
