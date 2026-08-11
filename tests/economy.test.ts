import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { parse as parseWorldBank } from '../src/sources/worldbank';
import {
  buildSeries,
  indicatorById,
  isMonetary,
  latestValueFact,
  logScaleAvailable,
  magnitudeSpan,
  shouldSuggestLog,
  type IndicatorSpec,
} from '../src/economy/series';
import { renderChart, segmentsOf } from '../src/economy/chart';
import { formatAxisValue } from '../src/economy/series';
import { factState } from '../src/facts/types';
import type { FetchContext } from '../src/sources/adapter';

const CTX: FetchContext = {
  requestUrl: 'https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json',
  httpStatus: 200,
  fetchedAt: '1970-01-01T00:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

const WINDOW = { fromYear: 2005, toYear: 2025, referenceYear: 2026 };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/economy', `${name}.json`), 'utf8'));
}

function seriesOf(fixtureName: string, indicatorId: string) {
  const spec = indicatorById(indicatorId) as IndicatorSpec;
  assert.ok(spec, `no indicator registered as ${indicatorId}`);
  return { spec, series: buildSeries(spec, parseWorldBank(fixture(fixtureName)), WINDOW) };
}

describe('units and basis', () => {
  it('gives every monetary indicator a currency and a current/constant basis', () => {
    // A GDP figure with no currency and no nominal/real designation is not a
    // fact. This is enforced at the registry so it cannot be omitted at a call site.
    for (const spec of [indicatorById('gdp'), indicatorById('gdp-ppp'), indicatorById('gdp-per-capita')]) {
      assert.ok(spec);
      assert.ok(isMonetary(spec.basis), `${spec.id} should be monetary`);
      assert.ok(spec.unit.length > 0, `${spec.id} has no unit`);
    }
  });

  it('carries the basis caveat onto the rendered fact', () => {
    const { series } = seriesOf('gdp-normal', 'gdp');
    const fact = latestValueFact(series, CTX, parseWorldBank(fixture('gdp-normal')));
    assert.equal(fact.unit, 'US$');
    assert.match(fact.note ?? '', /Not adjusted for inflation/);
  });

  it('marks a modelled PPP conversion as an estimate, not official', () => {
    assert.equal(indicatorById('gdp-ppp')?.tier, 'ESTIMATE');
    assert.equal(indicatorById('gdp')?.tier, 'OFFICIAL');
  });
});

describe('hard case — no data at all', () => {
  it('reports an empty series rather than a run of zeroes', () => {
    const { series } = seriesOf('gini-no-data', 'gini');
    assert.equal(series.empty, true);
    assert.equal(series.latestValue, null);
    assert.equal(series.latestYear, null);
    assert.ok(series.points.every((point) => point.value === null));
  });

  it('renders a no-data card instead of a line along the axis', () => {
    // A flat line at zero says the indicator measured zero for twenty years,
    // which is a different claim from having no observations.
    const { series } = seriesOf('gini-no-data', 'gini');
    const svg = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    assert.match(svg, /chart--empty/);
    assert.doesNotMatch(svg, /<polyline/);
    assert.match(svg, /different claim/);
  });

  it('gives a no-data fact rather than a zero-valued one', () => {
    const { series } = seriesOf('gini-no-data', 'gini');
    const fact = latestValueFact(series, CTX, parseWorldBank(fixture('gini-no-data')));
    assert.equal(fact.value, null);
    assert.equal(factState(fact), 'nodata');
  });
});

