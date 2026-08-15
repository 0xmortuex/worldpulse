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
export function renderLegislatureTab(iso3: string, countryName: string): string {
  const profile = legislatureFor(iso3);

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
