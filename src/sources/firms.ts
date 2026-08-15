import type { Fact } from '../facts/types';
import { fetchProvenance, ShapeError, type FetchContext } from './adapter';

const SOURCE_ID = 'nasa-firms';

const SERVICE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * NASA FIRMS — active fire / thermal anomaly detections.
 *
 * ## WHAT THIS DATA IS, AND THE ONE THING IT IS NOT
 *
 * A **thermal anomaly**: a satellite sensor measured radiance in a pixel
 * consistent with fire. That is all. It is never a strike, shelling, an
 * explosion, or combat of any kind. **A fire pixel is a fire pixel.**
 *
 * This is a standing prohibition (`SPEC-EXPANSION.md` Phase A5), and it is the
 * feature rather than a caveat on it. The label is asserted in the contract
 * test, not merely written here, because a rule that lives only in a comment is
 * one refactor away from gone.
 *
 * Gas flares, agricultural burning, industrial heat and volcanoes all produce
 * detections. So does a wildfire. The sensor cannot tell them apart, and neither
 * can this app.
 *
 * ## The key is in the PATH, so the builder emits a placeholder
 *
 * `/api/area/csv/<MAP_KEY>/VIIRS_NOAA20_NRT/...` — measured; a bogus key returns
 * `401 Invalid MAP_KEY.`. A path key is the most dangerous placement for a
 * secret: it is structurally part of the URL rather than a droppable parameter,
 * so anything recording a request URL carries it. This builder emits
 * `{MAP_KEY}` and only the fetch substitutes.
 */
export const KEY_PLACEHOLDER = '{MAP_KEY}';

/**
 * The label this data may carry. Exported so the contract test asserts it rather
 * than trusting a comment.
 */
export const LABEL = 'thermal anomalies';

/**
 * Words this source's rendering must never use. Asserted, not remembered.
 *
 * Not an exhaustive list of every wrong word — an exhaustive list is impossible.
 * It is the specific vocabulary the spec names, so a future change that reaches
 * for it fails a test instead of shipping.
 */
export const FORBIDDEN_TERMS = ['strike', 'shelling', 'combat', 'attack', 'bombing'] as const;

export interface FirmsQuery {
  /** Satellite product, e.g. `VIIRS_NOAA20_NRT`. */
  source: string;
  /** west, south, east, north. */
  bbox: readonly [number, number, number, number];
  /** Days back from today, 1–10. */
  dayRange: number;
}

export function buildAreaUrl(query: FirmsQuery): string {
  if (query.dayRange < 1 || query.dayRange > 10 || !Number.isInteger(query.dayRange)) {
    throw new ShapeError(SOURCE_ID, `dayRange ${query.dayRange} is outside FIRMS' documented 1–10`);
  }
  return `${SERVICE}/${KEY_PLACEHOLDER}/${encodeURIComponent(query.source)}/${query.bbox.join(',')}/${query.dayRange}`;
}

/**
 * Metres per degree of latitude. Constant enough for this purpose: the
 * variation with latitude is under 1%, and the quantity being derived is a
 * count of decimal places.
 */
const METRES_PER_DEGREE = 111_320;

/**
 * HOW MANY DECIMAL PLACES A FOOTPRINT JUSTIFIES — B4, as arithmetic.
 *
 * FIRMS reports each detection's pixel size in `scan` and `track` (km), and
 * reports its coordinates to five decimals — about 1.1 m — for a pixel that
 * measured 630 m × 720 m. **Five decimals for a 630 m pixel is a lie told in the
 * units of accuracy**, and for THIS source it is the specific lie that reads as
 * a strike location.
 *
 * The rule: the rendered coordinate's quantum is never FINER than the pixel it
 * came from. `0.01°` is about 1113 m, so a 630 m pixel gets two decimals — the
 * finest quantum that is still at least as coarse as the footprint.
 *
 * Fail-closed by construction: a larger pixel yields fewer decimals, and a
 * missing or unparseable footprint yields the coarsest the app will render.
 */
export const COARSEST_DECIMALS = 1;

export function decimalsForFootprint(footprintKm: number): number {
  if (!Number.isFinite(footprintKm) || footprintKm <= 0) return COARSEST_DECIMALS;
  const metres = footprintKm * 1000;
  const places = Math.floor(Math.log10(METRES_PER_DEGREE / metres));
  return Math.max(COARSEST_DECIMALS, Math.min(6, places));
}

