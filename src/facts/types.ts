import { assertNever } from './exhaustive';

/**
 * Confidence tiers. Rendered visually distinct at a glance; ESTIMATE and
 * DERIVED must never be mistakable for OFFICIAL.
 */
/**
 * `UNVERIFIED` sits BELOW `ESTIMATE`, and is not a failure state.
 *
 * An estimate is someone credible publishing an approximation. `UNVERIFIED` is a
 * value this app could not corroborate at all — a single uncorroborated report, a
 * figure from a source with no verification status. It is still a value, it still
 * has provenance, and it still renders; what it lacks is anyone standing behind it.
 *
 * It must not be confused with `UNTRACEABLE`, which is a defect: a value that
 * reached the UI with no provenance. That one is our bug and shouts. This one is
 * an honest statement about the world's evidence, and is merely quiet.
 */
export type Tier = 'OFFICIAL' | 'ESTIMATE' | 'DERIVED' | 'UNVERIFIED';

export type CacheState = 'hit' | 'miss' | 'stale-revalidating';

/** A value that came off the wire. */
export interface FetchProvenance {
  kind: 'fetch';
  /** Key into data/sources.json. */
  sourceId: string;
  /** The exact URL requested, including query string. */
  requestUrl: string;
  httpStatus: number;
  /** When we fetched — distinct from the fact's asOf, which dates the data. */
  fetchedAt: string;
  cache: CacheState;
  /** Raw response body as received, before any extraction. */
  raw: unknown;
  /** How the value was extracted from `raw`, e.g. a JSON path. */
  extractedBy: string;
  /**
   * True while running on hand-authored fixtures rather than captured
   * responses. Surfaces as a warning in the inspector.
   */
  fromFixture?: boolean;
}

/** A value this app computed. Its inputs carry their own provenance. */
/**
 * One value a derivation consumed, and whether the derivation needs it.
 *
 * `fact`, not `provenance`. A provenance records how a value was obtained; "no
 * data" is a property of the VALUE, so a derivation holding only provenances
 * cannot see that an input came back empty — which is why P3 was unimplementable
 * for as long as `inputs` was `Provenance[]`.
 *
 * `required` distinguishes an input the derivation cannot be computed without
 * from one that merely contributes to it. **Undeclared is treated as required**
 * (fail closed, rule 29's polarity): forgetting the declaration makes a
 * derivation more cautious, never less, and the opposite default would let every
 * un-migrated derivation silently absorb missing data — P3's own failure,
 * reintroduced by the migration meant to end it.
 *
 * A wrapper rather than a parallel array, because two structures that can drift
 * will.
 */
export interface DerivedInput {
  fact: AnyFact;
  /**
   * Optional, and its absence is not neutral: **undeclared means required.**
   * Only an explicit `false` marks an input as merely contributing. See
   * `isRequired`.
   */
  required?: boolean;
}

/**
 * Is this input load-bearing for the derivation?
 *
 * **Fail closed** (rule 29's polarity): anything that is not explicitly `false`
 * is required. Forgetting the declaration makes a derivation more cautious,
 * never less — where the opposite default would let every un-migrated
 * derivation silently absorb missing data, which is P3's own failure
 * reintroduced by the migration meant to end it.
 */
export function isRequired(input: DerivedInput): boolean {
  return input.required !== false;
}

/**
 * How many merely-contributing inputs came back empty.
 *
 * A shortfall here does NOT change the derivation's state — the value is still
 * computable, and calling it "no data" would be a bigger lie than the shortfall.
 * It renders as a caveat instead, because a score computed from four of seven
 * findings is a real number that a reader should not mistake for a complete one.
 *
 * Returns `null` when there is nothing to say, so callers can attach a note
 * conditionally without testing counts themselves.
 */