describe('hard case — a gap in the middle of the series', () => {
  it('records the gap with its span', () => {
    const { series } = seriesOf('gdp-midgap', 'gdp');
    assert.equal(series.gaps.length, 1);
    assert.deepEqual(series.gaps[0], { fromYear: 2011, toYear: 2014, years: 4 });
  });

  it('breaks the line rather than connecting across it', () => {
    const { series } = seriesOf('gdp-midgap', 'gdp');
    const segments = segmentsOf(series.points);
    assert.equal(segments.length, 2, 'a bridged gap would produce a single segment');
    const svg = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    assert.equal((svg.match(/<polyline/g) ?? []).length, 2);
  });

  it('does not interpolate the missing years', () => {
    const { series } = seriesOf('gdp-midgap', 'gdp');
    for (const year of [2011, 2012, 2013, 2014]) {
      assert.equal(series.points.find((point) => point.year === year)?.value, null);
    }
  });

  it('marks the gap on the chart', () => {
    const { series } = seriesOf('gdp-midgap', 'gdp');
    const svg = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    assert.match(svg, /chart-gap/);
    assert.match(svg, /Not interpolated/);
  });

  it('does not treat a late start as a gap', () => {
    // A series that simply begins in 2019 has no missing observations before
    // 2019 — rendering that as a gap would imply data went missing.
    const { series } = seriesOf('gdp-single-point', 'gdp');
    assert.equal(series.gaps.length, 0);
    assert.equal(series.points.length, 1);
  });

  it('plots a lone observation as a point, since a line needs two', () => {
    const { series } = seriesOf('gdp-single-point', 'gdp');
    const svg = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    assert.match(svg, /chart-dot/);
    assert.doesNotMatch(svg, /<polyline/);
  });
});

describe('hard case — a stale latest observation', () => {
  it('reports staleness per indicator', () => {
    const { series } = seriesOf('gdp-stale', 'gdp');
    assert.equal(series.latestYear, 2018);
    assert.equal(series.staleByYears, 8);
  });

  it('states the latest year on the value itself, not panel-wide', () => {
    // Indicators update on different cadences, so a single panel-level "as of"
    // would be wrong for most rows on the panel.
    const { series } = seriesOf('gdp-stale', 'gdp');
    const fact = latestValueFact(series, CTX, parseWorldBank(fixture('gdp-stale')));
    assert.equal(fact.asOf, '2018');
    assert.match(fact.note ?? '', /8 years old/);
  });

  it('gives different indicators different as-of years', () => {
    const fresh = seriesOf('gdp-normal', 'gdp');
    const stale = seriesOf('gdp-stale', 'gdp');
    const a = latestValueFact(fresh.series, CTX, parseWorldBank(fixture('gdp-normal')));
    const b = latestValueFact(stale.series, CTX, parseWorldBank(fixture('gdp-stale')));
    assert.notEqual(a.asOf, b.asOf);
  });

  it('skips the published-but-empty current year when finding the latest', () => {
    const { series } = seriesOf('gdp-normal', 'gdp');
    assert.equal(series.latestYear, 2024);
    assert.equal(series.staleByYears, 2);
  });
});

describe('hard case — hyperinflation and redenomination', () => {
  it('suggests a log scale when the series spans orders of magnitude', () => {
    const { series } = seriesOf('inflation-hyper', 'inflation');
    const span = magnitudeSpan(series);
    assert.ok(span !== null && span > 3, `expected a wide span, got ${span}`);
  });

  it('refuses log for a series that can go negative', () => {
    // Inflation can be negative during deflation, so the logarithm is undefined
    // even though this particular fixture happens to be all-positive.
    const { series } = seriesOf('inflation-hyper', 'inflation');
    const availability = logScaleAvailable(series);
    assert.equal(availability.available, false);
    assert.match(availability.reason, /can be negative/);
    assert.equal(shouldSuggestLog(series), false);
  });

  it('offers log for a wide, strictly positive monetary series', () => {
    const { series } = seriesOf('gdp-redenominated', 'gdp');
    assert.equal(logScaleAvailable(series).available, true);
    assert.equal(shouldSuggestLog(series), true);
  });

  it('produces different geometry on a log scale than a linear one', () => {
    const { series } = seriesOf('gdp-redenominated', 'gdp');
    const linear = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    const log = renderChart(series, { width: 300, height: 90, scale: 'log' });
    assert.notEqual(linear, log, 'the log toggle must actually change the plot');
    assert.match(log, /log scale/);
    assert.match(linear, /linear scale/);
  });

  it('does not suggest log for an ordinary series', () => {
    const { series } = seriesOf('gdp-normal', 'gdp');
    assert.equal(shouldSuggestLog(series), false);
  });
});

