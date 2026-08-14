import type { Fact } from '../facts/types';
import {
  expectArray,
  expectObject,
  expectNumber,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'unhcr-population';

const SERVICE = 'https://api.unhcr.org/population/v1/population/';

/**
 * The displacement figures UNHCR publishes per country.
 *
 * Names are UNHCR's own field names rather than prettier synonyms, so a reader
 * comparing this against the Refugee Data Finder is comparing like with like.
 */
export const POPULATION_FIELDS = [
  'refugees',
  'asylum_seekers',
  'returned_refugees',
  'idps',
  'returned_idps',
  'stateless',
  'ooc',
  'oip',
  'hst',
] as const;

export type PopulationField = (typeof POPULATION_FIELDS)[number];

export interface CountryDisplacement {
  iso3: string;
  name: string;
  year: number;
  figures: Record<PopulationField, Fact<number>>;
}

export interface PopulationQuery {
  year: number;
  /** `asylum` breaks the totals down by country of asylum, `origin` by country of origin. */
  breakdown: 'asylum' | 'origin';
  limit: number;
}

/**
 * The app's own request construction, exported so fixtures derive their URL from
 * here rather than repeating it (rule 26).
 *
 * The breakdown parameter is not optional in practice: without `coa_all` or
 * `coo_all` the API returns a SINGLE world-aggregate row with `coa_iso: "-"`,
 * which looks like a successful per-country response until you read it.
 */
export function buildPopulationUrl(query: PopulationQuery): string {
  const params = new URLSearchParams({
    year: String(query.year),
    limit: String(query.limit),
    [query.breakdown === 'asylum' ? 'coa_all' : 'coo_all']: 'true',
  });

  return `${SERVICE}?${params.toString()}`;
}

/**
 * THE THREE STATES UNHCR ENCODES, AND WHY THEY MUST NOT COLLAPSE.
 *
 * A single row mixes types, and the types carry the meaning:
 *
 *   5079    number         a reported figure
 *   "0"     string zero    a reported ZERO — UNHCR asked and the answer was none
 *   "-"     string dash    NO DATA — UNHCR has no figure for this country/field
 *
 * Measured across the 2023 asylum breakdown: 662 numbers, 778 reported zeros,
 * 162 dashes, with 162 of 178 countries carrying both a zero and a dash.
 *
 * **`Number("-")` is `NaN`, so the obvious `Number(value) || 0` renders "no
 * data" as a reported zero.** That is the false fact this project stops for: it
 * would tell a reader UNHCR counted zero stateless people somewhere UNHCR never
 * counted at all. Rule 30 — no answer is not an answer of none.
 *
 * `null` is the app's "asked and got nothing", which renders as **no data**; `0`
 * renders as a value. They are different badges and different sentences, and the
 * distinction is asserted in `tests/unhcr-contract.test.ts` rather than trusted.
 */
export function readFigure(raw: unknown): number | null {
  if (raw === '-' || raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-') return null;
    const parsed = Number(trimmed);
    // A string that is not a number is not a zero either. Anything unrecognised
    // becomes "no data" rather than being coerced into a figure.
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parse(raw: unknown, ctx: FetchContext, sourceId = SOURCE_ID): CountryDisplacement[] {
  const root = expectObject(sourceId, raw, 'root');
  const rows = expectArray(sourceId, root['items'], 'items');

  const out: CountryDisplacement[] = [];

  for (const [index, row] of rows.entries()) {
    const at = `items[${index}]`;
    const record = expectObject(sourceId, row, at);

    const iso3 = record['coa_iso'] !== '-' ? record['coa_iso'] : record['coo_iso'];
    const name = record['coa_name'] !== '-' ? record['coa_name'] : record['coo_name'];

    /**
     * The world-aggregate row carries `"-"` for BOTH codes. It is a real row and
     * a real total, but it is not a country, and letting it through would put a
     * global figure under whichever country happened to look it up.
     */
    if (typeof iso3 !== 'string' || iso3 === '-' || iso3 === '') continue;

    const year = expectNumber(sourceId, record['year'], `${at}.year`);

    const figures = {} as Record<PopulationField, Fact<number>>;
    for (const field of POPULATION_FIELDS) {
      if (!(field in record)) {
        throw new ShapeError(sourceId, `${at} is missing the ${field} field`);
      }
      figures[field] = {
        value: readFigure(record[field]),
        asOf: String(year),
        // UNHCR is the primary source for displacement statistics: these are
        // counts it compiles from governments and its own operations, not
        // estimates it models. A modelled figure would be ESTIMATE.
        tier: 'OFFICIAL',
        provenance: fetchProvenance(sourceId, ctx, raw, `${at}.${field}`),
      };
    }

    out.push({ iso3, name: typeof name === 'string' ? name : iso3, year, figures });
  }

  return out;
}

/**
 * Look one country up out of a parsed response.
 *
 * **A country with no row is NOT a country with zeros.** 73 ISO3 codes have no
 * row in the 2023 asylum breakdown at all, and returning zeros for them would
 * invent 73 countries' worth of displacement figures. `null` here means the
 * caller must render "no data", which is the honest claim: UNHCR published
 * nothing for this country, and we do not know what the true figure is.
 */
export function findCountry(
  parsed: readonly CountryDisplacement[],
  iso3: string,
): CountryDisplacement | null {
  return parsed.find((row) => row.iso3 === iso3) ?? null;
}
