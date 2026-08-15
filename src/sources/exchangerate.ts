import type { Fact } from '../facts/types';
import { expectObject, fetchProvenance, ShapeError, type FetchContext } from './adapter';

const SOURCE_ID = 'exchangerate-host';

const SERVICE = 'https://api.exchangerate.host/live';

/**
 * exchangerate.host — currency quotes against a single base.
 *
 * ## THE STATUS LINE IS ALWAYS 200 (rule 37)
 *
 * Measured 2026-08-15:
 *
 *   no key    200  {"success":false,"error":{"code":101,"type":"missing_access_key",...}}
 *   with key  200  {"success":true,...,"quotes":{"USDEUR":0.864504,...}}
 *
 * Both succeed at the transport layer. `success` is the only thing that
 * distinguishes a rate from an authentication failure, and any check scoring on
 * the status code reads a broken key as a working one — which is exactly what
 * happened to the auth sweep that measured this source.
 *
 * ## The key is PUBLIC, and that is a decision not an accident
 *
 * `VITE_EXCHANGERATE_HOST_KEY` is inlined into the client bundle by Vite, so it
 * is served to every visitor. That is acceptable only while it grants nothing
 * beyond the free tier, and the registry says so. It also means this source
 * differs from every other key-gated one here: the key is not a secret, so
 * routing through the Worker buys caching and rate-limit control rather than
 * secrecy.
 */

export interface QuotesQuery {
  /** ISO 4217 base currency, e.g. `USD`. */
  source: string;
  /** ISO 4217 targets. Empty means "everything the plan allows". */
  currencies: readonly string[];
}

export function buildQuotesUrl(query: QuotesQuery): string {
  const params = new URLSearchParams({ source: query.source });
  if (query.currencies.length > 0) params.set('currencies', query.currencies.join(','));
  return `${SERVICE}?${params.toString()}`;
}

/**
 * The API answered, and said no.
 *
 * A distinct type from `ShapeError` because these are different questions, and
 * this project already separates them elsewhere: `ShapeError` means the contract
 * drifted and someone must look at the adapter; this means the request was
 * understood and refused, which is usually a key or a quota and needs no code
 * change at all.
 */
export class ExchangeRateApiError extends Error {
  override readonly name = 'ExchangeRateApiError';
  constructor(
    readonly code: number,
    readonly type: string,
    info: string,
  ) {
    super(`${SOURCE_ID}: API returned success:false — ${type} (${code}): ${info}`);
  }
}

/** Error codes worth distinguishing, from the vendor's documented list. */
export const MISSING_KEY = 101;
export const INVALID_KEY = 101;
export const QUOTA_EXCEEDED = 104;

export interface Quotes {
  /** Base currency the quotes are against. */
  source: string;
  /** When the vendor says the rates were taken, as an ISO instant. */
  asOf: string;
  /** Target currency code to rate, with the base stripped from the key. */
  rates: Map<string, number>;
}

export function parse(payload: unknown): Quotes {
  const root = expectObject(SOURCE_ID, payload, 'response');

  /**
   * SUCCESS IS THE FIRST QUESTION, and it is answered by the body.
   *
   * Checked before anything else is read: a failure response has no `quotes` at
   * all, so every subsequent access would report a shape problem for what is
   * really a refused request.
   */
  if (root['success'] !== true) {
    const error = root['error'];
    if (error && typeof error === 'object') {
      const detail = error as Record<string, unknown>;
      throw new ExchangeRateApiError(
        typeof detail['code'] === 'number' ? detail['code'] : -1,
        typeof detail['type'] === 'string' ? detail['type'] : 'unknown',
        typeof detail['info'] === 'string' ? detail['info'] : '(no detail)',
      );
    }
    // `success` false with no error object IS a shape problem: the vendor
    // documents an error object on every failure.
    throw new ShapeError(SOURCE_ID, 'success is not true and no error object was supplied');
  }

  const source = root['source'];
  if (typeof source !== 'string' || source.length !== 3) {
    throw new ShapeError(SOURCE_ID, `source is ${JSON.stringify(source)}, expected a 3-letter code`);
  }

  const timestamp = root['timestamp'];
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new ShapeError(SOURCE_ID, `timestamp is ${JSON.stringify(timestamp)}, expected unix seconds`);
  }

  const quotes = expectObject(SOURCE_ID, root['quotes'], 'quotes');
  const rates = new Map<string, number>();

  for (const [pair, value] of Object.entries(quotes)) {
    /**
     * Keys are CONCATENATED pairs — `USDEUR`, not `EUR`. ISO 4217 codes are
     * always three letters, so the split is positional and unambiguous, but it
     * is asserted rather than assumed: a six-character key that does not start
     * with the declared base means the response is not what it claims to be.
     */
    if (pair.length !== 6) {
      throw new ShapeError(SOURCE_ID, `quotes key "${pair}" is not a six-letter currency pair`);
    }
    if (!pair.startsWith(source)) {
      throw new ShapeError(
        SOURCE_ID,
        `quotes key "${pair}" does not start with the declared source "${source}" — ` +
          'the response mixes bases, and stripping the first three letters would mislabel it',
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ShapeError(SOURCE_ID, `quotes.${pair} is ${JSON.stringify(value)}, expected a number`);
    }
    rates.set(pair.slice(3), value);
  }

  return { source, asOf: new Date(timestamp * 1000).toISOString(), rates };
}

/**
 * One currency's rate as a Fact.
 *
 * ## Tier: OFFICIAL, and the note says whose
 *
 * A market rate is a real observation from a market data vendor, not a
 * derivation of ours and not an estimate. But it is a VENDOR's rate rather than
 * a central bank's, and the two can differ — so the note names the vendor. The
 * app's primary currency source is Frankfurter (ECB, keyless); this is a
 * fallback for currencies the ECB does not cover, and a reader comparing the
 * two should know which they are looking at.
 */
export function rateFact(quotes: Quotes, currency: string, ctx: FetchContext): Fact<number> {
  const rate = quotes.rates.get(currency);
  return {
    // Absent means the vendor did not quote this currency, which is rule 30's
    // "no answer" — never a rate of zero.
    value: rate === undefined ? null : rate,
    asOf: quotes.asOf,
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, { source: quotes.source, currency, rate: rate ?? null }, `quotes.${quotes.source}${currency}`),
    note: 'Vendor market rate (exchangerate.host / currencylayer), not a central bank reference rate.',
    format: (value: number) => `${value.toFixed(6)} ${currency} per ${quotes.source}`,
  };
}
