import indicators from '../../data/indicators.json';
import type { Fact, Tier } from '../facts/types';
import { fetchProvenance, type FetchContext } from '../sources/adapter';
import type { IndicatorSeries } from '../sources/worldbank';

/**
 * Turns a World Bank indicator series into something renderable.
 *
 * The whole module exists to keep three absences distinct, because collapsing
 * any of them produces a confident falsehood:
 *
 *   - the indicator has NO data for this country      -> "no data", never 0
 *   - the series has a GAP in the middle              -> the line breaks, never interpolates
 *   - the latest value is YEARS OLD                   -> stated per indicator, never panel-wide
 */

export type Basis = 'current-usd' | 'constant-usd' | 'ppp' | 'local-current' | 'ratio' | 'count';
export type ScaleHint = 'log-useful' | 'linear-only';

export interface IndicatorSpec {
  id: string;
  code: string;
  name: string;
  unit: string;
  basis: Basis;
  tier: Tier;
  cadence: string;
  scaleHint: ScaleHint;
  note?: string;
  sourceId?: string;
}

interface IndicatorFile {
  basisValues: Record<Basis, string>;
  indicators: IndicatorSpec[];
}

const FILE = indicators as unknown as IndicatorFile;

export const INDICATORS: readonly IndicatorSpec[] = FILE.indicators;

export function indicatorById(id: string): IndicatorSpec | undefined {
  return FILE.indicators.find((indicator) => indicator.id === id);
}

export function basisNote(basis: Basis): string {
  return FILE.basisValues[basis];
}

/** A monetary basis needs a currency; a ratio or count does not. */
export function isMonetary(basis: Basis): boolean {
  return basis === 'current-usd' || basis === 'constant-usd' || basis === 'ppp' || basis === 'local-current';
}

export interface SeriesPoint {
  year: number;
  /** null means the source reported no observation. NEVER coerced to zero. */
  value: number | null;
}

export interface Gap {
  fromYear: number;
  toYear: number;
  years: number;
}

export interface Series {
  spec: IndicatorSpec;
  /** Ascending by year, gaps preserved as null. */
  points: SeriesPoint[];
  /** Most recent year with an actual value, or null if the series is empty. */
  latestYear: number | null;
  latestValue: number | null;
  /** Runs of missing years that sit BETWEEN observations. */
  gaps: Gap[];
  /** True when every point is null — the indicator has nothing for this country. */
  empty: boolean;
  /** Years between the latest observation and the reference year. */
  staleByYears: number | null;
}

/**
 * Build a windowed series.
 *
 * Leading and trailing nulls are trimmed: a country whose series starts in 2009
 * has no gap before 2009, it simply has no earlier data, and rendering that as a
 * gap would imply observations went missing.
 */
export function buildSeries(
  spec: IndicatorSpec,
  raw: IndicatorSeries,
  options: { fromYear: number; toYear: number; referenceYear: number },
): Series {
  const byYear = new Map<number, number | null>();
  for (const observation of raw.observations) byYear.set(observation.year, observation.value);

  const windowed: SeriesPoint[] = [];
  for (let year = options.fromYear; year <= options.toYear; year += 1) {
    windowed.push({ year, value: byYear.get(year) ?? null });
  }

  const firstIndex = windowed.findIndex((point) => point.value !== null);
  const lastIndex = findLastIndex(windowed, (point) => point.value !== null);

  if (firstIndex === -1 || lastIndex === -1) {
    return {
      spec,
      points: windowed,
      latestYear: null,
      latestValue: null,
      gaps: [],
      empty: true,
      staleByYears: null,
    };
  }

  const trimmed = windowed.slice(firstIndex, lastIndex + 1);

  // Gaps are only the holes BETWEEN observations, which is why this runs on the
  // trimmed range. A series that simply starts late has no gap.
  const gaps: Gap[] = [];
  let runStart: number | null = null;
  for (const point of trimmed) {
    if (point.value === null) {
      if (runStart === null) runStart = point.year;
    } else if (runStart !== null) {
      gaps.push({ fromYear: runStart, toYear: point.year - 1, years: point.year - runStart });
      runStart = null;
    }
  }

  const latest = trimmed[trimmed.length - 1] as SeriesPoint;

  return {
    spec,
    points: trimmed,
    latestYear: latest.year,
    latestValue: latest.value,
    gaps,
    empty: false,
    staleByYears: Math.max(0, options.referenceYear - latest.year),
  };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index;
  }
  return -1;
}

