import type { FetchContext } from '../sources/adapter';
import type { Chamber } from '../sources/wikidata-government';

/**
 * The legislature model for step 9.
 *
 * ## What this file exists to keep apart
 *
 * Four different facts about the world can all produce an empty chamber list,
 * and collapsing them is the failure rule 30 names:
 *
 *   1. the country has no legislature by constitutional design
 *   2. it has one and it is currently dissolved or suspended
 *   3. it has one and our source does not record it
 *   4. we never asked
 *
 * The chamber query answers none of these. It returns rows or it does not, and
 * "no rows" is indistinguishable across all four. Saudi Arabia is the measured
 * case: its Wikidata `P194` points at "Government of Saudi Arabia", which
 * reaches no chamber type at any depth, while the Consultative Assembly exists
 * as `Q818708` with 150 recorded seats and nothing links the two. Zero chambers
 * there means "our source's country link is wrong", not "no legislature".
 */

/**
 * Status is seeded, not queried, because no query answers it.
 *
 * `no-elected-legislature` and `appointed-consultative` are deliberately
 * separate from each other and from `sitting`: a body that exists but is
 * appointed is a different fact from a body that does not exist, and both are
 * different from one that exists and is elected.
 */
export type LegislatureStatus =
  | 'sitting'
  | 'dissolved'
  | 'suspended'
  | 'contested'
  | 'appointed-consultative'
  | 'no-elected-legislature'
  | 'unrecorded';

export type ChamberSelection = 'elected' | 'appointed' | 'mixed';

export interface LegislatureProfile {
  status: LegislatureStatus;
  /** Null when the status itself is `unrecorded` — there is nothing to cite. */
  statusSource: { name: string; url: string } | null;
  statusAsOf: string | null;
  statusNote: string | null;
  upperChamberSelection: ChamberSelection | null;
  chambers: Chamber[];
  /**
   * Null when there are no chambers — there was no request to describe.
   *
   * Carried so seat counts render as badged facts with a real provenance chain
   * rather than as bare numbers. A seat count IS a fact from a source; only the
   * derived percentages in a bar are rendering dimensions.
   */
  chambersCtx: FetchContext | null;
  /**
   * The chamber query hit its row cap, so the chamber list is a floor.
   *
   * Carried on the profile rather than computed in the view, because a view
   * that computes it can only compute it from what it received — which is the
   * truncated list, and therefore cannot see the truncation.
   */
  truncated: boolean;
}

/**
 * The sentence a country with no chambers gets, chosen by WHY it has none.
 *
 * This is the register rule 30 defines, applied to a whole panel rather than to
 * a single figure. Each string states what is known and what is not, and none
 * of them says "no legislature" unless that is the recorded fact.
 */
export const NO_CHAMBERS_RECORDED =
  'No chambers are recorded for this country. That is a gap in our source, not a finding that ' +
  'the country has no legislature.';

/**
 * Two sentences, not one, and the split was forced by a browser assertion.
 *
 * A single string said "…no elected legislature. **The body listed below**
 * exercises delegated or advisory authority." Saudi Arabia renders it with
 * **zero chambers below**, because its source's country link points at the
 * government rather than at a legislature — so the sentence promised a body
 * that was not there.
 *
 * A dangling forward reference is a small defect with the same shape as a large
 * one: text asserting something the page does not contain. The self-contained
 * form cannot dangle, so the sentence no longer depends on what renders after
 * it.
 */
export const NO_ELECTED_LEGISLATURE =
  'This country has no elected legislature.';

export const APPOINTED_CONSULTATIVE =
  'This country\'s legislative body is appointed and advisory rather than elected.';

export const LEGISLATURE_DISSOLVED =
  'The legislature is dissolved. Any seat count describes the chamber as constituted, not a ' +
  'sitting membership.';

export const LEGISLATURE_SUSPENDED =
  'The legislature is suspended. Any seat count describes the chamber as constituted; it is ' +
  'not currently sitting.';

export const LEGISLATURE_CONTESTED =
  'Legislative authority is contested. More than one body has claimed it, and a single chamber ' +
  'listing does not settle which one holds it.';

export const NO_PARTY_COMPOSITION =
  'No party composition is recorded for this chamber.';

/**
 * Why the party composition is absent, stated once for the whole panel.
 *
 * MEASURED across GBR, ISL, DEU, NZL, IND, FRA, ESP and SWE: the source records
 * chamber membership through a property that returns committees, libraries and
 * offices rather than parties, and constraining it to real parties returns
 * nothing for every country tried. So this is not a per-country gap that some
 * countries will fill — it is the current state of the source for all of them,
 * and saying so once is more honest than repeating a per-chamber shrug.
 */
export const PARTY_COMPOSITION_UNSOURCED =
  'Party composition is not currently sourced. The reference data records chamber membership in ' +
  'a form that does not distinguish political parties from committees and offices, so no ' +
  'breakdown is shown rather than an unreliable one.';

export function statusSentence(profile: LegislatureProfile): string | null {
  switch (profile.status) {
    case 'dissolved':
      return LEGISLATURE_DISSOLVED;
    case 'suspended':
      return LEGISLATURE_SUSPENDED;
    case 'contested':
      return LEGISLATURE_CONTESTED;
    case 'no-elected-legislature':
      return NO_ELECTED_LEGISLATURE;
    case 'appointed-consultative':
      return APPOINTED_CONSULTATIVE;
    case 'sitting':
      return null;
    case 'unrecorded':
      return null;
  }
}

/**
 * How the chambers are described in one line: "unicameral", "bicameral", or a
 * count when it is neither.
 *
 * **Returns null rather than "unicameral" for an empty list.** A country with
 * no chamber data is not a unicameral country, and the difference is the whole
 * point of this file.
 */
export function cameralDescription(profile: LegislatureProfile): string | null {
  const count = profile.chambers.length;
  if (count === 0) return null;
  if (profile.truncated) return `at least ${count} chambers`;
  if (count === 1) return 'Unicameral';
  if (count === 2) return 'Bicameral';
  return `${count} chambers`;
}

/**
 * Total seats, and whether that total can be trusted as a total.
 *
 * A sum over chambers whose seat counts are partly unknown is not a total, and
 * rendering it as one is the party-bar defect at panel scale. So the shortfall
 * is returned beside the sum and the caller decides what to show.
 */
export function seatTotal(profile: LegislatureProfile): {
  total: number | null;
  chambersWithoutSeats: number;
  complete: boolean;
} {
  if (profile.chambers.length === 0) return { total: null, chambersWithoutSeats: 0, complete: false };

  const missing = profile.chambers.filter((chamber) => chamber.seats === null).length;
  const total = profile.chambers.reduce((sum, chamber) => sum + (chamber.seats ?? 0), 0);

  return {
    // A "total" derived from some of the chambers is not the legislature's
    // size, so it is withheld rather than qualified.
    total: missing === 0 ? total : null,
    chambersWithoutSeats: missing,
    complete: missing === 0 && !profile.truncated,
  };
}
