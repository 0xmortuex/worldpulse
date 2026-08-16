import {
  NO_CHAMBERS_RECORDED,
  NO_PARTY_COMPOSITION,
  PARTY_COMPOSITION_UNSOURCED,
  cameralDescription,
  seatTotal,
  statusSentence,
  type LegislatureProfile,
} from '../dossier/legislature';
import { legislatureFor } from '../dossier/legislature-provider';
import { loadLegislatureLive, type LegislatureLoad } from '../dossier/legislature-live';
import { fetcherFor, type RequestingFetcher } from '../fetch/scenario';
import { escapeHtml, factHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';
import type { Fact } from '../facts/types';
import type { FetchContext } from '../sources/adapter';

/**
 * A seat count is a FACT, not a rendering dimension.
 *
 * It comes from a source, it can be wrong, and it needs a badge and a
 * provenance chain like every other sourced number. `notAFact` is reserved for
 * numbers this app computes about its own rendering — bar widths, pixel
 * offsets — and using it for a seat count would strip the badge off a figure a
 * reader is entitled to interrogate.
 */
function seatFact(value: number | null, ctx: FetchContext, chamberQid: string, raw: unknown): Fact<number> {
  return {
    value,
    asOf: 'current',
    tier: 'OFFICIAL',
    provenance: {
      kind: 'fetch',
      sourceId: 'wikidata-sparql',
      requestUrl: ctx.requestUrl,
      httpStatus: ctx.httpStatus,
      fetchedAt: ctx.fetchedAt,
      cache: ctx.cache,
      raw,
      extractedBy: `P1342 (number of seats) on ${chamberQid}`,
      ...(ctx.fromFixture === undefined ? {} : { fromFixture: ctx.fromFixture }),
    },
    format: (seats: number) => seats.toLocaleString('en'),
  };
}

/**
 * Step 9 — the Legislature tab.
 *
 * ## The ordering is deliberate and is the same argument as the cabinet's
 *
 * Anything that changes what the numbers below it MEAN renders first. A reader
 * who sees "650 seats" and then, further down, "the legislature is dissolved"
 * has already formed the wrong belief. So the order is:
 *
 *   1. status — dissolved, suspended, contested, appointed
 *   2. truncation — the chamber list is a floor
 *   3. the shape — unicameral, bicameral
 *   4. the chambers themselves
 *
 * ## What this tab does NOT do
 *
 * It does not draw a party-composition bar. The reference data records chamber
 * membership through a property that returns committees, libraries and offices
 * rather than parties — measured across eight countries, zero real parties —
 * so the panel states that once and shows nothing rather than something
 * unreliable. See OPEN-QUESTIONS 30 for the sourcing decision.
 */
/**
 * ## The live path, behind a scenario parameter
 *
 * Without `?econ=`, this panel renders from the seed profile exactly as before
 * — the default path has no stub and no async in it. With a scenario, it goes
 * through the generalised harness so the four fetch states are reachable on a
 * second source.
 *
 * The fixture provider stays either way, per 20b: pointed at the live path, the
 * hard-case assertions quietly stop testing the branch they were written for
 * and start testing whatever Wikidata returned that morning — and they keep
 * passing, which is what makes it dangerous.
 */
type LiveState = 'loading' | LegislatureLoad;

const liveLoads = new Map<string, LiveState>();
let rerenderPanel: (() => void) | null = null;
let fetcher: RequestingFetcher | null = null;

/** Test seam: drop cached loads so a scenario can be re-driven. */
export function resetLegislatureLoads(): void {
  liveLoads.clear();
  fetcher = null;
}

export function mountLegislatureTab(rerender: () => void): void {
  rerenderPanel = rerender;
}

function scenarioActive(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('econ') !== null;
}

export function renderLegislatureTab(iso3: string, countryName: string): string {
  if (scenarioActive()) {
    const live = liveLoads.get(iso3);

    if (live === undefined) {
      liveLoads.set(iso3, 'loading');
      fetcher ??= fetcherFor(location.search);
      void loadLegislatureLive(fetcher, iso3).then((load) => {
        liveLoads.set(iso3, load);
        /**
         * Only redraw when this panel is the one on screen.
         *
         * `rerenderPanel` rebuilds the whole dossier. Calling it because a
         * background load finished for a tab nobody is looking at detaches and
         * recreates every element the user is interacting with — a click in
         * flight lands on a button that no longer exists. That is not
         * hypothetical: it aborted a verify run, seventeen detached-element
         * retries against the government tab before timing out at 90s.
         */
        if (document.querySelector('.legislature') === null) return;
        rerenderPanel?.();
      });
    }

    if (live === undefined || live === 'loading') return liveLoadingMarkup(countryName);
    if (live.failure !== null) return liveFailureMarkup(countryName, live.failure.reason);
    if (live.chambers !== null) {
      // The seed profile still supplies status, which no query answers.
      const seeded = legislatureFor(iso3);
      return renderProfile({ ...seeded, chambers: live.chambers, chambersCtx: live.ctx }, countryName);
    }
  }

  return renderProfile(legislatureFor(iso3), countryName);
}

/**
 * A skeleton the size of the loaded panel, because rules 8 and 9 apply to a
 * loading state exactly as they do to a loaded one.
 */
function liveLoadingMarkup(countryName: string): string {
  return `<div class="gov legislature" data-panel-state="loading">
    <section class="gov-block">
      <h3>Legislature</h3>
      <p class="gov-pending" aria-live="polite">Loading chambers for
      ${escapeHtml(countryName)}…</p>
    </section>
  </div>`;
}

/**
 * A FAILED REQUEST IS NOT AN EMPTY LEGISLATURE.
 *
 * The empty-chamber wording says the gap is in our source's coverage. This says
 * the request failed, which is a claim about the request — and it must never
 * borrow the other sentence, because a reader would take a transport failure
 * for a finding about the country.
 */
function liveFailureMarkup(countryName: string, reason: string): string {
  return `<div class="gov legislature" data-panel-state="unavailable">
    <section class="gov-block">
      <h3>Legislature</h3>
      <p class="gov-pending">Could not load chambers for ${escapeHtml(countryName)}
      (${escapeHtml(reason)}). <strong>This is a failed request, not a finding that no
      chambers are recorded.</strong></p>
    </section>
  </div>`;
}

function renderProfile(profile: LegislatureProfile, countryName: string): string {

  return `<div class="gov legislature">
    ${statusBlock(profile, countryName)}
    ${chambersBlock(profile)}
    ${provenanceBlock(profile)}
  </div>`;
}

/* ------------------------------------------------------------------ status */

function statusBlock(profile: LegislatureProfile, countryName: string): string {
  const sentence = statusSentence(profile);
  const shape = cameralDescription(profile);

  /**
   * THE TRUNCATION CAVEAT RENDERS BEFORE THE SHAPE, NOT AFTER IT.
   *
   * "Bicameral" is a claim about how many chambers exist. If the list was cut
   * at a row cap, that claim is one the data cannot support, and a caveat
   * printed underneath it arrives after the reader has already believed it.
   */
  const truncation = profile.truncated
    ? `<p class="gov-caveat gov-caveat--first"><strong>The chamber list is incomplete.</strong>
       The query reached its row limit, so the chambers below are a floor rather than the full
       set, and any total derived from them is a floor too.</p>`
    : '';

  const status = sentence
    ? `<p class="legislature-status">${escapeHtml(sentence)}</p>`
    : '';

  const selection =
    profile.upperChamberSelection === 'appointed'
      ? `<p class="gov-caveat">The upper chamber is appointed rather than elected. Its seat count
         is not comparable with an elected chamber's.</p>`
      : '';

  const heading = shape
    ? `<h3>${escapeHtml(shape)}</h3>`
    : `<h3>Legislature of ${escapeHtml(countryName)}</h3>`;

  return `<section class="gov-block">
    ${truncation}
    ${status}
    ${heading}
    ${selection}
    ${totalRow(profile)}
  </section>`;
}

function totalRow(profile: LegislatureProfile): string {
  const total = seatTotal(profile);
  if (profile.chambers.length === 0) return '';

  if (total.total === null) {
    /**
     * A sum over chambers whose counts are partly unknown is withheld rather
     * than shown with an asterisk. The asterisk version is the party bar's
     * mistake: a number that reads as a total and is not one.
     */
    return `<p class="gov-caveat">No combined seat total is shown.
      ${n(total.chambersWithoutSeats, 'chambers whose seat count is not recorded')} of
      ${n(profile.chambers.length, 'chambers listed for this legislature')} chambers have no
      recorded seat count, so a sum of the rest would not be the size of the legislature.</p>`;
  }

  const label = profile.truncated ? 'Seats, at least' : 'Total seats';
  return `<div class="gov-row"><span class="gov-key">${label}</span>
    <span>${n(total.total, 'sum of the recorded seat counts of every chamber listed')}</span></div>`;
}

/* ---------------------------------------------------------------- chambers */

function chambersBlock(profile: LegislatureProfile): string {
  if (profile.chambers.length === 0) {
    /**
     * Rule 30, in the place it matters most on this panel.
     *
     * "No chambers recorded" says what we know. "No legislature" would be a
     * finding about the country, and it is one this app cannot make from an
     * empty result — Saudi Arabia's zero rows are a broken country link in the
     * source, not an absent parliament.
     */
    return `<section class="gov-block">
      <h3>Chambers</h3>
      <p class="gov-pending">${escapeHtml(NO_CHAMBERS_RECORDED)}</p>
    </section>`;
  }

  const ctx = profile.chambersCtx;
  const rows = profile.chambers
    .map(
      (chamber) => `<div class="chamber">
        <div class="chamber-head">
          <span class="chamber-name">${escapeHtml(chamber.label)}</span>
          ${
            ctx
              ? factHtml(seatFact(chamber.seats, ctx, chamber.qid, chamber), {
                  label: 'Seats',
                  hideAsOf: true,
                })
              : ''
          }
        </div>
        <p class="gov-caveat">${escapeHtml(NO_PARTY_COMPOSITION)}</p>
      </div>`,
    )
    .join('');

  return `<section class="gov-block">
    <h3>Chambers</h3>
    ${rows}
    <p class="gov-caveat">${escapeHtml(PARTY_COMPOSITION_UNSOURCED)}</p>
  </section>`;
}

/* ------------------------------------------------------------- provenance */

function provenanceBlock(profile: LegislatureProfile): string {
  if (!profile.statusSource) {
    return `<section class="gov-block">
      <p class="gov-pending">No status source for this country. Whether its legislature is
      sitting, dissolved or suspended is not recorded here, and the chamber list above does not
      answer it.</p>
    </section>`;
  }

  return `<section class="gov-block legislature-provenance">
    <p class="gov-caveat">Status from
      <a href="${escapeHtml(profile.statusSource.url)}">${escapeHtml(profile.statusSource.name)}</a>,
      as of ${escapeHtml(profile.statusAsOf ?? 'an unrecorded date')}.
      Chamber names and seat counts from Wikidata.</p>
    ${profile.statusNote ? `<p class="gov-caveat">${escapeHtml(profile.statusNote)}</p>` : ''}
  </section>`;
}
