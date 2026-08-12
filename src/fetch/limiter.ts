/**
 * Per-host admission control: token bucket plus a concurrency ceiling.
 *
 * ## Keyed by HOST, never by source id (decision F5)
 *
 * Several registry entries share one origin. A per-source bucket would multiply
 * the real request rate against that server by the number of entries pointing at
 * it, and the 429s that follows get read back as the source's posture — which
 * has already happened once, to `wikidata-sparql`, whose "true" verdict was
 * decided by a header on an error response caused by our own request rate.
 *
 * ## Pure by construction (rule 32)
 *
 * No timers, no clock, no promises. `admit()` takes the bucket state and the
 * current time and returns a decision plus the next state. The scheduler that
 * owns the queue does the waiting; this only decides. That is what lets a
 * planted case put the bucket in an exhausted, refilling, or rate-limited state
 * without waiting a real minute for any of them.
 */

export interface BucketState {
  /** Tokens available, fractional between refills. */
  tokens: number;
  /** When `tokens` was last computed. */
  updatedAt: number;
  /** In-flight requests against this host. */
  active: number;
  /**
   * Set when the host told us to back off. Until this passes, nothing is
   * admitted regardless of tokens.
   */
  blockedUntil: number | null;
}

export interface BucketLimits {
  perMinute: number;
  burst: number;
  maxConcurrent: number;
}

export type Admission =
  | { admitted: true; state: BucketState }
  | { admitted: false; reason: 'no-tokens' | 'at-concurrency' | 'backing-off'; retryAfterMs: number; state: BucketState };

export function newBucket(limits: BucketLimits, now: number): BucketState {
  return { tokens: limits.burst, updatedAt: now, active: 0, blockedUntil: null };
}

/** Refill by elapsed time, capped at burst. Separated so it can be tested alone. */
export function refill(state: BucketState, limits: BucketLimits, now: number): BucketState {
  const elapsed = Math.max(0, now - state.updatedAt);
  const gained = (elapsed / 60_000) * limits.perMinute;
  return { ...state, tokens: Math.min(limits.burst, state.tokens + gained), updatedAt: now };
}

export function admit(state: BucketState, limits: BucketLimits, now: number): Admission {
  const filled = refill(state, limits, now);

  /**
   * A `Retry-After` outranks our own arithmetic.
   *
   * Checked FIRST, before tokens: a limiter that keeps its own opinion after
   * being told a number by the origin is a limiter that gets us banned. Our
   * bucket refilling is a guess about the host's policy; the header is the
   * policy.
   */
  if (filled.blockedUntil !== null && now < filled.blockedUntil) {
    return { admitted: false, reason: 'backing-off', retryAfterMs: filled.blockedUntil - now, state: filled };
  }

  if (filled.active >= limits.maxConcurrent) {
    // No useful estimate — it clears when something in flight finishes, not on
    // a clock. Reporting a made-up delay would be a number nobody measured.
    return { admitted: false, reason: 'at-concurrency', retryAfterMs: 0, state: filled };
  }

  if (filled.tokens < 1) {
    const needed = 1 - filled.tokens;
    const waitMs = Math.ceil((needed / limits.perMinute) * 60_000);
    return { admitted: false, reason: 'no-tokens', retryAfterMs: waitMs, state: filled };
  }

  return { admitted: true, state: { ...filled, tokens: filled.tokens - 1, active: filled.active + 1 } };
}

/** Call when a request finishes, however it finished. */
export function release(state: BucketState): BucketState {
  // Clamped at zero: a double release must not create capacity that does not
  // exist, which would let the ceiling drift upward over a long session.
  return { ...state, active: Math.max(0, state.active - 1) };
}

/**
 * Record a host's own instruction to back off.
 *
 * `retryAfterSeconds` comes from the header. A missing or unparseable value is
 * not zero — it is no instruction, and the caller keeps its own backoff.
 */
export function backOff(state: BucketState, retryAfterSeconds: number | null, now: number): BucketState {
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return state;
  const until = now + retryAfterSeconds * 1000;
  // Never shortens an existing block: two 429s in flight must not have the
  // second one relax the first.
  return { ...state, blockedUntil: Math.max(state.blockedUntil ?? 0, until) };
}

/**
 * Parse a `Retry-After` header, which may be seconds or an HTTP date.
 *
 * Returns null for anything it cannot read, which the caller treats as "no
 * instruction" rather than "retry immediately".
 */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, (date - now) / 1000);
}