export function contributingShortfall(
  provenance: DerivedProvenance,
): { missing: number; contributing: number } | null {
  const contributing = provenance.inputs.filter((input) => !isRequired(input));
  if (contributing.length === 0) return null;

  const missing = contributing.filter((input) => factState(input.fact) === 'nodata').length;
  return missing === 0 ? null : { missing, contributing: contributing.length };
}

export interface DerivedProvenance {
  kind: 'derived';
  /** Module that computed it, e.g. "relations/score.ts". */
  computedBy: string;
  /** The arithmetic, shown verbatim: "+3 +2 = 5". */
  formula: string;
  computedAt: string;
  inputs: DerivedInput[];
}

/**
 * A hand-checked fact from a seed table. Traceable to a human citation but
 * never fetched, so modelling it as a request would be a lie. Rendering it
 * as its own kind is what lets the inspector say "this was typed in by hand,
 * here is what it was checked against" at the level of an individual value
 * rather than as a banner over the whole app.
 */
export interface SeedProvenance {
  kind: 'seed';
  /** File the fact was read from. */
  file: string;
  /** What it was checked against. */
  source: string;
  sourceUrl: string;
  /** Year through which the fact is asserted to hold. */
  coverageEnd: number;
  compiledAt: string;
  note?: string;
}

/** A key-gated source with no key configured. Not an error — a known state. */
export interface UnconfiguredProvenance {
  kind: 'unconfigured';
  sourceId: string;
  keyEnv: string;
}

/**
 * Why a request did not produce a usable response.
 *
 * `shape` is deliberately in this list rather than being modelled as brokenness:
 * the origin answered and our parse disagreed, which is a real answer we cannot
 * use, not an untraceable value.
 */
export type FailureReason = 'network' | 'timeout' | 'http' | 'rate-limited' | 'shape' | 'aborted';

/**
 * A request that was made and did not produce a usable response.
 *
 * THIS EXISTS SO THAT A FAILED FETCH IS NOT RENDERED AS `nodata`.
 *
 * `nodata` means the source was asked and had nothing — a fact about the
 * subject. A timeout is a fact about our request. Routing one to the other
 * would render "no GDP data for this country" when what happened is that we
 * could not reach the World Bank, which is rule 30's conflation built into the
 * framework rather than into a call site, and it would happen in every panel at
 * once.
 *
 * `broken` is equally wrong in the other direction: this provenance is fully
 * traceable — source, URL, status, time — and `broken` means a defect in THIS
 * app. A source being down is not one.
 */
export interface FailedFetchProvenance {
  kind: 'fetch-failed';
  sourceId: string;
  requestUrl: string;
  /** null when the transport failed before any response arrived. */
  httpStatus: number | null;
  attemptedAt: string;
  attempts: number;
  reason: FailureReason;
  detail: string;
  /** When a retry becomes possible; null when nothing will be retried. */
  retryableAt: string | null;
}

export type Provenance =
  | FetchProvenance
  | DerivedProvenance
  | SeedProvenance
  | UnconfiguredProvenance
  | FailedFetchProvenance;

export interface Fact<T> {
  /** null means the source was asked and had nothing. Never a placeholder. */
  value: T | null;
  unit?: string;
  /** The date the DATA refers to, not when we fetched it. */
  asOf: string;
  tier: Tier;
  /**
   * How this value can be traced. `null` is a bug, not a state: a value with
   * no provenance renders as BROKEN, loudly. An untraceable OFFICIAL badge is
   * the worst failure mode this app has.
   */
  provenance: Provenance | null;
  /** Caveat rendered alongside the value. */
  note?: string;
  /**
   * How precisely the SOURCE located this, for facts that get plotted.
   *
   * Optional because it is meaningless for most facts — a GDP figure has no
   * resolution. Set it on anything that becomes a coordinate, and read the
   * claim through `resolutionClaim`, which handles the undeclared case.
   */
  resolution?: Resolution;
  /** Formatter for the value. Defaults to String(). */
  format?: (value: T) => string;
}

