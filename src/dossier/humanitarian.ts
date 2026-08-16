/**
 * The humanitarian dossier tab — Phase C.3.
 *
 * ## Every source is blocked, and each is blocked differently
 *
 * Probed 2026-08-16. All four answered, and none answered with data:
 *
 * ```
 * ReliefWeb v1   410  "The API version 'v1' has been decommissioned"
 * ReliefWeb v2   403  "You are not using an approved appname"
 * HAPI           429  "Blocked due to bot activity ... contact hdx@un.org"
 * IPC            401  "API key required"
 * IOM DTM        404  "Resource not found"
 * ```
 *
 * **These are four different facts and the panel says which is which.** A tab
 * that rendered "no humanitarian data" over all of them would merge a
 * decommissioned endpoint, a missing identifier, a bot block, a missing
 * credential and a wrong URL into one shrug — and three of those are things
 * *we* can fix, while one is a fact about our own guess.
 *
 * That distinction is the entire reason this panel exists before its data does.
 */

export type BlockerKind =
  | 'needs-identifier'
  | 'needs-credential'
  | 'rate-limited'
  | 'endpoint-unknown';

export interface HumanitarianSource {
  id: string;
  name: string;
  /** What this source would contribute, so a reader knows what is missing. */
  provides: string;
  blocker: BlockerKind | null;
  /** The response actually observed, quoted. Not a summary of it. */
  observed: string;
  /** What would unblock it — an action, not a hope. */
  remedy: string;
}

export const HUMANITARIAN_SOURCES: readonly HumanitarianSource[] = [
  {
    id: 'reliefweb',
    name: 'ReliefWeb',
    provides: 'situation reports and disaster records',
    blocker: 'needs-identifier',
    observed: 'HTTP 403 — "You are not using an approved appname"',
    remedy:
      'Request an approved appname from ReliefWeb. It is an identifier rather than a secret: it ' +
      'names the calling application so they can contact its operator, and it travels in the clear.',
  },
  {
    id: 'hapi',
    name: 'HDX HAPI',
    provides: 'food security, population and operational presence',
    blocker: 'rate-limited',
    observed: 'HTTP 429 — "Blocked due to bot activity"',
    remedy: 'Contact hdx@un.org, which is what the response itself asks a human to do.',
  },
  {
    id: 'ipc',
    name: 'IPC / FEWS NET',
    provides: 'food insecurity phase classification',
    blocker: 'needs-credential',
    observed: 'HTTP 401 — "API key required"',
    remedy: 'Obtain an IPC API key.',
  },
  {
    id: 'iom-dtm',
    name: 'IOM DTM',
    provides: 'displacement tracking',
    blocker: 'endpoint-unknown',
    observed: 'HTTP 404 — "Resource not found"',
    remedy:
      'Find the real endpoint. THIS ONE IS OURS: the URL was inferred rather than read from ' +
      'documentation, so the 404 is a fact about our guess, not about IOM. See OPEN-QUESTIONS 27.',
  },
];

/**
 * The sentence the panel leads with.
 *
 * It must not say "no humanitarian data for this country", which is a claim
 * about the country. Every one of these blockers is a fact about this app's
 * access, and three of the four have a named remedy someone can act on.
 */
export const HUMANITARIAN_GAP =
  'No humanitarian data is connected yet. Every source below answered — none answered with ' +
  'data — and each is blocked for a different, stated reason. That is a gap in this app\'s ' +
  'access, not a finding about this country.';

/** How many sources are blocked by something WE control rather than they do. */
export function oursToFix(sources: readonly HumanitarianSource[] = HUMANITARIAN_SOURCES): number {
  return sources.filter((source) => source.blocker === 'endpoint-unknown').length;
}

export function blockedCount(sources: readonly HumanitarianSource[] = HUMANITARIAN_SOURCES): number {
  return sources.filter((source) => source.blocker !== null).length;
}
