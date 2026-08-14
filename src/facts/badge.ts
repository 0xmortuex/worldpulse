import { getSource } from './registry';
import { assertNever } from './exhaustive';
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
  // '?' rather than a warning mark: this is an absence of corroboration, not an
  // alarm. The alarm glyph belongs to UNTRACEABLE, which is our defect.
  UNVERIFIED: '?',
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
  const named = (sourceId: string): string =>
    getSource(sourceId)?.name ?? `unregistered source "${sourceId}"`;

  switch (provenance.kind) {
    case 'derived':
      return `computed by ${provenance.computedBy}`;
    case 'seed':
      return `hand-checked seed, from ${provenance.source}`;
    case 'fetch':
    case 'unconfigured':
      return named(provenance.sourceId);
    case 'fetch-failed':
      // Named explicitly rather than sharing the tail: the three kinds above
      // all carry `sourceId`, so a new kind that also carried one would have
      // fallen in here silently and been described as a source we fetched.
      return named(provenance.sourceId);
    default:
      return assertNever(provenance, 'sourceName');
  }
}

/**
 * EXHAUSTIVE BY CONSTRUCTION. This dispatch shipped the OFFICIAL-badge-over-a-
 * blank-value defect when it was a chain of `if`s with a tier fall-through, and
 * a string-literal union gives the compiler nothing to catch that with. The
 * `default` arm is the whole point: a sixth state must not silently become a
 * tier badge.
 */
function badgeMarkup(fact: AnyFact, state: FactState, id: string, compact: boolean): string {
  switch (state) {
    case 'broken':
      // Deliberately the loudest thing on the page. An untraceable value that
      // looks authoritative is worse than no value at all.
      return `<button type="button" class="badge badge--broken" data-fact="${id}"
        title="This value cannot be traced to a request or a computation. It must not be trusted. Click to inspect."
        aria-label="Untraceable value. Click to inspect provenance.">⚠ UNTRACEABLE</button>`;
    case 'unconfigured':
      return `<button type="button" class="badge badge--unconfigured" data-fact="${id}"
        title="This source needs an API key that is not configured. Click to inspect."
        aria-label="Source not configured. Click to inspect.">KEY NOT SET</button>`;
    case 'unavailable':
      return `<button type="button" class="badge badge--unavailable" data-fact="${id}"
        title="The request to this source did not succeed. This says nothing about the subject — only about our request. Click to inspect."
        aria-label="Source unavailable. Click to inspect the failed request.">UNAVAILABLE</button>`;
    case 'ok':
    case 'nodata':
      // The only two states a tier badge may describe: we reached the source and
      // it answered, with a value or with nothing.
      break;
    default:
      return assertNever(state, 'badgeMarkup');
  }

  const tier = fact.tier;
  const explanation = `${TIER_EXPLANATIONS[tier]} Source: ${sourceName(fact)}.`;
  const face = compact ? TIER_GLYPH[tier] : `${TIER_GLYPH[tier]} ${tier}`;
  return `<button type="button" class="badge badge--${tier.toLowerCase()}${compact ? ' badge--compact' : ''}" data-fact="${id}"
    title="${escapeHtml(explanation)}"
    aria-label="${escapeHtml(`${tier}. ${explanation} Click to inspect provenance.`)}"
    >${face}</button>`;
}

/**
 * EXHAUSTIVE BY CONSTRUCTION, for the same reason as `badgeMarkup`.
 *
 * "no data" and "unavailable" must not share wording. "no data" is a claim about
 * the SUBJECT — the source was asked and had nothing. "unavailable" is a claim
 * about OUR REQUEST. Rendering the second in the first's words is rule 30's
 * conflation, and is why the fifth state exists.
 */
export function absentValueWording(state: FactState): string | null {
  // Shared so the inspector cannot drift from the badge. The inspector rendered
  // "no data" for ANY null value, which said the subject had nothing whenever a
  // request had failed — the same conflation as the badge, one dialog away.
  switch (state) {
    case 'nodata':
      return 'no data';
    case 'unconfigured':
      return 'not configured';
    case 'unavailable':
      return 'source unavailable';
    case 'ok':
    case 'broken':
      return null;
    default:
      return assertNever(state, 'absentValueWording');
  }
}

function valueMarkup(fact: AnyFact, state: FactState): string {
  switch (state) {
    case 'nodata':
      return '<span class="fact-value fact-value--nodata">no data</span>';
    case 'unconfigured':
      return '<span class="fact-value fact-value--nodata">not configured</span>';
    case 'unavailable':
      return '<span class="fact-value fact-value--unavailable">source unavailable</span>';
    case 'ok':
    case 'broken':
      // `broken` still shows its value: the alarm is about traceability, and
      // hiding the number would remove the evidence someone needs to diagnose it.
      return `<span class="fact-value">${escapeHtml(formatValue(fact))}</span>`;
    default:
      return assertNever(state, 'valueMarkup');
  }
}

/**
 * Does this state have data for `asOf` to date?
 *
 * `asOf` dates the DATA, not the request. A date rendered over an absence is a
 * timestamp that lies — it lends a specific, checkable-looking fact to something
 * we do not have.
 *
 * `broken` is the subtle one and it is excluded deliberately. The value is
 * present but untraceable, so "as of 2024" attaches a confident date to a number
 * that must not be trusted, which is precisely the air of legitimacy the
 * UNTRACEABLE badge exists to strip.
 */
export function stateCarriesAsOf(state: FactState): boolean {
  switch (state) {
    case 'ok':
      return true;
    case 'nodata':
      // Kept, and it is a genuine judgement call rather than an oversight — see
      // OPEN-QUESTIONS. "no data as of 2024" can be read as dating the release
      // we queried, which is true and useful, or as dating an absence, which is
      // the same objection as above. Behaviour is unchanged pending a decision.
      return true;
    case 'broken':
    case 'unconfigured':
    case 'unavailable':
      return false;
    default:
      return assertNever(state, 'stateCarriesAsOf');
  }
}

export function factHtml<T>(fact: Fact<T>, options: FactOptions = {}): string {
  const state = factState(fact);
  const id = register(fact);

  const label = options.label ? `<span class="fact-label">${escapeHtml(options.label)}</span>` : '';

  const value = valueMarkup(fact, state);

  const asOf =
    options.hideAsOf || !stateCarriesAsOf(state) || !fact.asOf
      ? ''
      : `<span class="fact-asof">as of ${escapeHtml(fact.asOf)}</span>`;

  const note = fact.note ? `<span class="fact-note">${escapeHtml(fact.note)}</span>` : '';

  const badge = badgeMarkup(fact, state, id, options.compact === true);
  return `<span class="fact" data-state="${state}">${label}${value}${badge}${asOf}${note}</span>`;
}