/** Round a coordinate to the precision its footprint justifies. */
export function bindPrecision(value: number, footprintKm: number): number {
  const places = decimalsForFootprint(footprintKm);
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export type Confidence = 'low' | 'nominal' | 'high' | 'unknown';

export interface Detection {
  /** Rounded to the precision the footprint justifies — never as published. */
  latitude: number;
  longitude: number;
  /** Pixel footprint, km. The larger of scan and track: the coarser dimension governs. */
  footprintKm: number;
  acquiredAt: string;
  satellite: string;
  instrument: string;
  confidence: Confidence;
  /** Fire radiative power, megawatts. */
  frpMw: number | null;
  daynight: string;
}

/**
 * `confidence` IS TWO INCOMPATIBLE SCALES UNDER ONE FIELD NAME.
 *
 * VIIRS reports a category — `l`, `n`, `h`. MODIS reports a 0–100 number. The
 * column is called `confidence` in both, and nothing in the row says which scale
 * you are reading except the `instrument` column.
 *
 * Comparing a MODIS `80` against a VIIRS `n` is rule 22's aggregation across
 * kinds, and it is invisible: both are "confidence", both sort, both render.
 * MODIS thresholds follow NASA's own documented banding (<30 low, 30–80
 * nominal, >80 high).
 */
export function readConfidence(raw: string, instrument: string): Confidence {
  const text = raw.trim().toLowerCase();
  if (text === '') return 'unknown';

  if (instrument.toUpperCase().includes('MODIS')) {
    const percent = Number(text);
    if (!Number.isFinite(percent)) return 'unknown';
    if (percent < 30) return 'low';
    if (percent <= 80) return 'nominal';
    return 'high';
  }

  // VIIRS and anything else categorical.
  if (text === 'l') return 'low';
  if (text === 'n') return 'nominal';
  if (text === 'h') return 'high';
  return 'unknown';
}

/**
 * `acq_time` IS HHMM AS AN INTEGER WITHOUT LEADING ZEROS.
 *
 * `35` means 00:35, not 35 minutes past an unknown hour, and not 03:05. Parsed
 * as a number and formatted naively, every detection before 10:00 UTC gets the
 * wrong time of day — and the error is largest exactly where the data is
 * densest, because overnight passes are when thermal contrast is best.
 */
export function readAcquiredAt(acqDate: string, acqTime: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) {
    throw new ShapeError(SOURCE_ID, `acq_date is "${acqDate}", expected YYYY-MM-DD`);
  }
  const digits = acqTime.trim();
  if (!/^\d{1,4}$/.test(digits)) {
    throw new ShapeError(SOURCE_ID, `acq_time is "${acqTime}", expected 1–4 digits of HHMM`);
  }
  const padded = digits.padStart(4, '0');
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2));
  if (hours > 23 || minutes > 59) {
    throw new ShapeError(SOURCE_ID, `acq_time "${acqTime}" is not a valid time of day`);
  }
  return `${acqDate}T${padded.slice(0, 2)}:${padded.slice(2)}:00Z`;
}

function number(raw: string | undefined, at: string): number {
  const parsed = Number((raw ?? '').trim());
  if (!Number.isFinite(parsed)) throw new ShapeError(SOURCE_ID, `${at} is "${raw}", expected a number`);
  return parsed;
}

export function parse(csv: string): Detection[] {
  const lines = csv.trim().split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new ShapeError(SOURCE_ID, 'empty response');

  const header = lines[0]!.split(',').map((h) => h.trim());
  const need = ['latitude', 'longitude', 'scan', 'track', 'acq_date', 'acq_time', 'instrument', 'confidence'];
  for (const column of need) {
    if (!header.includes(column)) {
      throw new ShapeError(SOURCE_ID, `response has no "${column}" column — header was: ${header.join(',')}`);
    }
  }
  const at = (name: string) => header.indexOf(name);

  /**
   * An empty result is NO DETECTIONS, which is a real answer and not an error.
   * FIRMS returns a header and nothing else for a quiet bbox, and rule 30 says
   * that is "we looked and there was nothing" rather than "we could not look".
   */
  if (lines.length === 1) return [];

  return lines.slice(1).map((line, index): Detection => {
    const cells = line.split(',');
    const scan = number(cells[at('scan')], `row ${index}.scan`);
    const track = number(cells[at('track')], `row ${index}.track`);
    // The COARSER dimension governs: a pixel 0.63 × 0.72 km is not 0.63 km
    // precise in any direction a reader would understand.
    const footprintKm = Math.max(scan, track);

    const instrument = (cells[at('instrument')] ?? '').trim();
    const frpIndex = at('frp');
    const frpRaw = frpIndex >= 0 ? (cells[frpIndex] ?? '').trim() : '';

    return {
      latitude: bindPrecision(number(cells[at('latitude')], `row ${index}.latitude`), footprintKm),
      longitude: bindPrecision(number(cells[at('longitude')], `row ${index}.longitude`), footprintKm),
      footprintKm,
      acquiredAt: readAcquiredAt(
        (cells[at('acq_date')] ?? '').trim(),
        (cells[at('acq_time')] ?? '').trim(),
      ),
      satellite: (cells[at('satellite')] ?? '').trim(),
      instrument,
      confidence: readConfidence((cells[at('confidence')] ?? '').trim(), instrument),
      // Absent FRP is absent, never zero: zero radiative power would mean a
      // detection with no heat, which is not a thing the sensor can report.
      frpMw: frpRaw === '' ? null : number(frpRaw, `row ${index}.frp`),
      daynight: (cells[at('daynight')] ?? '').trim(),
    };
  });
}

/**
 * A detection count as a Fact.
 *
 * ## A ROW IS A DETECTION, NOT A FIRE
 *
 * Rule 38 asked for this source's aggregate discriminator, and the honest answer
 * is that FIRMS has none — because the rows are not aggregates. Each is one
 * pixel on one satellite pass. **That is exactly why counting them as "fires"
 * over-counts**: one fire burning for three days across two satellites produces
 * many rows, and adjacent pixels of a single front produce many more.
 *
 * So the count is `DERIVED` and named for what it is. Calling it a number of
 * fires would be the same class of error as summing an aggregate row beside its
 * components, arriving from the opposite direction.
 */
export function detectionCountFact(detections: readonly Detection[], ctx: FetchContext, window: string): Fact<number> {
  return {
    value: detections.length,
    asOf: ctx.fetchedAt.slice(0, 10),
    tier: 'DERIVED',
    provenance: fetchProvenance(SOURCE_ID, ctx, { rows: detections.length }, 'count of returned rows'),
    note:
      `Satellite ${LABEL} detected in ${window}. Each row is one sensor pixel on one pass, ` +
      'not one fire: a single fire produces many detections, and gas flares, agricultural ' +
      'burning and industrial heat all register.',
    format: (value: number) => value.toLocaleString('en-US'),
  };
}
