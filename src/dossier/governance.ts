import elections from '../../data/elections.json';

/**
 * Governance layers — Phase C.4.
 *
 * One of four sources works. The other three were probed 2026-08-16 and each
 * failed differently, which the panel keeps apart for the same reason the
 * humanitarian tab does: three different situations merged into one shrug hides
 * which of them anyone can act on.
 */

export interface GovernanceSource {
  id: string;
  name: string;
  provides: string;
  state: 'available' | 'blocked';
  observed: string;
  /** For a blocked source, what would unblock it. */
  remedy: string | null;
}

export const GOVERNANCE_SOURCES: readonly GovernanceSource[] = [
  {
    id: 'wikidata-elections',
    name: 'Election calendar',
    provides: 'scheduled national and regional elections',
    state: 'available',
    observed: 'HTTP 200 — 75 elections in a two-year window',
    remedy: null,
  },
  {
    id: 'un-voting',
    name: 'UN voting alignment',
    provides: 'how often two states vote together in the General Assembly',
    state: 'blocked',
    observed:
      'The API this app had recorded does not resolve (DNS failure), and the UN Digital ' +
      'Library returns an HTML challenge page rather than data.',
    remedy:
      'Find the real endpoint. THIS ONE IS OURS: the URL was inferred rather than read from ' +
      'documentation — see OPEN-QUESTIONS 27.',
  },
  {
    id: 'civicus',
    name: 'CIVICUS Monitor',
    provides: 'civic space ratings',
    state: 'blocked',
    observed: 'HTTP 404 on the endpoint tried, and no CORS header.',
    remedy: 'Find the documented endpoint; the one tried was a guess, so the 404 is about our guess.',
  },
  {
    id: 'rsf',
    name: 'RSF press freedom index',
    provides: 'annual press-freedom score and rank',
    state: 'blocked',
    observed: 'HTTP 200 but it is a 1.19 MB HTML page, not an API, and it sends no CORS header.',
    remedy:
      'Read the licence before anything else. RSF publishes under terms that forbid derivative ' +
      'works, so this can only ever be DISPLAYED AS-IS — never recomputed, rescaled, averaged ' +
      'into another index, or combined with anything.',
  },
];

/**
 * ## The press-freedom constraint is a licence term, not a design preference
 *
 * Recorded here because it binds whoever builds the panel, not whoever fetches
 * the data: an ND licence permits display and forbids derivation. A score
 * rescaled to this app's palette, averaged across years, or folded into any
 * composite is a derivative work — and the no-composite-scores prohibition
 * happens to forbid the same thing for a different reason.
 */
export const PRESS_FREEDOM_ND_RULE =
  'The press-freedom index is displayed exactly as published — the publisher\'s own score, ' +
  'rank and wording. It is never rescaled, averaged, recombined, or used as an input to any ' +
  'other figure, because its licence forbids derivative works.';

export interface UpcomingElection {
  iso3: string;
  date: string;
  name: string;
}

const CALENDAR = elections as {
  generatedOn: string;
  unlabelledDropped: number;
  elections: UpcomingElection[];
};

/**
 * Elections for a country, soonest first.
 *
 * A date here is **scheduled, not promised**. Elections are postponed, annulled
 * and rescheduled, and nothing in this app tracks whether one happened — so the
 * panel says "scheduled" and dates in the past mean the artefact is stale
 * rather than that an election is overdue.
 */
export function electionsFor(iso3: string): UpcomingElection[] {
  return CALENDAR.elections
    .filter((election) => election.iso3 === iso3)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calendarGeneratedOn(): string {
  return CALENDAR.generatedOn;
}

/** Elections dropped for having no English label. Disclosed, never hidden. */
export function calendarDropped(): number {
  return CALENDAR.unlabelledDropped;
}

export function blockedGovernanceSources(): GovernanceSource[] {
  return GOVERNANCE_SOURCES.filter((source) => source.state === 'blocked');
}
