import type { FetchDefaults, SourceRecord } from '../facts/registry';

/**
 * Turn an adapter's question into a request, using the registry for policy.
 *
 * ## The split, and why it is not negotiable (decision F4)
 *
 * The adapter owns the QUESTION — path and query, in typed code its contract
 * test calls. The registry owns POLICY — origin, transport, key, limits.
 *
 * Moving whole URLs into JSON was the obvious simplification and would break
 * rule 26: the contract test must issue the request the app issues, and it does
 * that by calling the app's own builder. A URL template in a data file is not
 * typed, not tested, and no longer the thing the contract test exercises.
 *
 * The gain is that the contract test now exercises routing and key injection
 * too, by calling `compose(buildRequest(...))` — neither of which it could reach
 * when the adapter returned a finished string.
 */

export interface RequestSpec {
  sourceId: string;
  /** Leading slash, no origin. */
  path: string;
  query?: Record<string, string>;
  accept?: string;
}

export interface ComposedRequest {
  /** The URL to actually request — proxied when transport is 'worker'. */
  url: string;
  /** The upstream URL, for provenance. Never carries a secret. */
  displayUrl: string;
  headers: Record<string, string>;
  transport: 'direct' | 'worker';
  timeoutMs: number;
  /** Cache identity: url + schemaVersion. */
  cacheKey: string;
  sourceId: string;
}

export class ComposeError extends Error {
  constructor(sourceId: string, detail: string) {
    super(`${sourceId}: cannot compose a request — ${detail}`);
    this.name = 'ComposeError';
  }
}

/** Where the Worker proxy lives. Same-origin, so no CORS of our own. */
const PROXY_PREFIX = '/api/s';

/** Query parameter names that must never appear in a provenance record. */
const SECRET_PARAMS = new Set(['key', 'apikey', 'api_key', 'token', 'subscription-key']);

export function redactUrl(url: string): string {
  // Parsed rather than regex-replaced: a key can appear in any position, and a
  // regex that assumes `?key=` misses `&key=`. The inspector shows this string
  // to the user verbatim, so a miss here is a leaked credential on screen.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_PARAMS.has(name.toLowerCase())) parsed.searchParams.set(name, 'REDACTED');
  }
  return parsed.toString();
}

/**
 * @param spec     what the adapter wants to ask
 * @param source   its registry record
 * @param defaults registry-wide fetch policy
 * @param keys     available public keys, by env var name. Secret keys are NOT
 *                 passed here — they are injected by the Worker and must never
 *                 reach this code, which runs in the browser.
 */
export function compose(
  spec: RequestSpec,
  source: SourceRecord | undefined,
  defaults: FetchDefaults,
  keys: Readonly<Record<string, string>> = {},
): ComposedRequest {
  if (!source) throw new ComposeError(spec.sourceId, 'no such source in the registry');
  if (!source.origin) throw new ComposeError(spec.sourceId, 'no origin recorded; run the probe');

  /**
   * Absent transport is refused, never defaulted.
   *
   * Defaulting to 'direct' would mean guessing that the browser can read a
   * response we have never measured — and being wrong ships a panel that fails
   * in the user's browser and works in every test. This is rule 30 at the
   * routing layer: not having probed is not the same as having probed and found
   * it readable.
   */
  if (!source.transport) {
    throw new ComposeError(spec.sourceId, 'transport unknown — this source has not been probed');
  }

  if (!spec.path.startsWith('/')) {
    throw new ComposeError(spec.sourceId, `path must start with "/", got ${JSON.stringify(spec.path)}`);
  }

  const upstream = new URL(source.origin);
  upstream.pathname = spec.path;
  for (const [name, value] of Object.entries(spec.query ?? {})) upstream.searchParams.set(name, value);

  const headers: Record<string, string> = {};
  if (spec.accept) headers['Accept'] = spec.accept;

  /**
   * A public key goes in the URL; a secret key does not go anywhere near here.
   *
   * `keyEnv` starting with `VITE_` is the marker for "may ship to the browser",
   * which is the same precedence the probe encodes when it scores KEY-GATED
   * above a permissive ACAO.
   */
  if (source.keyRequired) {
    const isPublic = (source.keyEnv ?? '').startsWith('VITE_');
    if (isPublic) {
      const value = source.keyEnv ? keys[source.keyEnv] : undefined;
      if (!value) throw new ComposeError(spec.sourceId, `public key ${source.keyEnv} is not configured`);
      upstream.searchParams.set('key', value);
    } else if (source.transport !== 'worker') {
      // Belt and braces against a registry edit: a secret key with a direct
      // transport would put the key in the browser.
      throw new ComposeError(
        spec.sourceId,
        `secret key ${source.keyEnv} requires transport "worker", found "${source.transport}"`,
      );
    }
  }

  const displayUrl = redactUrl(upstream.toString());
  const url =
    source.transport === 'worker'
      ? `${PROXY_PREFIX}/${encodeURIComponent(source.id)}${spec.path}${upstream.search}`
      : upstream.toString();

  return {
    url,
    displayUrl,
    headers,
    transport: source.transport,
    timeoutMs: source.timeoutMs ?? defaults.timeoutMs,
    // The schema version is part of cache identity so that changing how an
    // adapter parses cannot leave it parsing bytes cached under the old
    // assumption.
    cacheKey: `v${source.schemaVersion ?? 1}:${displayUrl}`,
    sourceId: source.id,
  };
}

/** Host that rate limits apply to. Several sources share one origin (F5). */
export function hostOf(source: SourceRecord | undefined): string | null {
  if (!source?.origin) return null;
  try {
    return new URL(source.origin).host;
  } catch {
    return null;
  }
}