/**
 * A fact whose value type has been erased.
 *
 * `any` is deliberate and load-bearing: the optional `format: (value: T) => string`
 * makes `Fact<T>` invariant, so `Fact<number>` is not assignable to
 * `Fact<unknown>`. Code that holds facts generically — the render registry, the
 * inspector — needs a type that accepts all of them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFact = Fact<any>;

export type FactState = 'ok' | 'nodata' | 'broken' | 'unconfigured' | 'unavailable';

/**
 * Resolve what a fact should render as.
 *
 * Ordering matters: brokenness is checked before emptiness, so a fact that is
 * both untraceable and empty still shouts rather than quietly reading "no data".
 */
export function factState(fact: AnyFact): FactState {
  const provenance = fact.provenance;
  if (provenance === null) return 'broken';

  const traced = provenanceState(provenance);
  if (traced !== 'ok') return traced;

  if (fact.value === null) return 'nodata';
  return 'ok';
}

/**
 * How traceable a provenance is, following derivations down to their inputs.
 *
 * PROPAGATION RULES (docs/DECISIONS.md, "Provenance propagation"):
 *
 *   P1  Untraceability propagates unconditionally. A derivation with any broken
 *       input is broken. This is not a coverage question — a number resting on
 *       a value nobody can check is a value nobody can check, and rendering it
 *       as a confident DERIVED figure is the worst failure this app has.
 *   P2  Unconfigured propagates. If an input's source needs a key that is not
 *       set, the pipeline never ran and there is nothing to be confident about.
 *   P9  Unavailable propagates. A derivation with an input whose fetch failed is
 *       unavailable. The pipeline ran and did not complete, which as far as the
 *       confidence of the output goes is not a different situation from its
 *       never having started. P9 is P2's live sibling.
 *
 *       P9 is implementable where P3 is not, and the distinction is exact:
 *       unavailability is a property of a PROVENANCE, which `inputs` holds,
 *       while "no data" is a property of a VALUE, which it does not.
 *
 * Inputs used to be ignored entirely, so a seed with no citation rendered
 * BROKEN on its own but vanished into a confident derived value when used as an
 * input — the relation score has exactly that shape.
 *
 * P3 (missing data propagates through required inputs) is NOT implemented here
 * and cannot be: `DerivedProvenance.inputs` holds provenances, not facts, and
 * "no data" is a property of a value. Recorded as an open modelling gap rather
 * than silently approximated.
 */
function provenanceState(provenance: Provenance): FactState {
  // Exhaustive by construction. This chain was previously safe only by accident:
  // its tail read `.inputs`, so a new kind was caught only if it happened not to
  // have that property.
  switch (provenance.kind) {
    case 'unconfigured':
      return 'unconfigured';
    case 'fetch-failed':
      return 'unavailable';
    case 'fetch':
      return isTraceable(provenance) ? 'ok' : 'broken';
    case 'seed':
      return provenance.sourceUrl.length === 0 ? 'broken' : 'ok';
    case 'derived':
      break;
    default:
      return assertNever(provenance, 'provenanceState');
  }

  // A derivation with no recorded inputs cannot be audited, which is exactly
  // the failure the inspector exists to catch.
  if (provenance.inputs.length === 0) return 'broken';

  // Loudest wins: broken over unavailable over unconfigured over ok.
  //
  // `broken` stays first because it means a defect in this app, which outranks
  // a defect anywhere else. `unavailable` sits above `unconfigured` because it
  // is the actionable one — a failed fetch may recover or may need
  // investigating, where a missing key is a known, stable state someone has
  // already decided not to configure.
  //
  // Recursion is through `factState`, so an input's VALUE is visible here — the
  // whole point of the `Provenance[]` → `DerivedInput[]` change.
  const states = provenance.inputs.map((input) => factState(input.fact));
  if (states.includes('broken')) return 'broken';
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('unconfigured')) return 'unconfigured';

  /**
   * P3, landing here: **missing data propagates through REQUIRED inputs.**
   *
   * `nodata` sits below `unconfigured` in the merged ladder
   * (broken > unavailable > unconfigured > nodata > ok) — see `DECISIONS.md`,
   * "Provenance propagation". It is last because it is the quietest failure: the
   * pipeline ran, the source answered, and the answer was nothing.
   *
   * Only REQUIRED inputs reach this line. An empty input the derivation merely
   * contributes from does not make the result "no data" — the value is still
   * computable, and calling it no-data would be a bigger lie than the shortfall.
   * That case renders as a caveat via `contributingShortfall`, never silently
   * absorbed.
   *
   * The three loud states above are checked across ALL inputs, unchanged: P1
   * says untraceability propagates unconditionally, and P2/P9 have never been
   * conditioned on requiredness. P3 is the only rule this commit adds.
   */
  const requiredStates = provenance.inputs
    .filter(isRequired)
    .map((input) => factState(input.fact));
  if (requiredStates.includes('nodata')) return 'nodata';

  return 'ok';
}

