import type { Fact } from '../facts/types';
import {
  expectArray,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'ember-electricity';

const SERVICE = 'https://api.ember-energy.org/v1/electricity-generation/yearly';

/**
 * Ember's yearly electricity generation, per country and fuel.
 *
 * ## The key never appears here
 *
 * Ember authenticates with an `api_key` QUERY PARAMETER — measured, not assumed:
 * `Authorization: Bearer` and `X-API-Key` both return
 * `403 {"detail":"No API key set"}`. A key in a query string cannot be sent from
 * the browser, because it would be inlined into the bundle and served to every
 * visitor. So this builder deliberately produces the URL WITHOUT the key, and
 * the Worker appends it. `transport: "worker"` in the registry is therefore not
 * a CORS decision and does not become negotiable if Ember later sends a
 * permissive ACAO — which it already does.
 */
export interface YearlyQuery {
  /** ISO 3166-1 alpha-3, Ember's `entity_code`. */
  iso3: string;
  startYear: number;
  endYear: number;
}

/**
 * The app's own request construction, exported so fixtures derive their URL from
 * here rather than repeating it (rule 26).
 */
export function buildYearlyUrl(query: YearlyQuery): string {
  const params = new URLSearchParams({
    entity_code: query.iso3,
    start_date: String(query.startYear),
    end_date: String(query.endYear),
  });
  return `${SERVICE}?${params.toString()}`;
}

/**
 * A single row as Ember publishes it.
 *
 * Field names are Ember's own, so a reader comparing this against the Yearly
 * Electricity Data download is comparing like with like.
 */
export interface GenerationRow {
  entity: string;
  entityCode: string;
  /** Ember's own flag: this "country" is a region or a bloc, not a country. */
  isAggregateEntity: boolean;
  year: number;
  /** Fuel or grouping, e.g. `Solar`, `Renewables`, `Net imports`. */
  series: string;
  /** Ember's own flag: this series is a SUM of other series in the same list. */
  isAggregateSeries: boolean;
  /**
   * Terawatt-hours. **May be null and may be negative.**
   *
   * `null` is "no value for this series in this year" and is kept distinct from
   * `0`, which is Ember reporting genuinely zero generation (rule 30). Negative
   * is real: `Net imports` is in the same series list as `Solar`, and a net
   * EXPORTER reports it negative — the observed range for one country-pair of
   * years reached -27.26 TWh.
   */
  generationTwh: number | null;
  /** Percent of generation. May be null, and is NOT bounded to 0..100 — see below. */
  shareOfGenerationPct: number | null;
}

export interface YearlyGeneration {
  rows: GenerationRow[];
  /** Echoed from `stats`, so the inspector can show what was actually asked. */
  recordCount: number;
}

/**
 * A value Ember omits versus a value Ember reports as zero.
 *
 * `undefined`/absent and `null` both mean "no figure": the series was not
 * reported for that entity-year. `0` means Ember reported zero — a country with
 * no nuclear fleet genuinely generates 0 TWh of nuclear, and rendering that as
 * "no data" would be as wrong as rendering a missing figure as 0.
 *
 * This is the same distinction UNHCR needed, and the reason it is a shared
 * helper rather than an inline `?? 0` is that `?? 0` is exactly the line that
 * destroys it.
 */
function numberOrNull(value: unknown, at: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ShapeError(SOURCE_ID, `${at} is ${JSON.stringify(value)}, expected a number or null`);
  }
  return value;
}

export function parse(payload: unknown): YearlyGeneration {
  const root = expectObject(SOURCE_ID, payload, 'response');
  const stats = expectObject(SOURCE_ID, root['stats'], 'stats');
  const data = expectArray(SOURCE_ID, root['data'], 'data');

  const rows = data.map((entry, index): GenerationRow => {
    const row = expectObject(SOURCE_ID, entry, `data[${index}]`);

    /**
     * `date` is a STRING year ("2022"), not a number and not a full date.
     * Parsed explicitly rather than coerced, so a future change to a full ISO
     * date fails loudly here instead of silently producing NaN downstream.
     */
    const date = expectString(SOURCE_ID, row['date'], `data[${index}].date`);
    if (!/^\d{4}$/.test(date)) {
      throw new ShapeError(SOURCE_ID, `data[${index}].date is "${date}", expected a four-digit year`);
    }

    /**
     * The aggregate flags are REQUIRED, and their absence is a hard failure
     * rather than a default.
     *
     * Defaulting a missing flag to `false` would silently reclassify every
     * aggregate as a leaf the day Ember renames the field — and the failure
     * would be a plausible-looking chart that double-counts, which is precisely
     * the failure nobody notices. Fail closed, loudly.
     */
    const isAggregateEntity = row['is_aggregate_entity'];
    const isAggregateSeries = row['is_aggregate_series'];
    if (typeof isAggregateEntity !== 'boolean' || typeof isAggregateSeries !== 'boolean') {
      throw new ShapeError(
        SOURCE_ID,
        `data[${index}] is missing the aggregate flags (is_aggregate_entity, is_aggregate_series); ` +
          'without them a sum over series double-counts and looks correct',
      );
    }

    return {
      entity: expectString(SOURCE_ID, row['entity'], `data[${index}].entity`),
      entityCode: expectString(SOURCE_ID, row['entity_code'], `data[${index}].entity_code`),
      isAggregateEntity,
      year: Number(date),
      series: expectString(SOURCE_ID, row['series'], `data[${index}].series`),
      isAggregateSeries,
      generationTwh: numberOrNull(row['generation_twh'], `data[${index}].generation_twh`),
      shareOfGenerationPct: numberOrNull(
        row['share_of_generation_pct'],
        `data[${index}].share_of_generation_pct`,
      ),
    };
  });

  const recordCount =
    typeof stats['number_of_records'] === 'number' ? stats['number_of_records'] : rows.length;

  return { rows, recordCount };
}

