import type { Fact, Tier } from '../facts/types';
import {
  expectArray,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'comtrade';

const SERVICE = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';

/**
 * UN Comtrade — annual merchandise trade, one reporter against every partner.
 *
 * ## The key never appears here
 *
 * Comtrade sits behind Azure API Management, which accepts either
 * `?subscription-key=` or an `Ocp-Apim-Subscription-Key` header (both measured;
 * 401 unauthenticated). The parameter name is the gateway's, not Comtrade's.
 * The registry declares the query form; this builder emits no key.
 *
 * ## 500 calls a day, and a burst limit that answers 429
 *
 * Two requests in quick succession returned `429` during development. This is
 * emphatically a Worker-cached source and must never be fetched per visitor —
 * the registry already says so, and the rate limit is why.
 *
 * ## SUCCESS IS IN THE BODY (rule 37)
 *
 * The envelope carries `error`, a STRING that is `""` on success. A response can
 * be 200 with a populated `error`, so status alone does not establish that the
 * query was answered.
 */

/** Every commodity, summed — Comtrade's own total, not one we compute. */
export const CMD_TOTAL = 'TOTAL';

export interface TradeQuery {
  /** Comtrade numeric reporter code, e.g. 842 for the USA. */
  reporterCode: number;
  year: number;
  /** `X` exports, `M` imports. */
  flowCode: 'X' | 'M';
}

export function buildAnnualTradeUrl(query: TradeQuery): string {
  const p = (v: string | number) => encodeURIComponent(String(v));
  /**
   * `cmdCode=TOTAL` is not an optimisation, it is the query.
   *
   * Without it Comtrade returns every HS line — 100,000 rows for one
   * reporter-year-flow, mixing individual commodity codes with the `999999`
   * all-commodities row in the same list. Summing that response double-counts
   * the entire trade of the country, and it looks like a plausible number
   * because it is roughly twice a plausible number.
   */
  return (
    `${SERVICE}?reporterCode=${p(query.reporterCode)}` +
    `&period=${p(query.year)}` +
    `&flowCode=${p(query.flowCode)}` +
    `&cmdCode=${p(CMD_TOTAL)}`
  );
}

export interface TradeRow {
  reporterCode: number;
  partnerCode: number;
  year: number;
  flowCode: string;
  cmdCode: string;
  /** Trade value in current US dollars. */
  primaryValue: number | null;
  /**
   * Did the REPORTER report this, or is it derived?
   *
   * `false` means the figure did not come from the reporting country's own
   * submission — Comtrade fills gaps from the partner's mirror data and from
   * estimation. A number the country never reported is not an official statistic
   * of that country, and the tier says so.
   */
  isReported: boolean;
  /** Comtrade's own flag that this row sums other rows. */
  isAggregate: boolean;
  /** Comtrade estimated the QUANTITY. Says nothing about the monetary value. */
  quantityEstimated: boolean;
  /** Comtrade estimated a WEIGHT. Says nothing about the monetary value. */
  weightEstimated: boolean;
  /**
   * A CODE whose meanings are undocumented to us — measured values 0, 2, 4, 6.
   * Carried verbatim and deliberately not interpreted (`OPEN-QUESTIONS` 25).
   */
  legacyEstimationFlag: number;
}

export interface TradeReport {
  rows: TradeRow[];
  /** Rows Comtrade says matched, from the envelope. */
  count: number | null;
}

function optionalNumber(value: unknown, at: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ShapeError(SOURCE_ID, `${at} is ${JSON.stringify(value)}, expected a number or null`);
  }
  return value;
}

function requiredNumber(value: unknown, at: string): number {
  const parsed = optionalNumber(value, at);
  if (parsed === null) throw new ShapeError(SOURCE_ID, `${at} is missing`);
  return parsed;
}

/** A flag that is absent is not a flag that is false — but for booleans Comtrade is consistent. */
function flag(value: unknown, at: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (value === 0 || value === 1) return value === 1;
  throw new ShapeError(SOURCE_ID, `${at} is ${JSON.stringify(value)}, expected a boolean`);
}

