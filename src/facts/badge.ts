import { getSource } from './registry';
import { factState, TIER_EXPLANATIONS, type AnyFact, type Fact, type FactState, type Tier } from './types';

/**
 * The only sanctioned way to render a fact anywhere in the app.
 *
 * Returns an HTML string rather than an element so it composes into globe.gl
 * tooltips and panel templates alike. Facts are registered by id so the
 * inspector can recover the full object from a click.
 */

/**
 * Facts are registered by id so the inspector can recover the whole object from
 * a click on a badge in an HTML string.
 *
 * Ids are monotonic and NEVER reused. An earlier version cleared the map each
 * render pass, which meant any DOM that outlived a pass — the component gallery,
 * for one — kept ids that were later reassigned to different facts. Clicking
 * such a badge opened another value's provenance. Showing the wrong provenance
 * is worse than showing none, so ids are now unique for the life of the page and
 * a stale one simply resolves to nothing.
 *
 * Memory is bounded by evicting in insertion order instead. The globe registers
 * one fact per country per pass, so the cap is generous enough to cover many
 * passes while keeping the map from growing without limit.
 */
const MAX_REGISTERED = 20_000;

let counter = 0;
const registered = new Map<string, AnyFact>();

function register(fact: AnyFact): string {
  const id = `fact-${(counter += 1)}`;
  registered.set(id, fact);
  while (registered.size > MAX_REGISTERED) {
    const oldest = registered.keys().next();
    if (oldest.done) break;
    registered.delete(oldest.value);
  }
  return id;
}

export function getRegisteredFact(id: string): AnyFact | undefined {
  return registered.get(id);
}

/** Test seam: the number of facts currently recoverable by the inspector. */
export function registrySize(): number {
  return registered.size;
}

/** Glyphs carry the tier distinction for anyone who cannot rely on colour. */
const TIER_GLYPH: Record<Tier, string> = {
  OFFICIAL: '✓',
  ESTIMATE: '≈',
  DERIVED: 'ƒ',
};

export interface FactOptions {
  /** Label rendered before the value. */
  label?: string;
  /** Suppress the "as of" chip where the surrounding UI already states it. */
  hideAsOf?: boolean;
  /**
   * Glyph-only badge, for dense lists where a full tier word per row would
   * drown the data. The title and aria-label are unchanged, so the tier and
   * source are still one hover or one screen-reader stop away.
   */
  compact?: boolean;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function formatValue<T>(fact: Fact<T>): string {
  if (fact.value === null) return '';
  const text = fact.format ? fact.format(fact.value) : String(fact.value);
  return fact.unit ? `${text} ${fact.unit}` : text;
}

function sourceName(fact: AnyFact): string {
  const provenance = fact.provenance;
  if (!provenance) return 'no source recorded';
  if (provenance.kind === 'derived') return `computed by ${provenance.computedBy}`;
  if (provenance.kind === 'seed') return `hand-checked seed, from ${provenance.source}`;
  return getSource(provenance.sourceId)?.name ?? `unregistered source "${provenance.sourceId}"`;
}

function badgeMarkup(fact: AnyFact, state: FactState, id: string, compact: boolean): string {
  if (state === 'broken') {
    // Deliberately the loudest thing on the page. An untraceable value that
    // looks authoritative is worse than no value at all.
    return `<button type="button" class="badge badge--broken" data-fact="${id}"
      title="This value cannot be traced to a request or a computation. It must not be trusted. Click to inspect."
      aria-label="Untraceable value. Click to inspect provenance.">⚠ UNTRACEABLE</button>`;
  }
  if (state === 'unconfigured') {
    return `<button type="button" class="badge badge--unconfigured" data-fact="${id}"
      title="This source needs an API key that is not configured. Click to inspect."
      aria-label="Source not configured. Click to inspect.">KEY NOT SET</button>`;
  }
  if (state === 'unavailable') {
    // NOT a tier badge. Falling through to the tier branch would put an
    // OFFICIAL badge over a blank value, which is the wrong-value shape this
    // state exists to prevent: the badge would assert a confidence level for a
    // value we never received.
    return `<button type="button" class="badge badge--unavailable" data-fact="${id}"
      title="The request to this source did not succeed. This says nothing about the subject — only about our request. Click to inspect."
      aria-label="Source unavailable. Click to inspect the failed request.">UNAVAILABLE</button>`;
  }
  const tier = fact.tier;
  const explanation = `${TIER_EXPLANATIONS[tier]} Source: ${sourceName(fact)}.`;
  const face = compact ? TIER_GLYPH[tier] : `${TIER_GLYPH[tier]} ${tier}`;
  return `<button type="button" class="badge badge--${tier.toLowerCase()}${compact ? ' badge--compact' : ''}" data-fact="${id}"
    title="${escapeHtml(explanation)}"
    aria-label="${escapeHtml(`${tier}. ${explanation} Click to inspect provenance.`)}"
    >${face}</button>`;
}

export function factHtml<T>(fact: Fact<T>, options: FactOptions = {}): string {
  const state = factState(fact);
  const id = register(fact);

  const label = options.label ? `<span class="fact-label">${escapeHtml(options.label)}</span>` : '';

  /**
   * "no data" and "unavailable" must not share wording.
   *
   * "no data" is a claim about the subject: the source was asked and had
   * nothing. "unavailable" is a claim about our request. Rendering the second
   * with the first's words is rule 30's conflation, and it is the reason this
   * state exists at all.
   */
  const value =
    state === 'nodata'
      ? '<span class="fact-value fact-value--nodata">no data</span>'
      : state === 'unconfigured'
        ? '<span class="fact-value fact-value--nodata">not configured</span>'
        : state === 'unavailable'
          ? '<span class="fact-value fact-value--unavailable">source unavailable</span>'
          : `<span class="fact-value">${escapeHtml(formatValue(fact))}</span>`;

  // `asOf` dates the DATA. With no data received there is nothing for it to
  // date, and rendering the stale one would put a confident date on an absence.
  const asOf =
    options.hideAsOf || state === 'unconfigured' || state === 'unavailable' || !fact.asOf
      ? ''
      : `<span class="fact-asof">as of ${escapeHtml(fact.asOf)}</span>`;

  const note = fact.note ? `<span class="fact-note">${escapeHtml(fact.note)}</span>` : '';

  const badge = badgeMarkup(fact, state, id, options.compact === true);
  return `<span class="fact" data-state="${state}">${label}${value}${badge}${asOf}${note}</span>`;
}
