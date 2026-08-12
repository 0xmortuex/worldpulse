import { fetchDefaults, getSource, type FetchDefaults, type SourceRecord } from '../facts/registry';
import type { FailedFetchProvenance, FailureReason } from '../facts/types';
import type { FetchContext } from '../sources/adapter';
import { compose, hostOf, type ComposedRequest, type RequestSpec } from './compose';
import { admit, backOff, newBucket, parseRetryAfter, release, type BucketState } from './limiter';
import { freshness, revalidationHeaders, type CacheEntry } from './cache-policy';
import { MemoryCacheStore, type CacheStore } from './cache-store';
import { jitter, reasonForStatus, retryPlan } from './retry';

/**
 * The one place this app performs a request.
 *
 * Everything it decides was decided elsewhere, on purpose: composition, limits,
 * freshness, retry and selection identity are pure modules with planted cases,
 * and this assembles them. What remains here is genuinely I/O — the call, the
 * clock, the queue, the abort — which is the part that cannot be made pure and
 * therefore the part worth keeping small.
 *
 * Every dependency is injected so the whole path can be driven against a stub
 * `fetch` with no network, no timers and no browser.
 */

export type FetchOutcome =
  | { ok: true; ctx: FetchContext; raw: unknown }
  | { ok: false; failure: FailedFetchProvenance };

