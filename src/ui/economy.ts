import { escapeHtml, factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import { renderChart, type Scale } from '../economy/chart';
import {
  indicatorById,
  isMonetary,
  latestValueFact,
  logScaleAvailable,
  shouldSuggestLog,
  type Series,
} from '../economy/series';
import { loadEconomy, type LoadedSeries } from '../dossier/economy-provider';

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

export function renderEconomyTab(iso3: string, countryName: string, today: Date): string {
  const referenceYear = today.getUTCFullYear();
  const window = { fromYear: referenceYear - WINDOW_YEARS, toYear: referenceYear, referenceYear };
  const rows = loadEconomy(iso3, window);

  const withData = rows.filter((row) => row.loaded !== null).length;
  if (withData === 0) {
    return `<div class="econ">
      <p class="gov-pending"><strong>No economic data for ${escapeHtml(countryName)}.</strong>
      The World Bank ingest is not connected yet and only a few countries have fixtures.</p>
    </div>`;
  }

  return `<div class="econ">
    <p class="econ-preamble">Each indicator states its own most recent year. World Bank
    series update on different cadences, so there is no single "as of" for this panel.</p>
    ${rows.map((row) => indicatorBlock(row.id, row.loaded)).join('')}
  </div>`;
}

function indicatorBlock(id: string, loaded: LoadedSeries | null): string {
  const spec = indicatorById(id);
  if (!spec) return '';

  if (!loaded) {
    return `<section class="econ-block" data-indicator="${escapeHtml(id)}">
      <div class="econ-head">
        <span class="econ-name">${escapeHtml(spec.name)}</span>
        <span class="econ-notfetched">not fetched</span>
      </div>
      <p class="econ-caveat">No fixture for this indicator and country. It is listed
      rather than omitted, because an indicator missing from the panel is
      indistinguishable from one that does not exist.</p>
    </section>`;
  }

  const { series, raw, ctx } = loaded;
  const fact = latestValueFact(series, ctx, raw);
  const scale = scaleByIndicator.get(id) ?? 'linear';
  const logAvailable = logScaleAvailable(series);

  // Short here; the full basis caveat travels with the Fact itself so it
  // survives into the inspector and anywhere else the value is rendered.
  const unitLine = `<div class="econ-basis">${escapeHtml(spec.unit)}${
    isMonetary(spec.basis) ? ` · ${escapeHtml(spec.basis.replace('-usd', ' US$').replace('ppp', 'PPP int$'))}` : ''
  }</div>`;

  return `<section class="econ-block" data-indicator="${escapeHtml(id)}">
    <div class="econ-head">
      <span class="econ-name">${escapeHtml(spec.name)}</span>
      <span class="econ-value">${factHtml(fact, { hideAsOf: true })}</span>
    </div>
    <div class="econ-meta">
      <span class="econ-asof">${
        series.latestYear === null
          ? '<span class="portrait-missing">no observations</span>'
          : `latest ${escapeHtml(String(series.latestYear))}`
      }</span>
      ${
        series.staleByYears !== null && series.staleByYears >= 2
          ? `<span class="econ-stale">${n(series.staleByYears, 'age in years of the most recent observation, derived from the badged latest-year shown beside it')} years old</span>`
          : ''
      }
    </div>
    ${unitLine}
    ${renderChart(series, { ...CHART, scale })}
    ${scaleControls(id, series, scale, logAvailable)}
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
export function mountEconomyTab(root: HTMLElement, rerender: () => void): void {
  root.addEventListener('click', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('[data-scale]');
    const id = toggle?.dataset['scale'];
    if (!id) return;
    event.stopPropagation();
    scaleByIndicator.set(id, scaleByIndicator.get(id) === 'log' ? 'linear' : 'log');
    rerender();
  });
}
