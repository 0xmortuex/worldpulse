import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from './relations/score';
import type { Thresholds, Weights } from './relations/types';
import type { AppState, TabId } from './state';

/**
 * Step 13 / Phase B2 — view state in the URL.
 *
 * ## What a shared link has to survive
 *
 * A link is only worth having if the page it opens says what the sender saw.
 * That makes two things load-bearing:
 *
 * **A malformed URL must not silently become a different view.** If someone
 * hand-edits a weight to `banana`, the honest response is to use the default
 * for that weight — not to parse it as `NaN` and score every relation against
 * it, which produces a page that is confidently wrong rather than obviously
 * reset.
 *
 * **The round trip must be exact.** State → URL → state has to return what it
 * started with, or a shared link shows the sender something different from what
 * they sent. That is asserted for the empty case and the maximal one, because
 * those are the two ends nobody tests by hand.
 *
 * ## What is deliberately NOT in the URL
 *
 * `hovered` — it is a pointer position, not a view. Putting it in a link would
 * make every mouse movement a history entry.
 */

const TABS: readonly TabId[] = ['government', 'legislature', 'military', 'economy', 'news', 'tv', 'risk'];

/** Weight keys, in a fixed order so the URL is stable between renders. */
const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS).sort() as Array<keyof Weights>;
const THRESHOLD_KEYS = Object.keys(DEFAULT_THRESHOLDS).sort() as Array<keyof Thresholds>;

export interface UrlState {
  selected: string[];
  tab: TabId;
  weights: Weights;
  thresholds: Thresholds;
  layers: string[];
  includeStale: boolean;
  coverageMode: boolean;
  /** Null is the present, and the present is not written to the URL. */
  asOfYear: number | null;
}

/**
 * Only non-default values are written.
 *
 * A URL carrying every weight at its default is unreadable and, worse, freezes
 * today's defaults into every link ever shared — so changing a default later
 * would silently not apply to anyone with an old link. Omitting them means a
 * link says "the defaults, whatever they are now", which is what a reader
 * sharing a view actually means.
 */
export function toSearch(state: AppState): string {
  const params = new URLSearchParams();

  if (state.selected.length > 0) params.set('c', state.selected.join(','));
  if (state.tab !== 'government') params.set('tab', state.tab);
  if (state.includeStale) params.set('stale', '1');
  if (state.coverageMode) params.set('coverage', '1');
  if (state.asOfYear !== null) params.set('asof', String(state.asOfYear));

  const layers = [...state.layers].sort();
  params.set('layers', layers.join(','));

  for (const key of WEIGHT_KEYS) {
    if (state.weights[key] !== DEFAULT_WEIGHTS[key]) params.set(`w.${key}`, String(state.weights[key]));
  }
  for (const key of THRESHOLD_KEYS) {
    if (state.thresholds[key] !== DEFAULT_THRESHOLDS[key]) {
      params.set(`t.${key}`, String(state.thresholds[key]));
    }
  }

  return params.toString();
}

/**
 * A number from the URL, or the default — never `NaN`.
 *
 * `Number('banana')` is `NaN`, and `NaN` propagates through every comparison as
 * `false`, so a single bad weight would silently reclassify every relation
 * rather than failing. Rule 29's shape: a guard keyed on a malformed value must
 * not fall through to using it.
 */
function numberOr(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function fromSearch(search: string): UrlState {
  const params = new URLSearchParams(search);

  const rawTab = params.get('tab');
  const tab = TABS.find((candidate) => candidate === rawTab) ?? 'government';

  const weights = { ...DEFAULT_WEIGHTS };
  for (const key of WEIGHT_KEYS) {
    weights[key] = numberOr(params.get(`w.${key}`), DEFAULT_WEIGHTS[key]);
  }

  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of THRESHOLD_KEYS) {
    thresholds[key] = numberOr(params.get(`t.${key}`), DEFAULT_THRESHOLDS[key]);
  }

  const rawLayers = params.get('layers');

  return {
    /**
     * Empty segments are dropped rather than kept as `''`. A trailing comma is
     * the most common hand-edit, and an empty country code would look up
     * nothing and render as a blank selection.
     */
    selected: (params.get('c') ?? '').split(',').filter((code) => code.length > 0),
    tab,
    weights,
    thresholds,
    /**
     * A MISSING `layers` and an EMPTY one are different, and this is the place
     * that distinction gets lost. Missing means "the sender never touched
     * layers" — use the defaults. Empty means "the sender turned them all off",
     * which is a view they may well want to share.
     */
    layers: rawLayers === null ? [] : rawLayers.split(',').filter((id) => id.length > 0),
    includeStale: params.get('stale') === '1',
    coverageMode: params.get('coverage') === '1',
    /**
     * A malformed as-of year falls back to the PRESENT, not to a parsed
     * nonsense year. `?asof=banana` showing 1970 would be a confidently wrong
     * historical view; showing now is obviously not what the link said, which
     * is the failure a reader can actually notice.
     */
    asOfYear: (() => {
      const raw = params.get('asof');
      if (raw === null) return null;
      const year = Number(raw);
      return Number.isInteger(year) && year > 1800 && year < 2200 ? year : null;
    })(),
  };
}

/** Did the URL specify layers at all? See the note above on missing vs empty. */
export function specifiesLayers(search: string): boolean {
  return new URLSearchParams(search).get('layers') !== null;
}
