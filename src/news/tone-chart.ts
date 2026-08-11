import { escapeHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import { segmentsOf } from '../economy/chart';
import type { ToneTimeline, TonePoint } from '../sources/gdelt-tone';

/**
 * Media tone timeline.
 *
 * The most misleading single element this app could contain, if drawn
 * carelessly. A tone line reads as "how bad things are in country X". It is
 * nothing of the sort: it is a machine sentiment estimate of the English-language
 * coverage GDELT happened to index. That caveat is rendered ON the chart — in
 * the visible caption and the accessible label — not in a footnote below it,
 * because the footnote is exactly what a reader skips.
 *
 * Gap handling is identical to the economy charts and shares `segmentsOf`: a day
 * with no indexed coverage breaks the line. A quiet news week must never render
 * as a tone value.
 */

const PAD = { top: 12, right: 8, bottom: 14, left: 30 };

export interface ToneChartOptions {
  width: number;
  height: number;
}

function coord(value: number): string {
  return notAFact(
    Math.round(value * 100) / 100,
    'SVG coordinate for the tone plot — geometry derived from the badged DERIVED tone series, not a fact in itself',
  );
}

function dimension(value: number): string {
  return notAFact(value, 'SVG canvas dimension in pixels — a layout constant, not data about the world');
}

/** Tone runs roughly -10..+10; the axis is fixed so charts stay comparable. */
const TONE_MIN = -10;
const TONE_MAX = 10;

export function renderToneChart(timeline: ToneTimeline, options: ToneChartOptions): string {
  if (timeline.observedDays === 0) {
    return `<div class="chart chart--empty" role="img" aria-label="No indexed coverage to compute tone from">
      <span>No indexed coverage in this window, so there is no tone to plot.
      Nothing is drawn — a line at zero would report neutral sentiment, which is
      a claim about coverage that does not exist.</span>
    </div>`;
  }

  const plotWidth = options.width - PAD.left - PAD.right;
  const plotHeight = options.height - PAD.top - PAD.bottom;
  const lastIndex = Math.max(1, timeline.points.length - 1);

  const x = (index: number): number => PAD.left + (index / lastIndex) * plotWidth;
  const y = (value: number): number =>
    PAD.top + plotHeight - ((value - TONE_MIN) / (TONE_MAX - TONE_MIN)) * plotHeight;

  const indexed: Array<TonePoint & { index: number }> = timeline.points.map((point, index) => ({ ...point, index }));
  const segments = segmentsOf(indexed);

  const lines = segments
    .map((segment) => {
      if (segment.length === 1) {
        const only = segment[0] as TonePoint & { index: number };
        return `<circle class="tone-dot" cx="${coord(x(only.index))}" cy="${coord(y(only.value as number))}" r="1.8" />`;
      }
      const attr = segment.map((point) => `${coord(x(point.index))},${coord(y(point.value as number))}`).join(' ');
      return `<polyline class="tone-line" points="${attr}" />`;
    })
    .join('');

  // Zero is meaningful for tone — it separates negative from positive coverage —
  // so it gets a baseline, unlike the economy charts where zero is arbitrary.
  const zeroLine = `<line class="tone-zero" x1="${coord(PAD.left)}" y1="${coord(y(0))}"
    x2="${coord(options.width - PAD.right)}" y2="${coord(y(0))}" />`;

  const gapBands = gapRuns(indexed)
    .map(
      (run) =>
        `<rect class="chart-gap" x="${coord(x(run.from) - 1)}" y="${coord(PAD.top)}"
          width="${coord(Math.max(2, x(run.to) - x(run.from) + 2))}" height="${coord(plotHeight)}"
          ><title>No indexed coverage on these days. Not interpolated.</title></rect>`,
    )
    .join('');

  const first = timeline.points[0]?.day ?? '';
  const last = timeline.points[timeline.points.length - 1]?.day ?? '';

  const axis =
    `<text class="chart-axis" x="${coord(PAD.left - 3)}" y="${coord(PAD.top + 4)}" text-anchor="end">+10</text>` +
    `<text class="chart-axis" x="${coord(PAD.left - 3)}" y="${coord(options.height - PAD.bottom)}" text-anchor="end">-10</text>` +
    `<text class="chart-axis" x="${coord(PAD.left)}" y="${coord(options.height - 3)}" text-anchor="start"
      >${escapeHtml(first)}</text>` +
    `<text class="chart-axis" x="${coord(options.width - PAD.right)}" y="${coord(options.height - 3)}" text-anchor="end"
      >${escapeHtml(last)}</text>`;

  const label =
    'Machine sentiment estimate of English-language news coverage indexed by GDELT. ' +
    'Not a measure of conditions in this country. ' +
    `${first} to ${last}` +
    (timeline.missingDays > 0 ? `, days with no indexed coverage are not interpolated` : '');

  return `<figure class="tone-figure">
    <svg class="chart tone-chart" viewBox="0 0 ${dimension(options.width)} ${dimension(options.height)}"
      width="100%" height="${dimension(options.height)}" role="img"
      aria-label="${escapeHtml(label)}" preserveAspectRatio="none">
      ${gapBands}
      ${zeroLine}
      ${lines}
      ${axis}
    </svg>
    <figcaption class="tone-caption">
      <span class="badge badge--derived">ƒ DERIVED</span>
      <strong>Tone of coverage, not conditions.</strong> A machine sentiment estimate of the
      English-language articles GDELT indexed. It measures how this country was written
      about, in the sources GDELT crawls — not what happened here.
    </figcaption>
  </figure>`;
}

interface Run {
  from: number;
  to: number;
}

function gapRuns(points: ReadonlyArray<{ value: number | null; index: number }>): Run[] {
  const runs: Run[] = [];
  let start: number | null = null;
  let seenValue = false;

  for (const point of points) {
    if (point.value === null) {
      // Leading nulls are not a gap: the window simply began before coverage did.
      if (seenValue && start === null) start = point.index;
    } else {
      if (start !== null) {
        runs.push({ from: start, to: point.index - 1 });
        start = null;
      }
      seenValue = true;
    }
  }
  return runs;
}
