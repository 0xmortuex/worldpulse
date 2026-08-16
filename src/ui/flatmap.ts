import type { Country } from '../countries';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';
import type { EventCluster } from '../layers/events';

/**
 * The 2D flat-map fallback — Phase C.1.
 *
 * ## One source of truth, two renderings
 *
 * The flat map takes the SAME country features, the SAME polygon styles and the
 * SAME event clusters the globe is handed. It is a projection of the app's
 * state, not a second model of it — two models eventually disagree, and a
 * reader switched between them would see two different answers to one question.
 *
 * ## The switch is disclosed, never silent
 *
 * A reader moved off the globe by a frame-rate measurement must be told that it
 * happened and why. Silently degrading a surface is the same class as silently
 * dropping rows: the result looks like a choice somebody made rather than a
 * limitation they should know about.
 *
 * ## Equirectangular, and honest about what that costs
 *
 * Longitude maps linearly to x and latitude to y. That distorts area badly at
 * high latitudes — Greenland is famously wrong — so the map carries that as a
 * caveat rather than leaving a reader to infer size from it. This surface
 * exists to be READABLE at low frame rates, not to be an equal-area projection,
 * and saying so is cheaper than pretending otherwise.
 */

export const FLATMAP_WIDTH = 1000;
export const FLATMAP_HEIGHT = 500;

/** Longitude/latitude to SVG coordinates. Exported so a test can drive it. */
export function project(lat: number, lng: number): { x: number; y: number } {
  return {
    x: ((lng + 180) / 360) * FLATMAP_WIDTH,
    y: ((90 - lat) / 180) * FLATMAP_HEIGHT,
  };
}

function ringPath(ring: ReadonlyArray<readonly [number, number]>): string {
  if (ring.length === 0) return '';
  const points = ring.map(([lng, lat]) => {
    const { x, y } = project(lat, lng);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${points.join('L')}Z`;
}

function countryPath(country: Country): string {
  const geometry = country.feature.geometry;
  const rings =
    geometry.type === 'Polygon'
      ? (geometry.coordinates as Array<Array<[number, number]>>)
      : (geometry.coordinates as Array<Array<Array<[number, number]>>>).flat();

  /**
   * A polygon crossing the antimeridian projects to a band across the whole
   * map. Rings whose longitude span exceeds half the world are dropped rather
   * than drawn, because a stripe through the Pacific is a rendering artefact a
   * reader would take for territory.
   */
  return rings
    .filter((ring) => {
      const longitudes = ring.map(([lng]) => lng);
      return Math.max(...longitudes) - Math.min(...longitudes) < 180;
    })
    .map(ringPath)
    .join(' ');
}

export interface FlatMapInput {
  countries: readonly Country[];
  /** The SAME map the globe is given. */
  styles: ReadonlyMap<string, { cap: string; stroke: string }>;
  clusters: readonly EventCluster[];
  selected: readonly string[];
  /** Why the reader is looking at this instead of the globe, or null if chosen. */
  autoSwitchReason: string | null;
}

export function renderFlatMap(input: FlatMapInput): string {
  const paths = input.countries
    .map((country) => {
      const style = input.styles.get(country.code);
      const path = countryPath(country);
      if (path === '') return '';
      return `<path d="${path}" class="flat-country${input.selected.includes(country.code) ? ' flat-country--selected' : ''}"
        fill="${style?.cap ?? '#1a1a20'}" stroke="${style?.stroke ?? '#2a2f38'}"
        data-select="${escapeHtml(country.code)}"><title>${escapeHtml(country.name)}</title></path>`;
    })
    .join('');

  const markers = input.clusters
    .map((cluster) => {
      const { x, y } = project(cluster.lat, cluster.lng);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"
        class="flat-marker"><title>${escapeHtml(cluster.representative.title)}</title></circle>`;
    })
    .join('');

  return `<div class="flat">
    ${
      input.autoSwitchReason === null
        ? ''
        : `<p class="flat-notice"><strong>Switched to the flat map.</strong>
           ${escapeHtml(input.autoSwitchReason)} You can switch back; this is a rendering
           choice, not a change to the data.</p>`
    }
    <svg class="flat-svg" viewBox="0 0 ${n(FLATMAP_WIDTH, 'SVG viewBox width — a drawing surface dimension chosen by this app, not a measurement of anything')} ${n(FLATMAP_HEIGHT, 'SVG viewBox height — a drawing surface dimension chosen by this app, not a measurement of anything')}"
      role="img" aria-label="Flat map of countries, coloured as the globe is">
      <g class="flat-countries">${paths}</g>
      <g class="flat-markers">${markers}</g>
    </svg>
    <p class="flat-caveat">Equirectangular projection: longitude and latitude map straight to
    x and y, so area is badly distorted toward the poles. Read this map for position and
    colour, never for size. Showing
    ${n(input.clusters.length, 'event markers on this map, the same clusters the globe is given')}
    markers.</p>
  </div>`;
}

/**
 * Should the app switch itself?
 *
 * Exported and pure, because the alternative is a threshold reachable only by
 * running the app slowly — which is not a thing a test can arrange reliably
 * (rule 32). The numbers come from measurement: this project has observed
 * 59.9fps on a GPU renderer and **1.3fps under SwiftShader on the same
 * machine**, so a threshold anywhere between them separates the two real
 * populations rather than splitting one.
 */
export const UNSUSTAINABLE_FPS = 15;

export function shouldAutoSwitch(fps: number | null): { switch: boolean; reason: string | null } {
  /**
   * A null reading is INCONCLUSIVE, not slow. Rule 3: a measurement that did
   * not happen is not evidence of a bad one, and switching a reader off the
   * globe because a probe failed would be a worse outcome than a slow globe.
   */
  if (fps === null) return { switch: false, reason: null };

  if (fps < UNSUSTAINABLE_FPS) {
    return {
      switch: true,
      reason:
        `The globe was rendering at about ${Math.round(fps)} frames per second, below the ` +
        `${UNSUSTAINABLE_FPS} this app treats as usable.`,
    };
  }
  return { switch: false, reason: null };
}