export function parse(payload: unknown): TradeReport {
  const root = expectObject(SOURCE_ID, payload, 'response');

  /**
   * RULE 37: the body decides, not the status.
   *
   * `error` is `""` on success. A non-empty value means the query was not
   * answered, whatever the status line said, and continuing to parse `data`
   * would build facts out of an error response.
   */
  const error = root['error'];
  if (typeof error === 'string' && error.trim() !== '') {
    throw new ShapeError(SOURCE_ID, `the envelope carries an error: ${error}`);
  }

  const data = expectArray(SOURCE_ID, root['data'], 'data');

  const rows = data.map((entry, index): TradeRow => {
    const row = expectObject(SOURCE_ID, entry, `data[${index}]`);

    return {
      reporterCode: requiredNumber(row['reporterCode'], `data[${index}].reporterCode`),
      partnerCode: requiredNumber(row['partnerCode'], `data[${index}].partnerCode`),
      year: requiredNumber(row['refYear'], `data[${index}].refYear`),
      flowCode: expectString(SOURCE_ID, row['flowCode'], `data[${index}].flowCode`),
      cmdCode: expectString(SOURCE_ID, row['cmdCode'], `data[${index}].cmdCode`),
      primaryValue: optionalNumber(row['primaryValue'], `data[${index}].primaryValue`),
      isReported: flag(row['isReported'], `data[${index}].isReported`),
      isAggregate: flag(row['isAggregate'], `data[${index}].isAggregate`),
      /**
       * QUANTITY AND WEIGHT ESTIMATION ARE NOT VALUE ESTIMATION.
       *
       * **Corrected 2026-08-15** by the OPEN-QUESTIONS 20 experiment. The first
       * version folded `isQtyEstimated`, `isNetWgtEstimated`,
       * `isGrossWgtEstimated` and `legacyEstimationFlag` into one boolean, with
       * the comment "for a value fact they all mean the same thing". That was
       * wrong twice over:
       *
       * 1. An estimated WEIGHT says nothing about whether the monetary VALUE is
       *    estimated. Measured: the USA→Canada 2023 TOTAL carries
       *    `isNetWgtEstimated: true` and `isQtyEstimated: false`, while its
       *    `primaryValue` is the exact sum of 5,226 reported HS6 lines.
       * 2. `legacyEstimationFlag` IS A CODE, NOT A BOOLEAN — measured values
       *    0, 2, 4 and 6 across one response. Treating non-zero as "estimated"
       *    lumped three distinct meanings together and marked 1,768 of 6,536
       *    rows as estimates on an inference. See OPEN-QUESTIONS 25.
       *
       * These are kept as they arrive so a caller can qualify a QUANTITY fact
       * with them, and nothing here is interpreted into a value's tier.
       */
      quantityEstimated: flag(row['isQtyEstimated'], `data[${index}].isQtyEstimated`),
      weightEstimated:
        flag(row['isNetWgtEstimated'], `data[${index}].isNetWgtEstimated`) ||
        flag(row['isGrossWgtEstimated'], `data[${index}].isGrossWgtEstimated`),
      legacyEstimationFlag: requiredNumber(
        row['legacyEstimationFlag'] ?? 0,
        `data[${index}].legacyEstimationFlag`,
      ),
    };
  });

  return { rows, count: optionalNumber(root['count'], 'count') };
}

/**
 * A trade value as a Fact, with the tier taken from Comtrade's own flags.
 *
 * ## `isReported: false` on an AGGREGATE row is not doubt — measured
 *
 * **Corrected 2026-08-15 by the `OPEN-QUESTIONS` 20 experiment.** The first
 * version read `isReported: false` as "the reporting country never submitted
 * this figure" and rendered every Comtrade country total as `ESTIMATE`. The
 * experiment — one `TOTAL` row against the HS lines beneath it — showed
 * otherwise:
 *
 * | Level | rows | `isReported` | `isAggregate` |
 * | --- | --- | --- | --- |
 * | HS6 leaves | 5,226 | **all true** | none |
 * | HS4 | 1,212 | all false | all true |
 * | HS2 | 97 | all false | all true |
 * | TOTAL | 1 | false | true |
 *
 * And the arithmetic is exact: the 5,226 reported HS6 lines sum to
 * **352,760,090,331**, the TOTAL to the dollar — 0.0000%.
 *
 * So `isReported` is true at the leaf and false at every aggregation level. It
 * describes **the row**, not the data beneath it: the UN did the addition, and
 * the lines being added are the reporter's own. An aggregate is therefore
 * `OFFICIAL` with the aggregation disclosed, because "who did this arithmetic"
 * is exactly what a tier should say — and saying `ESTIMATE` would have
 * understated a primary source across every country total in the app.
 *
 * ## What still earns ESTIMATE
 *
 * A row that is NEITHER reported NOR an aggregate: Comtrade fills gaps with the
 * partner's mirror data, and a figure the reporter never submitted and nobody
 * aggregated is genuinely not that country's statistic.
 *
 * Quantity and weight estimation flags do **not** feed this. They describe
 * quantities and weights; `primaryValue` is money.
 */
export function tradeValueFact(row: TradeRow, ctx: FetchContext): Fact<number> {
  const mirrored = !row.isReported && !row.isAggregate;
  const tier: Tier = mirrored ? 'ESTIMATE' : 'OFFICIAL';

  const reasons: string[] = [];
  if (mirrored) {
    reasons.push('The reporting country did not submit this figure; Comtrade derived it.');
  }
  if (row.isAggregate) {
    reasons.push('A UN-computed total of the reporting country’s own commodity lines.');
  }
  if (row.quantityEstimated || row.weightEstimated) {
    reasons.push('Comtrade estimated the quantity or weight; the trade value is unaffected.');
  }

  return {
    value: row.primaryValue,
    asOf: String(row.year),
    tier,
    provenance: fetchProvenance(
      SOURCE_ID,
      ctx,
      { row },
      row.isReported ? 'primaryValue as reported' : 'primaryValue, derived by Comtrade',
    ),
    ...(reasons.length === 0 ? {} : { note: reasons.join(' ') }),
    format: (value: number) => `US$${value.toLocaleString('en-US')}`,
  };
}

/** Rows for real partner countries, excluding Comtrade's World aggregate (code 0). */
export const PARTNER_WORLD = 0;

export function partnersOnly(rows: readonly TradeRow[]): TradeRow[] {
  return rows.filter((row) => row.partnerCode !== PARTNER_WORLD);
}
