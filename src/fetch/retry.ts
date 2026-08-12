import type { FailureReason } from '../facts/types';

/**
 * Whether a failed attempt is retried, and when.
 *
 * ## The never-retry rows carry the weight (decision F7)
 *
 * Each has a DIFFERENT reason, and collapsing them into "don't retry 4xx" would
 * lose the two that matter most:
 *
 *   4xx (not 408/425/429)  The request is wrong. Repeating it asks the same
 *                          wrong question louder.
 *
 *   ShapeError             The origin answered CORRECTLY and our parse
 *                          disagreed. Retrying hides schema drift, which is the
 *                          single failure mode contract tests exist to catch —
 *                          so a retry here does not merely waste a request, it
 *                          suppresses the alarm.
 *
 *   Abort                  Nobody is waiting for the answer. The selection
 *                          changed (F6), and retrying spends budget on a result
 *                          that will be discarded on arrival.
 *
 *   Repeated timeout       A query that cannot complete is a DESIGN DEFECT, not
 *                          a slow source. `buildLegislatureQuery` exceeds WDQS's
 *                          ~60s ceiling for every country tried including
 *                          single-chamber Vatican City. Uniform retry would turn
 *                          that diagnosable fault into intermittent panel
 *                          flicker — which is precisely why it was reclassified.
 */

export interface Attempt {
  reason: FailureReason;
  httpStatus: number | null;
  /** 1-based: the attempt that just failed. */
  attempt: number;
  /** From the host, in ms. Overrides our schedule when present. */
  retryAfterMs: number | null;
}

export interface RetryPlan {
  retry: boolean;
  delayMs: number;
  /** Stated so a refusal to retry is legible in the inspector, not silent. */
  reason: string;
}

export const MAX_ATTEMPTS = 3;

/** 400ms, 1.2s, 3.6s. Jitter is applied by the caller, which owns randomness. */
const SCHEDULE_MS = [400, 1200, 3600];

/** Statuses that mean "later", not "wrong". */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

/**
 * Timeouts get ONE retry, not the full ladder.
 *
 * One covers a genuine blip. Three converts a query that structurally cannot
 * finish into three times the wait and a flickering panel, while hiding the
 * shape of the fault from whoever has to diagnose it.
 */
const MAX_TIMEOUT_ATTEMPTS = 2;

export function retryPlan(attempt: Attempt): RetryPlan {
  const no = (reason: string): RetryPlan => ({ retry: false, delayMs: 0, reason });

  switch (attempt.reason) {
    case 'aborted':
      return no('the selection changed and nobody is waiting for this answer');

    case 'shape':
      return no(
        'the origin answered correctly and our parse disagreed — retrying would hide schema drift, ' +
          'which is the failure contract tests exist to catch',
      );

    case 'http': {
      const status = attempt.httpStatus;
      if (status !== null && status >= 400 && status < 500 && !RETRYABLE_STATUSES.has(status)) {
        return no(`HTTP ${status} means the request is wrong; repeating it asks the same wrong question`);
      }
      break;
    }

    case 'rate-limited':
    case 'network':
    case 'timeout':
      break;
  }

  const cap = attempt.reason === 'timeout' ? MAX_TIMEOUT_ATTEMPTS : MAX_ATTEMPTS;
  if (attempt.attempt >= cap) {
    return no(
      attempt.reason === 'timeout'
        ? `timed out ${attempt.attempt} times — a request that cannot complete is a design problem, not a slow source`
        : `${attempt.attempt} attempts exhausted`,
    );
  }

  /**
   * A host's own instruction outranks our schedule — but only upward.
   *
   * Taking the max rather than the header alone stops a `Retry-After: 0` from
   * turning our backoff into a hot loop against a host that is already
   * struggling.
   */
  const scheduled = SCHEDULE_MS[Math.min(attempt.attempt - 1, SCHEDULE_MS.length - 1)] ?? 3600;
  const delayMs = attempt.retryAfterMs !== null ? Math.max(attempt.retryAfterMs, scheduled) : scheduled;

  return {
    retry: true,
    delayMs,
    reason:
      attempt.retryAfterMs !== null
        ? `retrying after the host's Retry-After (${attempt.retryAfterMs}ms, floored at our ${scheduled}ms)`
        : `retrying after ${scheduled}ms`,
  };
}

/**
 * Jitter, applied by the caller so this module stays pure.
 *
 * ±25%, to stop a dossier's parallel requests resynchronising onto one origin
 * after a shared failure — which is how a transient outage turns into a
 * self-inflicted thundering herd.
 */
export function jitter(delayMs: number, random: number): number {
  const factor = 0.75 + Math.min(Math.max(random, 0), 1) * 0.5;
  return Math.round(delayMs * factor);
}

export function reasonForStatus(status: number): FailureReason {
  if (status === 429) return 'rate-limited';
  return 'http';
}