/**
 * Is a logarithmic scale meaningful for this series?
 *
 * Log needs strictly positive values, and is only worth offering where the range
 * is wide enough for a linear plot to hide detail — which is exactly the
 * hyperinflation and redenomination case.
 */
export function logScaleAvailable(series: Series): { available: boolean; reason: string } {
  if (series.spec.scaleHint === 'linear-only') {
    return { available: false, reason: `${series.spec.name} can be negative, so a logarithmic scale is undefined for it.` };
  }
  const values = series.points.map((point) => point.value).filter((value): value is number => value !== null);
  if (values.length === 0) return { available: false, reason: 'No observations to plot.' };
  if (values.some((value) => value <= 0)) {
    return { available: false, reason: 'The series contains zero or negative values, which have no logarithm.' };
  }
  return { available: true, reason: 'Available.' };
}

/** Orders of magnitude spanned. Large spans make a linear plot near-useless. */
export function magnitudeSpan(series: Series): number | null {
  const values = series.points.map((point) => point.value).filter((value): value is number => value !== null && value > 0);
  if (values.length < 2) return null;
  return Math.log10(Math.max(...values) / Math.min(...values));
}

/** A linear axis hides everything below the peak once the span is this wide. */
export const WIDE_SPAN_DECADES = 2;

export function shouldSuggestLog(series: Series): boolean {
  const span = magnitudeSpan(series);
  return span !== null && span >= WIDE_SPAN_DECADES && logScaleAvailable(series).available;
}

/**
 * The latest value as a Fact.
 *
 * Unit and basis come from the registry, so a monetary value cannot reach the UI
 * without a currency and a current/constant designation.
 */
export function latestValueFact(series: Series, ctx: FetchContext, raw: IndicatorSeries): Fact<number> {
  const spec = series.spec;
  const notes: string[] = [];
  if (spec.note) notes.push(spec.note);
  if (isMonetary(spec.basis)) notes.push(basisNote(spec.basis));
  if (series.staleByYears !== null && series.staleByYears >= 2) {
    notes.push(`Most recent observation is ${series.staleByYears} years old.`);
  }
  if (series.gaps.length > 0) {
    notes.push(
      `${series.gaps.length} gap(s) in the series; missing years are not interpolated.`,
    );
  }

  return {
    value: series.latestValue,
    unit: spec.unit,
    asOf: series.latestYear === null ? 'no observations' : String(series.latestYear),
    tier: spec.tier,
    provenance: fetchProvenance(
      spec.sourceId ?? 'worldbank',
      ctx,
      raw,
      `${spec.code}: most recent non-null observation`,
    ),
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    format: (value: number) => formatValue(value, spec),
  };
}

/**
 * Compact form for axis labels, which sit in a fixed ~46px gutter.
 * "451.53 billion" overflows it and is clipped to "3 billion", which is not
 * merely ugly — it reads as a completely different number.
 */
export function formatAxisValue(value: number, spec: IndicatorSpec): string {
  if (spec.basis === 'ratio') return value.toFixed(Math.abs(value) >= 100 ? 0 : 1);

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  // Scale first, then fix the decimals. toPrecision() flips to exponent
  // notation once the mantissa exceeds its significant digits, which produced
  // "5.99e+3T" — unreadable in a chart gutter, and precisely the kind of
  // display that makes a reader guess at a number.
  const tiers: Array<[number, string]> = [
    [1e15, 'P'],
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];

  for (const [threshold, suffix] of tiers) {
    if (abs >= threshold) {
      const mantissa = abs / threshold;
      const decimals = mantissa >= 100 ? 0 : mantissa >= 10 ? 1 : 2;
      return `${sign}${mantissa.toFixed(decimals)}${suffix}`;
    }
  }

  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${sign}${abs.toFixed(decimals)}`;
}

export function formatValue(value: number, spec: IndicatorSpec): string {
  if (spec.basis === 'ratio') return value.toFixed(1);
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)} trillion`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} billion`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)} million`;
  return value.toLocaleString('en', { maximumFractionDigits: 2 });
}
