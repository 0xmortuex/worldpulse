import type { Fact, Tier } from '../facts/types';
import {
  expectArray,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'eia';

const SERVICE = 'https://api.eia.gov/v2/international/data/';

/**
 * EIA international energy data — country-level, 1949 to present.
 *
 * ## Why the international route rather than /v2/electricity/
 *
 * The registry's probe URL pointed at `/v2/electricity/`, which is **US states
 * only**. This app renders a dossier per country, so a US-only source can serve
 * exactly one of them. `/v2/international/` is country-level production,
 * consumption, imports and exports by energy source, with an explicit
 * country-versus-region flag. That is a change to what this source IS for this
 * app, not merely to how it is fetched, and it is recorded as such.
 *
 * ## The key never appears here
 *
 * `?api_key=` and an `X-Api-Key` header are both accepted (measured; 403
 * unauthenticated). The registry declares the query form because that is what
 * the Worker appends. This builder emits no key.
 */

/** Country-level rows only; `r` rows are regional aggregates. */
export const TYPE_COUNTRY = 'c';
export const TYPE_REGION = 'r';

/**
 * EIA's own data-quality flags, and what each one MEANS.
 *
 * This is the per-row provenance Ember does not publish (`OPEN-QUESTIONS` 17),
 * and most of these are distinctions this app's fact model exists to keep. The
 * value field carries a NON-NUMERIC SENTINEL for several of them, so a naive
 * `Number(value) || 0` renders `0` for "this country did not exist" and for
 * "counted under another entity" — false statements about the world, not merely
 * wrong numbers.
 */
export const DATA_FLAGS = {
  '1': 'unavailable-permanent',
  '2': 'unavailable-temporary',
  '3': 'country-did-not-exist',
  '4': 'included-elsewhere',
  '5': 'rounds-to-zero',
  '6': 'withheld',
  '10': 'steo-estimate',
  '11': 'row-initialised',
} as const;

export type DataFlag = (typeof DATA_FLAGS)[keyof typeof DATA_FLAGS];

export interface EnergyQuery {
  /** EIA product id, e.g. `2` for Electricity. */
  productId: string;
  /** EIA activity id: 1 Production, 2 Consumption, 3 Imports, 5 Stocks. */
  activityId: string;
  startYear: number;
  endYear: number;
  /** Rows to request; EIA caps a page at 5000. */
  length: number;
}

export function buildAnnualUrl(query: EnergyQuery): string {
  /**
   * Built by hand rather than with `URLSearchParams` for the same reason as
   * congress.gov (rule 37): EIA's bracketed array parameters —
   * `facets[activityId][]` — are percent-encoded to `facets%5BactivityId%5D%5B%5D`
   * by URLSearchParams, and an unrecognised parameter is IGNORED rather than
   * rejected. The response would be a successful 200 for a query nobody asked
   * for: every product, every activity, silently.
   *
   * The values are still encoded; only the bracket syntax is literal.
   */
  const p = (v: string | number) => encodeURIComponent(String(v));
  return (
    `${SERVICE}?frequency=annual&data[0]=value` +
    `&facets[productId][]=${p(query.productId)}` +
    `&facets[activityId][]=${p(query.activityId)}` +
    `&start=${p(query.startYear)}&end=${p(query.endYear)}` +
    `&sort[0][column]=period&sort[0][direction]=desc` +
    `&length=${p(query.length)}`
  );
}

export interface EnergyRow {
  countryRegionId: string;
  countryRegionName: string;
  /** `c` for a country, `r` for a regional aggregate. */
  countryRegionTypeId: string;
  year: number;
  productName: string;
  activityName: string;
  unit: string;
  unitName: string;
  /**
   * The number, or `null` when EIA published no usable figure.
   *
   * **`null` here never means zero.** Which KIND of absence it is lives in
   * `flag` — the country did not exist, the value is withheld, it is counted
   * elsewhere, or it is simply unavailable. Collapsing those into one blank is
   * the failure this adapter is shaped to prevent.
   */
  value: number | null;
  flag: DataFlag | null;
  flagDescription: string | null;
}

export interface EnergySeries {
  rows: EnergyRow[];
  /** Rows matching the query, from `response.total` — not the number returned. */
  totalAvailable: number | null;
}

/**
 * Parse EIA's `value`, which is a STRING and is not always a number.
 *
 * Measured sentinels, 2026-08-15:
 *
 *   "--"   the country did not exist in this period   (flag 3)
 *   "ie"   included elsewhere                          (flag 4)
 *   "w"    withheld — exists but cannot be published   (flag 6)
 *   "NA"   not available                               (flags 1, 2)
 *
 * A numeric parse of any of these yields `NaN`, and the idiom that usually
 * follows — `Number(v) || 0` — turns every one of them into a confident zero.
 *
 * Returns `null` for a sentinel and throws for a string that is neither a
 * sentinel nor a number, because an unrecognised token is schema drift and
 * guessing at it is how a new sentinel silently becomes zero.
 */
export function parseValue(raw: unknown, at: string): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') {
    throw new ShapeError(SOURCE_ID, `${at} is ${JSON.stringify(raw)}, expected a string or number`);
  }

  const text = raw.trim();
  if (text === '') return null;
  // Sentinels, lower-cased: EIA is consistent but this costs nothing.
  if (['--', 'ie', 'w', 'na', 'nm', '(s)'].includes(text.toLowerCase())) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new ShapeError(
      SOURCE_ID,
      `${at} is "${text}", which is neither a number nor a known sentinel (--, ie, w, NA). ` +
        'An unrecognised token is schema drift; treating it as zero or as absent would hide it',
    );
  }
  return parsed;
}

