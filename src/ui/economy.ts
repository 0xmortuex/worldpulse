import { escapeHtml, factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import { renderChart, type Scale } from '../economy/chart';
import {
  INDICATORS,
  indicatorById,
  isMonetary,
  latestValueFact,
  logScaleAvailable,
  shouldSuggestLog,
  type Series,
} from '../economy/series';
import { loadEconomyLive, type EconomyLoad, type LiveRow } from '../dossier/economy-live';
import { fetcherFor, setScenario, type RequestingFetcher, type ScenarioName } from '../fetch/scenario';
import { SelectionTracker } from '../fetch/selection';
import { panelStateFor, panelStateLabel, shortfallNote } from '../economy/panel-state';
import { describeAge } from '../fetch/cache-policy';
import type { AnyFact } from '../facts/types';

/**
 * Economy tab.
 *
 * Each indicator carries its OWN latest year. There is deliberately no
 * panel-level "as of": World Bank series update on different cadences, and a
 * single date at the top of the panel would be wrong for most rows under it.
 */

const WINDOW_YEARS = 20;
const CHART = { width: 320, height: 88 };

/** Per-indicator scale choice. Reset when the country changes. */
const scaleByIndicator = new Map<string, Scale>();

function n(value: number, reason: string): string {
  return notAFact(value, reason);
}

export function resetEconomyScales(): void {
  scaleByIndicator.clear();
}

/**
 * Live-loading state for the panel.
 *
 * Module-scoped rather than threaded through `renderEconomyTab`, because the
 * tab renderer is synchronous and called by the panel router on every rerender.
 * The alternative — making the whole panel pipeline async — is a much larger
 * change than switching one source warrants.
 */
const loads = new Map<string, EconomyLoad | 'loading'>();
const tracker = new SelectionTracker();
let fetcher: RequestingFetcher | null = null;
let rerenderPanel: (() => void) | null = null;

/** Test seam: drop cached loads so a scenario can be re-driven. */
export function resetEconomyLoads(): void {
  loads.clear();
  tracker.clear();
  fetcher = null;
}

export function renderEconomyTab(iso3: string, countryName: string, today: Date): string {
  const referenceYear = today.getUTCFullYear();
  const window = { fromYear: referenceYear - WINDOW_YEARS, toYear: referenceYear, referenceYear };

  if (tracker.current()?.subject !== iso3) tracker.select(iso3);

  const existing = loads.get(iso3);
  if (existing === undefined) {
    loads.set(iso3, 'loading');
    fetcher ??= fetcherFor(typeof location === 'undefined' ? '' : location.search);
    const identity = tracker.current() ?? tracker.select(iso3);

    void loadEconomyLive(fetcher, iso3, window, { identity }).then((load) => {
      /**
       * F6, in the app rather than only in a test.
       *
       * A load that resolves after the user has moved on is DISCARDED. Without
       * this line France's GDP renders in Jamaica's dossier with a correct
       * badge, real provenance and the wrong country — the one defect every
       * other mechanism here passes.
       */
      if (!tracker.accepts(identity)) return;
      loads.set(iso3, load);
      rerenderPanel?.();
    });
  }

  const load = loads.get(iso3);
  if (load === undefined || load === 'loading') return loadingMarkup(countryName);

  return loadedMarkup(load, countryName);
}

/**
 * The skeleton occupies the loaded panel's box.
 *
 * Rules 8 and 9 apply to a loading state exactly as they do to a loaded one: a
 * skeleton of the wrong height ships a layout shift on every single load.
 */
function loadingMarkup(countryName: string): string {
  return `<div class="econ" data-panel-state="loading">
    <p class="econ-preamble">Loading World Bank indicators for ${escapeHtml(countryName)}…</p>
    ${INDICATORS.map(
      (spec) => `<section class="econ-block econ-block--skeleton" data-indicator="${escapeHtml(spec.id)}">
      <div class="econ-head">
        <span class="econ-name">${escapeHtml(spec.name)}</span>
        <span class="econ-loading" aria-live="polite">loading…</span>
      </div>
      <div class="econ-skeleton-chart" aria-hidden="true"></div>
    </section>`,
    ).join('')}
  </div>`;
}

function loadedMarkup(load: EconomyLoad, countryName: string): string {
  const state = panelStateFor(
    load.rows.map((row) => ({
      loading: false,
      answered: row.loaded !== null,
      failed: row.failure !== null,
      unconfigured: false,
    })),
  );

  const missing = load.rows
    .filter((row) => row.failure !== null)
    .map((row) => indicatorById(row.id)?.name ?? row.id);
  const shortfall = shortfallNote(missing, load.rows.length);

  /**
   * A stale value never renders silently (F2). The age is stated here, at the
   * panel, and each row's own provenance carries it into the inspector.
   */
  const stale = load.rows
    .filter((row) => row.loaded?.ctx.cache === 'stale-revalidating')
    .map((row) => row.loaded?.ctx.fetchedAt)
    .filter((at): at is string => typeof at === 'string');
  const staleNote =
    stale.length > 0
      ? `<p class="econ-stale" data-stale="true">Showing cached figures from ${escapeHtml(
          describeAge(Date.now() - Date.parse(stale[0] ?? new Date().toISOString())),
        )} ago while refreshing. These are not the newest values the source may hold.</p>`
      : '';

  if (state === 'unavailable') {
    return `<div class="econ" data-panel-state="unavailable">
      <p class="econ-unavailable"><strong>World Bank data is unavailable for ${escapeHtml(countryName)}.</strong>
      This is a fact about our request, not about ${escapeHtml(countryName)} — the source did not answer,
      which is different from reporting no data. Open any badge below to see the failed request.</p>
      ${load.rows.map((row) => indicatorBlock(row)).join('')}
    </div>`;
  }

  return `<div class="econ" data-panel-state="${state}">
    <p class="econ-preamble">Each indicator states its own most recent year. World Bank
    series update on different cadences, so there is no single "as of" for this panel.</p>
    ${
      shortfall
        ? `<p class="econ-degraded" data-shortfall="true"><strong>${escapeHtml(
            panelStateLabel(state),
          )}.</strong> ${escapeHtml(shortfall)}</p>`
        : ''
    }
    ${staleNote}
    ${load.rows.map((row) => indicatorBlock(row)).join('')}
  </div>`;
}

function indicatorBlock(row: LiveRow): string {
  const spec = indicatorById(row.id);
  if (!spec) return '';

  if (!row.loaded) {
    /**
     * A failed indicator renders as a FACT in the unavailable state, not as a
     * bare message. That routes it through the badge and the inspector, so the
     * failed request is inspectable exactly like a successful one — which is the
     * point of modelling the failure as provenance rather than as an error
     * string.
     */
    const fact: AnyFact = {
      value: null,
      asOf: '',
      tier: spec.tier ?? 'OFFICIAL',
      provenance: row.failure,
    };
    return `<section class="econ-block" data-indicator="${escapeHtml(row.id)}">
      <div class="econ-head">
        <span class="econ-name">${escapeHtml(spec.name)}</span>
        <span class="econ-value">${factHtml(fact, { hideAsOf: true })}</span>
      </div>
      <p class="econ-caveat">The request for this indicator did not succeed. This says
      nothing about ${escapeHtml(spec.name.toLowerCase())} in this country.</p>
    </section>`;
  }

  const { series, raw, ctx } = row.loaded;
  const fact = latestValueFact(series, ctx, raw);
  const scale = scaleByIndicator.get(row.id) ?? 'linear';
  const logAvailable = logScaleAvailable(series);

  // Short here; the full basis caveat travels with the Fact itself so it
  // survives into the inspector and anywhere else the value is rendered.
  const unitLine = `<div class="econ-basis">${escapeHtml(spec.unit)}${
    isMonetary(spec.basis) ? ` · ${escapeHtml(spec.basis.replace('-usd', ' US$').replace('ppp', 'PPP int$'))}` : ''
  }</div>`;

  return `<section class="econ-block" data-indicator="${escapeHtml(row.id)}">
    <div class="econ-head">
      <span class="econ-name">${escapeHtml(spec.name)}</span>
      <span class="econ-value">${factHtml(fact, { hideAsOf: true })}</span>
    </div>
    <div class="econ-meta">
      <span class="econ-asof">${
        series.latestYear === null
          ? '<span class="portrait-missing">no observations</span>'
          : `latest ${escapeHtml(
              n(
                series.latestYear,
                'the year of the most recent observation — the as-of stamp for the badged value beside it, not a measurement in its own right',
              ),
            )}`
      }</span>
      ${
        series.staleByYears !== null && series.staleByYears >= 2
          ? `<span class="econ-stale">${n(series.staleByYears, 'age in years of the most recent observation, derived from the badged latest-year shown beside it')} years old</span>`
          : ''
      }
    </div>
    ${unitLine}
    ${renderChart(series, { ...CHART, scale })}
    ${scaleControls(row.id, series, scale, logAvailable)}
    ${gapNote(series)}
  </section>`;
}

function scaleControls(
  id: string,
  series: Series,
  scale: Scale,
  logAvailable: { available: boolean; reason: string },
): string {
  if (series.empty) return '';

  if (!logAvailable.available) {
    return `<div class="econ-scale">
      <span class="econ-scale-active">linear scale</span>
      <span class="econ-scale-why" title="${escapeHtml(logAvailable.reason)}">log unavailable</span>
    </div>`;
  }

  const suggest = shouldSuggestLog(series) && scale === 'linear';

  return `<div class="econ-scale">
    <span class="econ-scale-active">${scale} scale</span>
    <button type="button" class="econ-scale-toggle" data-scale="${escapeHtml(id)}"
      >switch to ${scale === 'linear' ? 'log' : 'linear'}</button>
    ${
      suggest
        ? `<span class="econ-scale-hint">This series spans several orders of magnitude;
           a linear axis flattens everything below the peak.</span>`
        : ''
    }
  </div>`;
}

function gapNote(series: Series): string {
  if (series.gaps.length === 0) return '';
  const spans = series.gaps
    .map((gap) => (gap.years === 1 ? String(gap.fromYear) : `${gap.fromYear}–${gap.toYear}`))
    .join(', ');
  return `<p class="econ-caveat">No data for ${escapeHtml(spans)}. The line breaks
  across the gap and the missing years are not interpolated.</p>`;
}

/** Per-indicator log/linear toggle. */
/**
 * Test seam for the browser harness, wired into main.ts's existing
 * `window.__worldpulse` rather than declaring a second global.
 *
 * Deliberately narrow: it selects among scenarios already in the bundle, every
 * one of which marks its responses `fromFixture` so the inspector warns on
 * screen. It cannot introduce data and cannot make a fixture claim to be live.
 * What it buys is switching states WITHOUT a page reload, which the harness
 * needs because reloading measurably degrades the globe checks that run after
 * it (rule 20: an instrument that degrades what it measures is not measuring
 * it).
 */
export function setEconScenario(scenario: ScenarioName | null): void {
  setScenario(scenario);
  resetEconomyLoads();
  rerenderPanel?.();
}

export function mountEconomyTab(root: HTMLElement, rerender: () => void): void {
  rerenderPanel = rerender;
  root.addEventListener('click', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('[data-scale]');
    const id = toggle?.dataset['scale'];
    if (!id) return;
    event.stopPropagation();
    scaleByIndicator.set(id, scaleByIndicator.get(id) === 'log' ? 'linear' : 'log');
    rerender();
  });
}