/**
 * The rows that can be summed without double-counting.
 *
 * **This is the whole hazard of this source.** A single response mixes leaf
 * fuels (`Solar`, `Coal`) with sums over them (`Renewables`, `Fossil`, `Clean`,
 * `Total generation`, `Wind and solar`, `Hydro, bioenergy and other
 * renewables`), and every one arrives in the same `series` field. Summing the
 * response as it comes roughly doubles the total and produces a chart that
 * looks entirely plausible.
 *
 * Ember flags them, so this filters on the FLAG rather than on a hand-written
 * list of aggregate names. A name list would be a second source of truth that
 * silently rots the first time Ember adds a grouping.
 */
export function leafSeries(rows: readonly GenerationRow[]): GenerationRow[] {
  return rows.filter((row) => !row.isAggregateSeries && !row.isAggregateEntity);
}

/**
 * FLOWS, WHICH ARE NOT GENERATION SOURCES — declared, never inferred.
 *
 * `Net imports` and `Demand` describe electricity moving or being consumed, not
 * electricity being produced. Charting them beside `Solar` and `Coal` aggregates
 * across kinds, which is rule 22's corollary: a mix chart containing a flow is
 * not a mix chart.
 *
 * ## Why this is a hand-written list
 *
 * **Ember's taxonomy does not distinguish flows from sources.** `is_aggregate_series`
 * means "this series is a sum of other series", and it splits these two the wrong
 * way round for our purpose:
 *
 *   Demand        is_aggregate_series = true
 *   Net imports   is_aggregate_series = false
 *
 * So `leafSeries` already drops `Demand` — **by accident**, because it happens to
 * be a sum. Keying flow-exclusion on that flag would work today and would be
 * inference from a flag that means something else. It is declared here instead.
 *
 * ## Why not "negative means flow"
 *
 * Because that is inference from a value, and it is the inference the spec
 * explicitly refuses. Measured over 918 rows across nine years and six
 * countries, every negative `generation_twh` was `Net imports` and no generation
 * source was ever negative — but a rule keyed on sign would classify a net
 * IMPORTER's positive `Net imports` as a generation source, which is the same
 * row misread by the same rule in the other direction.
 */
export const FLOW_SERIES: ReadonlySet<string> = new Set(['Net imports', 'Demand']);

export function isFlowSeries(series: string): boolean {
  return FLOW_SERIES.has(series);
}

/**
 * The rows that belong in a generation mix.
 *
 * ## This is also what makes `share_of_generation_pct` safe
 *
 * Shares above 100% are real and are NOT rounding: Luxembourg's `Demand` reached
 * 897% of its domestic generation because it imports most of its electricity,
 * and Denmark's sat at 103–124% for nine consecutive years. `share_of_generation_pct`
 * is a share OF GENERATION, not a share of a mix, so any net importer exceeds 100
 * on the flow series.
 *
 * Measured across the same 918 rows: **no generation source ever exceeded 100%.**
 * Every one of the 30 over-100 rows was `Demand` or `Net imports`.
 *
 * So excluding flows is what removes the anomaly — no clamp, and no anomaly
 * marker on the mix. A clamp would have been a fabricated number wearing a real
 * one's badge, and normalising a mix to 100 would have silently redistributed
 * the excess across every other slice: every slice slightly wrong, nothing
 * flagged.
 *
 * Where a flow's share IS rendered, it must be labelled "% of domestic
 * generation" rather than "% of the mix", because that is the quantity it is.
 */
export function generationOnly(rows: readonly GenerationRow[]): GenerationRow[] {
  return leafSeries(rows).filter((row) => !isFlowSeries(row.series));
}

/**
 * One series' figure for one year, as a Fact.
 *
 * ## Tier: OFFICIAL, with a stated limit
 *
 * Ember compiles from national statistical publications and system operators,
 * which is a primary chain — hence OFFICIAL rather than ESTIMATE. **But the API
 * carries no per-row flag distinguishing a reported figure from a modelled or
 * back-filled one**, and Ember's methodology states that some country-years are
 * estimated. So OFFICIAL here is a property of the SOURCE, and this adapter
 * cannot narrow it per row.
 *
 * That limit is recorded rather than papered over: marking everything ESTIMATE
 * would be equally wrong and would understate the reported majority. See
 * `OPEN-QUESTIONS.md` — a per-row provenance flag is the only thing that would
 * let this be decided properly.
 */
export function seriesFact(
  row: GenerationRow,
  ctx: FetchContext,
  extractedBy: string,
): Fact<number> {
  return {
    value: row.generationTwh,
    asOf: String(row.year),
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, { row }, extractedBy),
    format: (value: number) => `${value.toFixed(2)} TWh`,
  };
}

/**
 * Find one series for one entity-year, keeping "absent" distinguishable from
 * "reported zero".
 *
 * Returns `undefined` when the series is not present in the response at all —
 * which the caller must not conflate with a row whose `generationTwh` is `0`.
 */
export function findSeries(
  rows: readonly GenerationRow[],
  series: string,
  year: number,
): GenerationRow | undefined {
  return rows.find((row) => row.series === series && row.year === year);
}
