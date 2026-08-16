import probeResults from '../../data/probe-results.json';
import registry from '../../data/sources.json';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * The freshness monitor — Phase C.5.
 *
 * ## Generated from the registry, never hand-maintained
 *
 * A monitor someone has to update by hand is one that silently stops covering
 * things. This reads `sources.json` and `probe-results.json`, so a source added
 * to the registry appears here automatically — and a source that has never been
 * probed appears as exactly that, rather than being absent.
 *
 * **Absence is the failure mode this design exists to remove.** A hand-written
 * monitor's most likely defect is a source it never knew about, which looks
 * identical to a source with nothing wrong.
 */

interface RegistrySource {
  id: string;
  name: string;
  panel?: string;
  cadence?: string;
  ttlMs?: number;
  verifiedAgainst?: string;
  excluded?: boolean;
}

interface ProbeRow {
  id: string;
  probedAt?: string;
  verdict?: string;
  get?: { status?: number };
}

const SOURCES = (registry as { sources: RegistrySource[] }).sources;
const PROBES = (probeResults as { results?: ProbeRow[] } | ProbeRow[]);
const PROBE_ROWS: ProbeRow[] = Array.isArray(PROBES) ? PROBES : (PROBES.results ?? []);

export type FreshnessState = 'fresh' | 'stale' | 'never-probed' | 'excluded';

export interface FreshnessRow {
  id: string;
  name: string;
  state: FreshnessState;
  /** Days since the last probe, or null when there has never been one. */
  ageDays: number | null;
  verdict: string | null;
}

/**
 * How old a probe may be before it stops describing the source.
 *
 * Not a guess: this project has already had a registry entry point at a
 * decommissioned API (ReliefWeb v1, HTTP 410) and two entries whose URLs were
 * inferred and 404. Thirty days is short enough to catch that class while a
 * human still remembers the source, and long enough not to cry weekly.
 */
export const PROBE_STALE_AFTER_DAYS = 30;

export function freshnessRows(now: Date): FreshnessRow[] {
  const byId = new Map(PROBE_ROWS.map((row) => [row.id, row]));

  return SOURCES.map((source) => {
    const probe = byId.get(source.id);

    /**
     * An excluded source is not stale — it is deliberately not in use, and
     * flagging it would train a reader to ignore the column that matters.
     */
    if (source.excluded === true) {
      return { id: source.id, name: source.name, state: 'excluded' as const, ageDays: null, verdict: null };
    }

    if (!probe?.probedAt) {
      /**
       * NEVER PROBED is its own state, not a very old one. "We have never
       * checked" and "we checked long ago" are different facts, and only the
       * first means nobody has ever seen this source answer.
       */
      return { id: source.id, name: source.name, state: 'never-probed' as const, ageDays: null, verdict: null };
    }

    const ageDays = Math.floor((now.getTime() - Date.parse(probe.probedAt)) / 86_400_000);
    return {
      id: source.id,
      name: source.name,
      state: ageDays > PROBE_STALE_AFTER_DAYS ? ('stale' as const) : ('fresh' as const),
      ageDays,
      verdict: probe.verdict ?? null,
    };
  }).sort((a, b) => (b.ageDays ?? Number.MAX_SAFE_INTEGER) - (a.ageDays ?? Number.MAX_SAFE_INTEGER));
}

export function renderFreshness(now: Date): string {
  const rows = freshnessRows(now);
  const counts = {
    fresh: rows.filter((row) => row.state === 'fresh').length,
    stale: rows.filter((row) => row.state === 'stale').length,
    never: rows.filter((row) => row.state === 'never-probed').length,
    excluded: rows.filter((row) => row.state === 'excluded').length,
  };

  return `<section class="gov-block freshness">
    <h3>Source freshness</h3>
    <p class="gov-caveat">Generated from the registry, so a source added there appears here
    without anyone remembering to add it. A probe older than
    ${n(PROBE_STALE_AFTER_DAYS, 'days after which a probe stops describing the source — a policy of this app')}
    days is marked stale: this project has already had a registry entry pointing at a
    decommissioned API.</p>

    <ul class="freshness-list">
      ${rows
        .map(
          (row) => `<li class="freshness-row freshness-row--${row.state}">
            <span class="freshness-name">${escapeHtml(row.name)}</span>
            <span class="freshness-state">${escapeHtml(stateLabel(row))}</span>
          </li>`,
        )
        .join('')}
    </ul>

    <p class="gov-caveat">
      ${n(counts.fresh, 'sources whose last probe is within the stale threshold')} fresh,
      ${n(counts.stale, 'sources whose last probe is older than the threshold')} stale,
      ${n(counts.never, 'sources that have never been probed at all')} never probed,
      ${n(counts.excluded, 'sources deliberately excluded from use, which are not stale')} excluded.
    </p>
  </section>`;
}

function stateLabel(row: FreshnessRow): string {
  switch (row.state) {
    case 'excluded':
      return 'excluded — not in use';
    case 'never-probed':
      return 'never probed';
    case 'stale':
      return `last probed ${row.ageDays} days ago`;
    case 'fresh':
      return `probed ${row.ageDays} days ago${row.verdict ? ` · ${row.verdict}` : ''}`;
  }
}
