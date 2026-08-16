import { handleProxy, type Env } from '../../../worker/index';

/**
 * Cloudflare Pages Function for `/api/s/*`.
 *
 * A three-line adapter on purpose. All behaviour — the allow-list, the origin
 * check, secret injection and edge caching — lives in `worker/index.ts` and
 * `worker/router.ts`, where `tests/worker-router.test.ts` can reach it.
 *
 * Serving the proxy from the SAME ORIGIN as the app is why this is a Pages
 * Function rather than a separate Worker: the browser makes a same-origin
 * request, so the 27 sources whose CORS policy the browser cannot satisfy stop
 * being a CORS problem at all rather than being papered over with a permissive
 * header.
 */
export const onRequest = (context: {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}): Promise<Response> => handleProxy(context.request, context.env, context);