export function parse(payload: unknown): EnergySeries {
  const root = expectObject(SOURCE_ID, payload, 'response');
  const response = expectObject(SOURCE_ID, root['response'], 'response.response');
  const data = expectArray(SOURCE_ID, response['data'], 'response.data');

  const rows = data.map((entry, index): EnergyRow => {
    const row = expectObject(SOURCE_ID, entry, `data[${index}]`);

    const period = expectString(SOURCE_ID, row['period'], `data[${index}].period`);
    if (!/^\d{4}$/.test(period)) {
      throw new ShapeError(SOURCE_ID, `data[${index}].period is "${period}", expected a four-digit year`);
    }

    /**
     * The flag arrives as a string id or null. An id we do not recognise is a
     * hard failure rather than a shrug: the flags carry the difference between
     * "withheld" and "zero", and an unmapped one would render as an ordinary
     * value with no qualification at all.
     */
    const rawFlag = row['dataFlagId'];
    let flag: DataFlag | null = null;
    if (rawFlag !== null && rawFlag !== undefined && rawFlag !== '') {
      const mapped = DATA_FLAGS[String(rawFlag) as keyof typeof DATA_FLAGS];
      if (mapped === undefined) {
        throw new ShapeError(
          SOURCE_ID,
          `data[${index}].dataFlagId is ${JSON.stringify(rawFlag)}, which this adapter does not ` +
            'know. A flag carries the difference between withheld and zero, so an unmapped one ' +
            'must not render as an ordinary value',
        );
      }
      flag = mapped;
    }

    const typeId = expectString(SOURCE_ID, row['countryRegionTypeId'], `data[${index}].countryRegionTypeId`);
    if (typeId !== TYPE_COUNTRY && typeId !== TYPE_REGION) {
      throw new ShapeError(
        SOURCE_ID,
        `data[${index}].countryRegionTypeId is "${typeId}", expected "c" or "r" — without a ` +
          'reliable country/region split, summing rows double-counts',
      );
    }

    return {
      countryRegionId: expectString(SOURCE_ID, row['countryRegionId'], `data[${index}].countryRegionId`),
      countryRegionName: expectString(SOURCE_ID, row['countryRegionName'], `data[${index}].countryRegionName`),
      countryRegionTypeId: typeId,
      year: Number(period),
      productName: expectString(SOURCE_ID, row['productName'], `data[${index}].productName`),
      activityName: expectString(SOURCE_ID, row['activityName'], `data[${index}].activityName`),
      unit: expectString(SOURCE_ID, row['unit'], `data[${index}].unit`),
      unitName: expectString(SOURCE_ID, row['unitName'], `data[${index}].unitName`),
      value: parseValue(row['value'], `data[${index}].value`),
      flag,
      flagDescription:
        row['dataFlagDescription'] === null || row['dataFlagDescription'] === undefined
          ? null
          : String(row['dataFlagDescription']),
    };
  });

  const total = typeof response['total'] === 'number' ? response['total'] : null;
  return { rows, totalAvailable: total };
}

/** Countries only. Regional aggregates would double-count against their members. */
export function countriesOnly(rows: readonly EnergyRow[]): EnergyRow[] {
  return rows.filter((row) => row.countryRegionTypeId === TYPE_COUNTRY);
}

/**
 * A row as a Fact, with the tier decided BY THE SOURCE'S OWN FLAG.
 *
 * ## This is what `OPEN-QUESTIONS` 17 wanted and Ember could not give
 *
 * Ember publishes no per-row provenance, so every Ember row is `OFFICIAL` at
 * source level with the limitation recorded. EIA publishes exactly the missing
 * distinction: flag `10` marks values derived by STEO estimation methodology.
 * Those rows are `ESTIMATE` — not because we doubt them, but because **the
 * source says so**, which is the only ground this project accepts for a tier.
 *
 * ## The notes are not decoration
 *
 * A `null` value with flag `country-did-not-exist` is a different statement from
 * a `null` with flag `withheld`, and both differ from a plain absence. The note
 * carries which, so the inspector can say why the figure is missing rather than
 * only that it is.
 */
export function valueFact(row: EnergyRow, ctx: FetchContext): Fact<number> {
  const tier: Tier = row.flag === 'steo-estimate' ? 'ESTIMATE' : 'OFFICIAL';

  const NOTE: Record<DataFlag, string | null> = {
    'unavailable-permanent': 'EIA records this figure as permanently unavailable.',
    'unavailable-temporary': 'EIA records this figure as temporarily unavailable.',
    'country-did-not-exist': 'This country did not exist during this statistical period.',
    'included-elsewhere': 'EIA counts this figure under another entity for this period, not here.',
    'rounds-to-zero':
      'A real value that rounds to zero at the published precision — not an absence, and not exactly zero.',
    withheld: 'A value exists but EIA cannot publish it.',
    'steo-estimate': 'Derived using EIA’s Short-Term Energy Outlook estimation methodology.',
    'row-initialised': 'EIA has initialised this row but published no figure for it.',
  };

  const note = row.flag === null ? null : NOTE[row.flag];

  return {
    value: row.value,
    asOf: String(row.year),
    tier,
    provenance: fetchProvenance(
      SOURCE_ID,
      ctx,
      { row },
      row.flag === null
        ? 'value for the requested product and activity'
        : `value with EIA data flag "${row.flag}"`,
    ),
    ...(note === null ? {} : { note }),
    format: (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${row.unit}`,
  };
}
