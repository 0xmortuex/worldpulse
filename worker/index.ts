import registryFile from '../data/sources.json';
import { resolveProxyRoute, type RegistrySource } from './router';

/**
 * The edge Worker — SPEC-FETCH-LAYER's proxy for the 27 sources the browser
 * cannot read directly.
 *
 * All routing decisions live in `./router.ts` and are asserted in
 * `tests/worker-router.test.ts` without a network. This file is the thin part:
 * it takes the router's answer, injects a secret if one is named, fetches, and
 * caches.
 *
 * ## What this deliberately does NOT do
 *
 * - **It does not forward client headers.** A proxy that passes through
 *   whatever it is handed lets a caller shape our request to a third party.
 *   Upstreams see a request composed here and a User-Agent identifying this
 *   app, which is what the polite-use policies of several sources ask for.
 * - **It does not forward cookies or credentials**, in either direction.
 * - **It answers only GET and HEAD.** Nothing this app reads needs more, and a
 *   proxy that accepts POST is a proxy that can be used to write.
 * - **It never echoes the upstream URL into an error.** Refusal text comes from
 *   the router's fixed strings, so a caller cannot get us to reflect their
 *   input back to them.
 *
 * ## Cached at the edge, never per visitor
 *
 * SPEC-WARWATCH T4 requires this for the rate-limited sources, and it is right
 * for all of them: the registry's `ttlMs` becomes the edge cache TTL, so a
 * thousand readers of one panel are one upstream request. A source with no
 * stated TTL is not cached rather than cached for a guessed interval.
 */

export interface Env {
  /** Secret keys, bound by name from the registry's `keyEnv`. */
  [binding: string]: string | undefined;
}

const rawRegistry = registryFile as unknown as { sources?: RegistrySource[] } | RegistrySource[];
const REGISTRY: RegistrySource[] = Array.isArray(rawRegistry) ? rawRegistry : rawRegistry.sources ?? [];

const USER_AGENT = 'worldpulse (+https://worldpulse.pages.dev)';

function refusal(status: number, reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The single implementation, shared by both entry points.
 *
 * Cloudflare Pages Functions and a standalone Worker have different wrappers
 * and the same job. Two copies of proxy logic is precisely the drift this
 * project refuses elsewhere — and here the copy that fell behind would be the
 * one still acting as an open relay.
 */
export async function handleProxy(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return refusal(405, 'this proxy answers GET and HEAD only');
    }

    const url = new URL(request.url);
    const route = resolveProxyRoute(url.pathname, url.search, REGISTRY);
    if (!route.ok) return refusal(route.status, route.reason);

    const upstream = new URL(route.upstream);

    /**
     * The secret key is injected HERE and nowhere earlier. It exists only in
     * this Worker's environment; `compose.ts` refuses to put it in a
     * browser-bound URL, and the router only names which binding to read.
     */
    if (route.keyEnv) {
      const secret = env[route.keyEnv];
      if (!secret) return refusal(503, 'this source is not configured with its key');
      upstream.searchParams.set('api_key', secret);
    }

    const cache = (caches as unknown as { default: Cache }).default;
    // Cache key omits the secret, so one cached entry serves every visitor and
    // the key never becomes part of a cache identity that could be enumerated.
    const cacheKey = new Request(`${url.origin}${url.pathname}${url.search}`, { method: 'GET' });

    if (route.cacheSeconds !== null) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstream.toString(), {
        method: request.method,
        headers: { 'user-agent': USER_AGENT, accept: request.headers.get('accept') ?? '*/*' },
        redirect: 'follow',
      });
    } catch {
      // The upstream's failure is OURS to report as a transport failure, not to
      // dress up as the source having nothing. Rule 30 reaches even here.
      return refusal(502, 'upstream could not be reached');
    }

    const body = await upstreamResponse.arrayBuffer();
    const headers = new Headers({
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
      'x-worldpulse-source': route.sourceId,
      'x-worldpulse-upstream-status': String(upstreamResponse.status),
    });

    if (route.cacheSeconds !== null && upstreamResponse.ok) {
      headers.set('cache-control', `public, max-age=${route.cacheSeconds}`);
    } else {
      headers.set('cache-control', 'no-store');
    }

    const response = new Response(body, { status: upstreamResponse.status, headers });

  if (route.cacheSeconds !== null && upstreamResponse.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

/** Standalone-Worker entry point. Pages uses `functions/api/s/[[path]].ts`. */
export default {
  fetch: handleProxy,
};
