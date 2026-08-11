/**
 * Confidence tiers. Rendered visually distinct at a glance; ESTIMATE and
 * DERIVED must never be mistakable for OFFICIAL.
 */
export type Tier = 'OFFICIAL' | 'ESTIMATE' | 'DERIVED';

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
export interface DerivedProvenance {
  kind: 'derived';
  /** Module that computed it, e.g. "relations/score.ts". */
  computedBy: string;
  /** The arithmetic, shown verbatim: "+3 +2 = 5". */
  formula: string;
  computedAt: string;
  inputs: Provenance[];
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

export type Provenance =
  | FetchProvenance
  | DerivedProvenance
  | SeedProvenance
  | UnconfiguredProvenance;

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

export type FactState = 'ok' | 'nodata' | 'broken' | 'unconfigured';

/**
 * Resolve what a fact should render as.
 *
 * Ordering matters: brokenness is checked before emptiness, so a fact that is
 * both untraceable and empty still shouts rather than quietly reading "no data".
 */
export function factState(fact: AnyFact): FactState {
  const provenance = fact.provenance;
  if (provenance === null) return 'broken';
  if (provenance.kind === 'unconfigured') return 'unconfigured';
  if (provenance.kind === 'fetch' && !isTraceable(provenance)) return 'broken';
  if (provenance.kind === 'seed' && provenance.sourceUrl.length === 0) return 'broken';
  // A derivation with no recorded inputs cannot be audited, which is exactly
  // the failure the inspector exists to catch.
  if (provenance.kind === 'derived' && provenance.inputs.length === 0) return 'broken';
  if (fact.value === null) return 'nodata';
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

export const TIER_EXPLANATIONS: Record<Tier, string> = {
  OFFICIAL: 'Reported by a government or intergovernmental primary source.',
  ESTIMATE:
    'From a credible third party, but inherently approximate. Different analysts publish different figures.',
  DERIVED:
    'Computed by this app from other data, or extracted from news text. Not reported by any source in this form.',
};