describe('axis labels fit their gutter', () => {
  // Regression: "451.53 billion" overflowed the ~46px axis gutter and was
  // clipped to "3 billion" — not merely ugly, a completely different number.
  it('formats axis values compactly', () => {
    const gdp = indicatorById('gdp') as IndicatorSpec;
    assert.equal(formatAxisValue(451_530_000_000, gdp), '452B');
    assert.equal(formatAxisValue(29_184_890_000_000, gdp), '29.2T');
    assert.equal(formatAxisValue(-1_500_000, gdp), '-1.50M');
  });

  it('keeps every axis label short enough not to be clipped', () => {
    const MAX_CHARS = 8;
    for (const name of ['gdp-normal', 'gdp-redenominated', 'inflation-hyper', 'gdp-stale']) {
      const id = name.startsWith('inflation') ? 'inflation' : 'gdp';
      const { series } = seriesOf(name, id);
      const svg = renderChart(series, { width: 320, height: 88, scale: 'linear' });
      for (const match of svg.matchAll(/class="chart-axis"[^>]*>([^<]*)</g)) {
        assert.ok(
          (match[1] ?? '').length <= MAX_CHARS,
          `axis label ${JSON.stringify(match[1])} in ${name} is ${match[1]?.length} chars, over ${MAX_CHARS}`,
        );
      }
    }
  });
});

describe('chart geometry', () => {
  it('keeps every plotted point inside the canvas', () => {
    const { series } = seriesOf('gdp-normal', 'gdp');
    const svg = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    const points = /points="([^"]+)"/.exec(svg)?.[1] ?? '';
    const coords = points.split(' ').map((pair) => pair.split(',').map(Number));
    assert.ok(coords.length > 0);
    for (const [x, y] of coords) {
      assert.ok((x as number) >= 0 && (x as number) <= 300, `x ${x} outside canvas`);
      assert.ok((y as number) >= 0 && (y as number) <= 90, `y ${y} outside canvas`);
    }
  });

  it('does not divide by zero on a flat series', () => {
    const spec = indicatorById('gdp') as IndicatorSpec;
    const flat = buildSeries(
      spec,
      { indicatorId: 'X', indicatorName: 'x', countryIso3: 'AAA', countryName: 'a', lastUpdated: '', observations: [
        { year: 2020, value: 5 }, { year: 2021, value: 5 }, { year: 2022, value: 5 },
      ] },
      { fromYear: 2020, toYear: 2022, referenceYear: 2026 },
    );
    const svg = renderChart(flat, { width: 300, height: 90, scale: 'linear' });
    assert.doesNotMatch(svg, /NaN/);
  });

  it('carries an accessible label describing the series and its gaps', () => {
    const { series } = seriesOf('gdp-midgap', 'gdp');
    const svg = renderChart(series, { width: 300, height: 90, scale: 'linear' });
    assert.match(svg, /aria-label="GDP, 2005 to 2025, linear scale, 1 gap\(s\) not interpolated"/);
  });
});

describe('provider country codes must exist on the globe', () => {
  // Regression: the sparse-news fixture was mapped to Tuvalu, which is absent
  // from the 110m topology. The country was unselectable, so the browser check
  // that was meant to exercise sparse coverage silently re-tested the USA
  // instead — a green assertion covering nothing.
  it('every fixture-mapped country is present in the country list', async () => {
    const { loadCountries } = await import('../src/countries');
    const { ECONOMY_COUNTRIES } = await import('../src/dossier/economy-provider');
    const codes = new Set(loadCountries().map((country) => country.code));
    for (const code of ECONOMY_COUNTRIES) {
      assert.ok(codes.has(code), `${code} is mapped to a fixture but is not on the globe`);
    }
  });
});