export interface FetcherDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  /** Injected so backoff jitter is deterministic under test. */
  random: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  store: CacheStore;
  lookupSource: (id: string) => SourceRecord | undefined;
  defaults: FetchDefaults;
  keys: Readonly<Record<string, string>>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Skip the cache entirely — used by an explicit user-driven retry. */
  bypassCache?: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class Fetcher {
  readonly #deps: FetcherDeps;
  readonly #buckets = new Map<string, BucketState>();
  /** In-flight requests by cache key, so two panels asking share one request. */
  readonly #inFlight = new Map<string, Promise<FetchOutcome>>();

  constructor(deps: Partial<FetcherDeps> = {}) {
    this.#deps = {
      fetchImpl: deps.fetchImpl ?? ((...args) => fetch(...args)),
      now: deps.now ?? (() => Date.now()),
      random: deps.random ?? (() => Math.random()),
      sleep: deps.sleep ?? defaultSleep,
      store: deps.store ?? new MemoryCacheStore(),
      lookupSource: deps.lookupSource ?? getSource,
      defaults: deps.defaults ?? fetchDefaults(),
      keys: deps.keys ?? {},
    };
  }

  async request(spec: RequestSpec, options: RequestOptions = {}): Promise<FetchOutcome> {
    let composed: ComposedRequest;
    const source = this.#deps.lookupSource(spec.sourceId);
    try {
      composed = compose(spec, source, this.#deps.defaults, this.#deps.keys);
    } catch (error) {
      // A composition refusal is a failure of OUR request, and it is reported as
      // one rather than thrown: an unprobed transport must reach the panel as
      // "unavailable", not as an exception that blanks it.
      return {
        ok: false,
        failure: {
          kind: 'fetch-failed',
          sourceId: spec.sourceId,
          requestUrl: `${source?.origin ?? ''}${spec.path}`,
          httpStatus: null,
          attemptedAt: iso(this.#deps.now()),
          attempts: 0,
          reason: 'network',
          detail: error instanceof Error ? error.message : String(error),
          retryableAt: null,
        },
      };
    }

    /**
     * Coalesce by cache key.
     *
     * Two panels asking the same question share one request and one cache write.
     * Keyed on the composed key rather than the spec so a public key or a
     * schema-version bump correctly separates them.
     */
    const existing = this.#inFlight.get(composed.cacheKey);
    if (existing && !options.bypassCache) return existing;

    const work = this.#perform(composed, source, options).finally(() => {
      this.#inFlight.delete(composed.cacheKey);
    });
    this.#inFlight.set(composed.cacheKey, work);
    return work;
  }

  async #perform(
    composed: ComposedRequest,
    source: SourceRecord | undefined,
    options: RequestOptions,
  ): Promise<FetchOutcome> {
    const { now, store, defaults } = this.#deps;

    const cached = options.bypassCache ? null : await safeRead(store, composed.cacheKey);
    const fresh = freshness({
      entry: cached,
      ttlMs: source?.ttlMs ?? null,
      staleMultiple: defaults.staleMultiple,
      now: now(),
    });

    if (cached && fresh.verdict === 'fresh') {
      return {
        ok: true,
        ctx: {
          requestUrl: composed.displayUrl,
          httpStatus: cached.httpStatus,
          fetchedAt: cached.fetchedAt,
          cache: 'hit',
        },
        raw: cached.raw,
      };
    }

    const network = await this.#withRetries(composed, source, cached, options);

    /**
     * A stale entry rescues a failed refresh; an EXPIRED one does not (F3).
     *
     * This is the whole point of the bounded window. Without the verdict check,
     * a dead origin would serve its last successful response forever, with a
     * "refreshing" indicator that never escalates to anything.
     */
    if (!network.ok && cached && fresh.verdict === 'stale') {
      return {
        ok: true,
        ctx: {
          requestUrl: composed.displayUrl,
          httpStatus: cached.httpStatus,
          fetchedAt: cached.fetchedAt,
          cache: 'stale-revalidating',
        },
        raw: cached.raw,
      };
    }

    return network;
  }

  async #withRetries(
    composed: ComposedRequest,
    source: SourceRecord | undefined,
    cached: CacheEntry | null,
    options: RequestOptions,
  ): Promise<FetchOutcome> {
    const { now, sleep, random, store } = this.#deps;
    const host = hostOf(source) ?? composed.sourceId;
    let attempt = 0;
    let last: FailedFetchProvenance | null = null;

    for (;;) {
      attempt += 1;

      if (options.signal?.aborted) {
        return { ok: false, failure: this.#failure(composed, 'aborted', null, attempt, 'the selection changed', null) };
      }

      const wait = this.#awaitAdmission(host, source);
      if (wait > 0) await sleep(wait, options.signal);

      const result = await this.#attempt(composed, cached, options.signal);
      this.#buckets.set(host, release(this.#buckets.get(host) ?? newBucket(this.#limits(source), now())));

      if (result.kind === 'ok') {
        const entry: CacheEntry = {
          cacheKey: composed.cacheKey,
          raw: result.raw,
          httpStatus: result.status,
          fetchedAt: iso(now()),
          etag: result.etag,
          lastModified: result.lastModified,
        };
        await safeWrite(store, entry);
        return {
          ok: true,
          ctx: { requestUrl: composed.displayUrl, httpStatus: result.status, fetchedAt: entry.fetchedAt, cache: 'miss' },
          raw: result.raw,
        };
      }

      if (result.kind === 'not-modified') {
        if (cached) {
          // 304: the value stands, only its age is refreshed.
          const entry: CacheEntry = { ...cached, fetchedAt: iso(now()) };
          await safeWrite(store, entry);
          return {
            ok: true,
            ctx: { requestUrl: composed.displayUrl, httpStatus: 304, fetchedAt: entry.fetchedAt, cache: 'hit' },
            raw: cached.raw,
          };
        }

        /**
         * A 304 with nothing cached. Reachable rather than theoretical: the
         * browser can evict the store between our reading it and the response
         * arriving, and a shared Worker cache can answer a validator we no
         * longer hold the body for.
         *
         * There is no value to render, and retrying unconditionally would loop —
         * the same validator produces the same 304. It is reported as a failed
         * request, which is exactly what it is: an answer we cannot use.
         */
        return {
          ok: false,
          failure: this.#failure(
            composed,
            'shape',
            304,
            attempt,
            'origin answered 304 Not Modified but nothing is cached to revalidate',
            null,
          ),
        };
      }

      if (result.retryAfterSeconds !== null) {
        this.#buckets.set(
          host,
          backOff(this.#buckets.get(host) ?? newBucket(this.#limits(source), now()), result.retryAfterSeconds, now()),
        );
      }

      const plan = retryPlan({
        reason: result.reason,
        httpStatus: result.status,
        attempt,
        retryAfterMs: result.retryAfterSeconds === null ? null : result.retryAfterSeconds * 1000,
      });

      last = this.#failure(
        composed,
        result.reason,
        result.status,
        attempt,
        result.detail,
        plan.retry ? iso(now() + plan.delayMs) : null,
      );

      if (!plan.retry) return { ok: false, failure: last };
      await sleep(jitter(plan.delayMs, random()), options.signal);
    }
  }

  #limits(source: SourceRecord | undefined): { perMinute: number; burst: number; maxConcurrent: number } {
    const { defaults } = this.#deps;
    const rate = source?.rateLimit ?? defaults.rateLimit;
    return {
      perMinute: rate.perMinute,
      burst: rate.burst,
      maxConcurrent: source?.maxConcurrent ?? defaults.maxConcurrent,
    };
  }

  /** Returns how long to wait before the request may proceed, and reserves it. */
  #awaitAdmission(host: string, source: SourceRecord | undefined): number {
    const { now } = this.#deps;
    const limits = this.#limits(source);
    const state = this.#buckets.get(host) ?? newBucket(limits, now());
    const decision = admit(state, limits, now());
    this.#buckets.set(host, decision.state);
    return decision.admitted ? 0 : Math.max(decision.retryAfterMs, 1);
  }

  #failure(
    composed: ComposedRequest,
    reason: FailureReason,
    status: number | null,
    attempts: number,
    detail: string,
    retryableAt: string | null,
  ): FailedFetchProvenance {
    return {
      kind: 'fetch-failed',
      sourceId: composed.sourceId,
      requestUrl: composed.displayUrl,
      httpStatus: status,
      attemptedAt: iso(this.#deps.now()),
      attempts,
      reason,
      detail,
      retryableAt,
    };
  }

  async #attempt(
    composed: ComposedRequest,
    cached: CacheEntry | null,
    signal: AbortSignal | undefined,
  ): Promise<AttemptResult> {
    const { fetchImpl } = this.#deps;
    const timeout = AbortSignal.timeout(composed.timeoutMs);
    const combined = signal ? anySignal([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetchImpl(composed.url, {
        headers: { ...composed.headers, ...revalidationHeaders(cached) },
        signal: combined,
      });
    } catch (error) {
      // A user abort and a timeout both surface as AbortError, and they are
      // different facts: one means nobody is waiting, the other means the origin
      // did not answer in time. Distinguishing them decides whether we retry.
      const aborted = signal?.aborted === true;
      return {
        kind: 'error',
        reason: aborted ? 'aborted' : isAbort(error) ? 'timeout' : 'network',
        status: null,
        detail: error instanceof Error ? error.message : String(error),
        retryAfterSeconds: null,
      };
    }

    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'), this.#deps.now());

    if (response.status === 304) return { kind: 'not-modified' };

    if (!response.ok) {
      return {
        kind: 'error',
        reason: reasonForStatus(response.status),
        status: response.status,
        detail: `upstream returned HTTP ${response.status}`,
        retryAfterSeconds,
      };
    }

    try {
      const raw: unknown = await response.json();
      return {
        kind: 'ok',
        raw,
        status: response.status,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    } catch (error) {
      // A 200 whose body will not parse is a shape failure, not a transport one,
      // and retryPlan refuses to retry it for that reason.
      return {
        kind: 'error',
        reason: 'shape',
        status: response.status,
        detail: `response body did not parse as JSON: ${error instanceof Error ? error.message : String(error)}`,
        retryAfterSeconds: null,
      };
    }
  }
}

type AttemptResult =
  | { kind: 'ok'; raw: unknown; status: number; etag: string | null; lastModified: string | null }
  | { kind: 'not-modified' }
  | {
      kind: 'error';
      reason: FailureReason;
      status: number | null;
      detail: string;
      retryAfterSeconds: number | null;
    };

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function safeRead(store: CacheStore, key: string): Promise<CacheEntry | null> {
  try {
    return await store.read(key);
  } catch {
    return null;
  }
}

async function safeWrite(store: CacheStore, entry: CacheEntry): Promise<void> {
  try {
    await store.write(entry);
  } catch {
    // Eviction and quota are the cache being a cache, not errors about data.
  }
}