/**
 * A fetch provenance is only traceable if someone could actually re-run it:
 * a source id we know, a URL to hit, and a timestamp saying when.
 */
function isTraceable(provenance: FetchProvenance): boolean {
  return (
    provenance.sourceId.length > 0 &&
    provenance.requestUrl.length > 0 &&
    provenance.fetchedAt.length > 0
  );
}

/**
 * How precisely a source located something: a country, an admin-1 area, or a point.
 */
export type Resolution = 'country' | 'admin1' | 'point';

export interface ResolutionClaim {
  /** What the popover states. */
  label: string;
  /** Whether the plotted marker is a centroid this app manufactured. */
  centroid: boolean;
  /** True when nothing was declared and the coarsest reading was assumed. */
  assumed: boolean;
}

/**
 * What may honestly be claimed about a coordinate's precision.
 *
 * **A 6-decimal coordinate from a country-level source is a lie told in the
 * units of accuracy.** Rendering a country-level figure at point precision does
 * not merely look overconfident — it tells the reader the source knew something
 * it never knew, in the one notation where readers count the digits.
 *
 * UNDECLARED FAILS CLOSED TO THE COARSEST CLAIM (rule 29's polarity). A source
 * that says nothing about its resolution has not said "point"; defaulting to the
 * finest precision would manufacture exactly the lie above, and would do it
 * silently for every source nobody had got round to annotating. Assuming
 * country-level is wrong in the direction that under-claims, which is
 * recoverable — the marker is visibly a centroid and says so.
 *
 * Exhaustive by construction: a new `Resolution` member breaks this dispatch
 * rather than falling through to a default that would quietly over-claim.
 */
export function resolutionClaim(resolution: Resolution | undefined): ResolutionClaim {
  if (resolution === undefined) {
    return {
      label: 'Resolution not declared; treated as country-level.',
      centroid: true,
      assumed: true,
    };
  }

  switch (resolution) {
    case 'point':
      return { label: 'Point location, as published.', centroid: false, assumed: false };
    case 'admin1':
      return {
        label: "Admin-1 area; the marker is the area's centroid, not the event location.",
        centroid: true,
        assumed: false,
      };
    case 'country':
      return {
        label: 'Country-level; the marker is the country centroid, not a location.',
        centroid: true,
        assumed: false,
      };
    default:
      return assertNever(resolution, 'resolutionClaim');
  }
}

export const TIER_EXPLANATIONS: Record<Tier, string> = {
  OFFICIAL: 'Reported by a government or intergovernmental primary source.',
  ESTIMATE:
    'From a credible third party, but inherently approximate. Different analysts publish different figures.',
  DERIVED:
    'Computed by this app from other data, or extracted from news text. Not reported by any source in this form.',
  UNVERIFIED:
    'Reported, but not corroborated. No second source confirms this and the publisher states no verification. Weaker than an estimate: an estimate is someone credible approximating, this is a claim standing alone.',
};
