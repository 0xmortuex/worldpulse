/**
 * How fresh is a cached response, and may it still be served?
 *
 * Decisions F2 and F3, which are the ones with a rendering consequence:
 *
 *   F2  Stale-while-revalidate is the default, and A STALE VALUE NEVER RENDERS
 *       SILENTLY. It carries its age and a revalidating indicator. Stale and
 *       labelled beats a spinner; stale and unlabelled is a wrong-value error
 *       carrying a timestamp that lies — the timestamp is what makes it worse
 *       than showing nothing.
 *
 *   F3  The stale window is BOUNDED. Past `staleMultiple × ttlMs` a cached value
 *       stops being servable and becomes unavailable. An unbounded window lets a
 *       dead origin serve last year's number forever, which is F2's defect with
 *       a longer fuse and no indicator that ever escalates.
 */

export interface CacheEntry {
  cacheKey: string;
  raw: unknown;
  httpStatus: number;
  fetchedAt: string;
  etag: string | null;
  lastModified: string | null;
}

export type Freshness =
  /** Within TTL. Serve it, no request. */
  | { verdict: 'fresh'; ageMs: number }
  /** Past TTL, inside the bounded window. Serve it AND revalidate, labelled. */
  | { verdict: 'stale'; ageMs: number; note: string }
  /** Past the bounded window. Not servable — the value is too old to stand behind. */
  | { verdict: 'expired'; ageMs: number; reason: string }
  /** Nothing cached, or an entry we cannot date. */
  | { verdict: 'miss'; ageMs: null };

export interface FreshnessInput {
  entry: CacheEntry | null;
  /** null means static: pinned data that never expires. */
  ttlMs: number | null;
  staleMultiple: number;
  now: number;
}

export function freshness({ entry, ttlMs, staleMultiple, now }: FreshnessInput): Freshness {
  if (!entry) return { verdict: 'miss', ageMs: null };

  const fetchedAt = Date.parse(entry.fetchedAt);
  /**
   * An undateable entry is a MISS, not a hit.
   *
   * Treating it as fresh would serve a value whose age we cannot state, and F2's
   * whole condition is that a stale value carries its age. If we cannot say how
   * old it is, we cannot meet the condition, so we refetch. Rule 30: no answer
   * about the age is not an answer of "it is new".
   */
  if (Number.isNaN(fetchedAt)) return { verdict: 'miss', ageMs: null };

  const ageMs = Math.max(0, now - fetchedAt);

  // Static data: pinned, version-controlled, cannot drift. Never expires.
  if (ttlMs === null) return { verdict: 'fresh', ageMs };

  if (ageMs <= ttlMs) return { verdict: 'fresh', ageMs };

  const limit = ttlMs * staleMultiple;
  if (ageMs > limit) {
    return {
      verdict: 'expired',
      ageMs,
      reason:
        `cached ${describeAge(ageMs)} ago, past the ${staleMultiple}× refresh-interval limit ` +
        `(${describeAge(limit)}) — too old to serve`,
    };
  }

  return {
    verdict: 'stale',
    ageMs,
    // Wording, not a flag: this string is rendered, and F2 requires the age to
    // be visible rather than inferable.
    note: `cached ${describeAge(ageMs)} ago, refreshing now`,
  };
}

/** Human age, coarse on purpose — false precision on a cache age helps nobody. */
export function describeAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * The `CacheState` recorded in provenance for a given freshness verdict.
 *
 * Kept here rather than inlined at the call site so the inspector's cache badge
 * and this policy cannot disagree about what happened.
 */
export function cacheStateFor(verdict: Freshness['verdict']): 'hit' | 'miss' | 'stale-revalidating' {
  switch (verdict) {
    case 'fresh':
      return 'hit';
    case 'stale':
      return 'stale-revalidating';
    case 'expired':
    case 'miss':
      return 'miss';
  }
}

/** Conditional-request headers, when the entry gave us validators. */
export function revalidationHeaders(entry: CacheEntry | null): Record<string, string> {
  if (!entry) return {};
  const headers: Record<string, string> = {};
  if (entry.etag) headers['If-None-Match'] = entry.etag;
  if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  return headers;
}
