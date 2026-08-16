import { TIER_COLORS, TIER_COLORS_LOW_CONFIDENCE } from '../theme';
import type { RelationResult, Tier } from './types';

/**
 * Step 12's other half — relation edges drawn on the globe.
 *
 * ## An arc is a claim, and it is a DERIVED one
 *
 * A line between two countries reads as a fact about those countries. It is
 * not: it is this app's classification, computed from weights the reader can
 * move with a slider. The whole surface says `[DERIVED]`, and every arc's
 * inspector reaches the same arithmetic the relation row does — the arc and the
 * row are the same claim rendered twice, so they must never be able to
 * disagree.
 *
 * ## What is deliberately NOT drawn
 *
 * **`nodata` pairs get no arc.** An absent line is the correct rendering for
 * "we have nothing", and drawing a faint one would put a claim on the globe
 * where the app has none — the exact failure the tier exists to prevent.
 *
 * **`neutral` pairs get no arc either**, and this one is a judgement worth
 * stating: a neutral classification IS a finding, but an arc for every neutral
 * pair would draw a line from the subject to most of the world, and a surface
 * where everything is connected shows nothing. The neutral finding stays
 * available in the relations list, which is where it can be read rather than
 * merely seen.
 */

export interface RelationArc {
  subject: string;
  other: string;
  tier: Tier;
  color: string;
  /** Thicker for stronger classifications, so the channel is not colour alone. */
  stroke: number;
  /** Dashed when the classification rests mostly on stale evidence. */
  dashed: boolean;
  label: string;
}

/** Tiers that earn a line. See the note above on neutral and nodata. */
const DRAWN: readonly Tier[] = ['ally', 'adversary', 'strained'];

export function arcsFor(
  results: readonly RelationResult[],
  options: { subjectName: string; nameOf: (iso3: string) => string },
): RelationArc[] {
  return results
    .filter((result) => DRAWN.includes(result.tier))
    .map((result) => {
      const palette = result.lowConfidence ? TIER_COLORS_LOW_CONFIDENCE : TIER_COLORS;

      /**
       * Stroke width is a second channel for the same information, per B1.
       * An arc map read by someone who cannot separate the hues would
       * otherwise be a tangle of identical lines.
       */
      const magnitude = Math.abs(result.score);
      const stroke = magnitude >= 6 ? 0.55 : magnitude >= 3 ? 0.4 : 0.25;

      return {
        subject: result.subject,
        other: result.other,
        tier: result.tier,
        color: palette[result.tier],
        stroke,
        /**
         * A THIRD channel, and the one that survives both colour blindness and
         * a greyscale screenshot: low-confidence arcs are dashed. It marks the
         * same state the relations row marks with its muted palette, so the two
         * renderings of one claim stay consistent.
         */
        dashed: result.lowConfidence,
        label:
          `${options.subjectName} — ${options.nameOf(result.other)}: ` +
          `${result.tier}${result.lowConfidence ? ' (low confidence)' : ''}. ` +
          'Classified by this app from weighted findings, not reported by any source.',
      };
    });
}

/**
 * Arcs and rows must describe the same set.
 *
 * Exported for the test rather than kept private, because the failure it
 * guards against is silent: an arc set built from a different filter than the
 * list would draw lines the panel does not explain, or explain relations the
 * globe does not draw, and either way the two surfaces would disagree about
 * what the app believes.
 */
export function drawnTiers(): readonly Tier[] {
  return DRAWN;
}

/**
 * A country's largest ring, which is where its arc should terminate.
 *
 * The naive choice — the first ring — puts France's endpoint in French Guiana
 * and the United States' somewhere in the Aleutians, because a MultiPolygon's
 * ring order is a property of the source file rather than of the country. The
 * largest ring is the mainland for every country this app renders.
 *
 * Area is computed by the shoelace formula on raw degrees. That is not a real
 * area — it is distorted by latitude — but it is only ever used to COMPARE
 * rings of the same country, where the distortion is nearly equal and cancels.
 * Using a projected area here would be precision nobody reads.
 */
export function largestRing(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): ReadonlyArray<readonly [number, number]> | null {
  let best: ReadonlyArray<readonly [number, number]> | null = null;
  let bestArea = -1;

  for (const ring of rings) {
    let area = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const [x1, y1] = ring[i]!;
      const [x2, y2] = ring[(i + 1) % ring.length]!;
      area += x1 * y2 - x2 * y1;
    }
    const size = Math.abs(area) / 2;
    if (size > bestArea) {
      bestArea = size;
      best = ring;
    }
  }

  return best;
}
