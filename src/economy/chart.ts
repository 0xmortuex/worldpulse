import { notAFact } from '../facts/discipline';
import { escapeHtml } from '../facts/badge';
import { formatAxisValue, type IndicatorSpec, type Series, type SeriesPoint } from './series';

/**
 * Line chart for a windowed indicator series.
 *
 * Two rules the geometry enforces rather than merely documents:
 *
 *   1. A gap is NEVER bridged. Missing years break the path into separate
 *      segments and get a hatched band. Connecting across a gap draws a
 *      trend that nobody measured.
 *   2. A null is NEVER plotted at zero. An empty series renders as a
 *      no-data card, not a flat line along the axis — which would read as
 *      "this country's GDP was zero for twenty years".
 *
 * Coordinates are computed into strings before they reach markup. They are
 * rendering geometry derived from values that appear badged beside the chart,
 * not facts in their own right; `coord()` records that reasoning once.
 */

const PAD = { top: 10, right: 8, bottom: 18, left: 46 };

export type Scale = 'linear' | 'log';

export interface ChartOptions {
  width: number;
  height: number;
  scale: Scale;
}

function coord(value: number): string {
  return notAFact(
    Math.round(value * 100) / 100,
    'SVG coordinate derived from values that are rendered with their own confidence badge beside this chart — plot geometry, not a fact',
  );
}

function dimension(value: number): string {
  return notAFact(value, 'SVG canvas dimension in pixels — a layout constant, not data about the world');
}

/**
 * A year on the axis, or in a gap marker.
 *
 * The year comes from the series, so it is data — but it labels the window
 * rather than reporting an observation, and every plotted value carries its own
 * badge in the block above. Same treatment as the coverage-end year in the
 * relations popover.
 */
function axisYear(year: number): string {
  return notAFact(
    year,
    'axis extent: which years this plot covers, describing the window rather than reporting a value read from it',
  );
}

/**
 * An axis scale bound.
 *
 * The extremes of the plotted series, formatted for the gutter. A property of
 * the plot, not a figure any source reports in this form — the observations
 * themselves are badged beside the chart.
 */
function axisBound(value: number, spec: IndicatorSpec): string {
  return notAFact(
    formatAxisValue(value, spec),
    'axis scale bound describing the plotted range; every observation behind it is rendered with its own confidence badge above this chart',
  );
}

interface Projection {
  x: (year: number) => number;
  y: (value: number) => number;
  min: number;
  max: number;
}

function project(series: Series, options: ChartOptions): Projection | null {
  const values = series.points.map((point) => point.value).filter((value): value is number => value !== null);
  if (values.length === 0) return null;

  const years = series.points.map((point) => point.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const plotWidth = options.width - PAD.left - PAD.right;
  const plotHeight = options.height - PAD.top - PAD.bottom;

  const useLog = options.scale === 'log';
  const transform = (value: number): number => (useLog ? Math.log10(value) : value);

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // A flat series would divide by zero. Pad it symmetrically so the line sits
    // mid-plot rather than on an edge, which would read as a boundary value.
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const tMin = transform(useLog ? Math.max(min, Number.MIN_VALUE) : min);
  const tMax = transform(useLog ? Math.max(max, Number.MIN_VALUE) : max);
  const span = tMax - tMin || 1;

  return {
    x: (year) => PAD.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * plotWidth,
    y: (value) => PAD.top + plotHeight - ((transform(value) - tMin) / span) * plotHeight,
    min,
    max,
  };
}

/**
 * Runs of consecutive observed points. Each becomes its own polyline.
 *
 * Generic over the point type so a series keyed by day gets the same
 * never-bridge-a-gap behaviour as one keyed by year, from the same code rather
 * than a parallel implementation that could drift.
 */
export function segmentsOf<T extends { value: number | null }>(points: readonly T[]): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function renderChart(series: Series, options: ChartOptions): string {
  if (series.empty) {
    return `<div class="chart chart--empty" role="img"
      aria-label="No data for ${escapeHtml(series.spec.name)}">
      <span>No observations. Nothing is plotted — a flat line at zero would say
      this indicator measured zero, which is a different claim.</span>
    </div>`;
  }

  const projection = project(series, options);
  if (!projection) return '';

  const segments = segmentsOf(series.points);

  // Built as plain strings so no coordinate is interpolated into markup raw.
  const polylines = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const pointsAttr = segment
        .map((point) => `${coord(projection.x(point.year))},${coord(projection.y(point.value as number))}`)
        .join(' ');
      const singleton = segment.length === 1;
      return singleton
        ? `<circle class="chart-dot" cx="${coord(projection.x((segment[0] as SeriesPoint).year))}" cy="${coord(
            projection.y((segment[0] as SeriesPoint).value as number),
          )}" r="2" />`
        : `<polyline class="chart-line" points="${pointsAttr}" />`;
    })
    .join('');

  const gapBands = series.gaps
    .map((gap) => {
      const x1 = projection.x(gap.fromYear - 0.5);
      const x2 = projection.x(gap.toYear + 0.5);
      return `<rect class="chart-gap" x="${coord(x1)}" y="${coord(PAD.top)}"
        width="${coord(Math.max(2, x2 - x1))}" height="${coord(options.height - PAD.top - PAD.bottom)}"
        ><title>No data ${escapeHtml(axisYear(gap.fromYear))}–${escapeHtml(axisYear(gap.toYear))}. Not interpolated.</title></rect>`;
    })
    .join('');

  const firstYear = series.points[0]?.year ?? 0;
  const lastYear = series.points[series.points.length - 1]?.year ?? 0;

  const axis =
    `<text class="chart-axis" x="${coord(PAD.left)}" y="${coord(options.height - 5)}" text-anchor="start"` +
    `>${escapeHtml(axisYear(firstYear))}</text>` +
    `<text class="chart-axis" x="${coord(options.width - PAD.right)}" y="${coord(options.height - 5)}" text-anchor="end"` +
    `>${escapeHtml(axisYear(lastYear))}</text>` +
    `<text class="chart-axis" x="${coord(PAD.left - 4)}" y="${coord(PAD.top + 4)}" text-anchor="end"` +
    `>${escapeHtml(axisBound(projection.max, series.spec))}</text>` +
    `<text class="chart-axis" x="${coord(PAD.left - 4)}" y="${coord(options.height - PAD.bottom)}" text-anchor="end"` +
    `>${escapeHtml(axisBound(projection.min, series.spec))}</text>`;

  const label =
    `${series.spec.name}, ${firstYear} to ${lastYear}, ${options.scale} scale` +
    (series.gaps.length > 0 ? `, ${series.gaps.length} gap(s) not interpolated` : '');

  return `<svg class="chart" viewBox="0 0 ${dimension(options.width)} ${dimension(options.height)}"
    width="100%" height="${dimension(options.height)}" role="img"
    aria-label="${escapeHtml(label)}" preserveAspectRatio="none">
    <defs><pattern id="chart-gap-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y="0" x2="0" y2="4" stroke="#4a3a12" stroke-width="2"/></pattern></defs>
    ${gapBands}
    ${polylines}
    ${axis}
  </svg>`;
}
