import { escapeHtml, factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import type { Fact } from '../facts/types';
import { loadGovernment } from '../dossier/government-provider';
import { loadDossier } from '../dossier/provider';
import { resolveLeader } from '../dossier/resolve';
import type { FetchContext } from '../sources/adapter';
import {
  partyBreakdownIsComplete,
  termsSince,
  type Cabinet,
  type Chamber,
  type Judiciary,
  type Ministry,
  type Term,
} from '../sources/wikidata-government';

/**
 * Government tab.
 *
 * Sections with no data say so and name the step that will fill them, rather
 * than being omitted. A missing section that was promised is invisible; a
 * section that says "no data, arriving in step N" is a commitment you can hold
 * this build to.
 */

const TIMELINE_YEARS = 25;
/** Rows rendered before the cabinet list collapses behind a toggle. */
const CABINET_PREVIEW = 12;

function n(value: number, reason: string): string {
  return notAFact(value, reason);
}

/** Palette slot for a party segment. Cycles; not data about the party. */
function paletteIndex(index: number): string {
  return notAFact(index % 6, 'palette slot for this party segment, cycling through six colours — a rendering choice, not data about the party');
}

function wikidataFact<T>(
  value: T | null,
  ctx: FetchContext,
  extractedBy: string,
  raw: unknown,
  options: { tier?: Fact<T>['tier']; asOf?: string; note?: string; format?: (value: T) => string } = {},
): Fact<T> {
  return {
    value,
    asOf: options.asOf ?? 'current',
    tier: options.tier ?? 'OFFICIAL',
    provenance: {
      kind: 'fetch',
      sourceId: 'wikidata-sparql',
      requestUrl: ctx.requestUrl,
      httpStatus: ctx.httpStatus,
      fetchedAt: ctx.fetchedAt,
      cache: ctx.cache,
      raw,
      extractedBy,
      ...(ctx.fromFixture === undefined ? {} : { fromFixture: ctx.fromFixture }),
    },
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.format === undefined ? {} : { format: options.format }),
  };
}

function pending(title: string, why: string, step: string): string {
  return `<section class="gov-block">
    <h3>${escapeHtml(title)}</h3>
    <p class="gov-pending"><strong>No data.</strong> ${escapeHtml(why)} Arriving with
    ${escapeHtml(step)}. Listed here rather than hidden so the gap stays visible.</p>
  </section>`;
}

export function renderGovernmentTab(iso3: string, countryName: string, today: Date): string {
  const dossier = loadDossier(iso3);
  const government = loadGovernment(iso3);

  if (!dossier && !government.cabinet && !government.chambers) {
    return `<div class="gov">
      <p class="gov-pending"><strong>No government data for ${escapeHtml(countryName)}.</strong>
      The Wikidata ingest is not connected yet and only a few countries have fixtures.</p>
    </div>`;
  }

  const resolution = dossier ? resolveLeader(iso3, dossier.record) : null;

  return `<div class="gov">
    ${
      resolution && dossier
        ? `<section class="gov-block">
            <h3>System of government</h3>
            <div class="gov-row">
              ${factHtml(
                wikidataFact(dossier.record.formLabel, dossier.ctx, 'P122 (basic form of government)', dossier.record),
                { label: 'Form', hideAsOf: true },
              )}
            </div>
            <div class="gov-note">Leader resolution: ${escapeHtml(resolution.ruleLabel)}</div>
          </section>`
        : ''
    }

    ${cabinetSection(government.cabinet)}
    ${legislatureSection(government.chambers)}
    ${judiciarySection(government.judiciary)}
    ${timelineSection(government.timeline, today)}

    ${pending(
      'Term limits',
      'Wikidata does not record term limits in a queryable form, so this needs a constitutional source.',
      'the risk and stability work in step 10',
    )}
    ${pending(
      'Next scheduled election',
      'Election dates are not reliably in Wikidata.',
      'the elections calendar in step 12',
    )}
  </div>`;
}

/* ------------------------------------------------------------------ cabinet */

/**
 * Exported so the truncation notice can be asserted directly (rule 32).
 *
 * The alternative was reaching it through `renderGovernmentTab`, which loads a
 * country fixture — and no fixture has a truncated cabinet, because truncation
 * happens at the live row cap. A test that cannot construct the state it is
 * checking is a test of the fixture set.
 */
export function cabinetSection(source: { value: Cabinet; ctx: FetchContext } | null): string {
  if (!source) {
    return pending('Cabinet', 'No cabinet fixture for this country.', 'the live Wikidata ingest');
  }

  const cabinet = source.value;

  if (cabinet.ministries.length === 0) {
    return `<section class="gov-block">
      <h3>Cabinet</h3>
      <p class="gov-pending"><strong>No data.</strong> The cabinet query returned no
      positions for this country. That is different from a cabinet with unfilled posts —
      it means Wikidata records no ministries here at all.</p>
    </section>`;
  }

  const total = cabinet.ministries.length;
  const collapsed = total > CABINET_PREVIEW;

  const caveats: string[] = [];

  /**
   * TRUNCATION FIRST, because it changes what every number below it means.
   *
   * The vacancy and untranslated caveats are counts *of the rows we have*. If
   * the response was cut off at the row cap, those denominators describe a
   * partial list, and a reader who takes "3 of 47 posts are vacant" at face
   * value has been told something false about a cabinet that may have 80.
   *
   * Measured: the United Kingdom returns exactly 300 rows against `LIMIT 300`.
   * The count shown is a floor, not a total, and this says so before any other
   * figure is read.
   */
  if (cabinet.truncated) {
    caveats.push(
      'This list is INCOMPLETE. The query returned the maximum number of rows it asks for, so ' +
        'this cabinet has at least this many posts and probably more — the true number is not ' +
        'known here. Every count below describes the posts shown, not the cabinet.',
    );
  }

  if (cabinet.vacantCount > 0) {
    caveats.push(
      `${n(cabinet.vacantCount, 'count of positions rendered below with no officeholder; each row shows its own state')} of ` +
        `${n(total, 'count of ministry rows rendered below')} positions have no current officeholder recorded. ` +
        'That may mean the post is vacant, or simply that Wikidata does not have it.',
    );
  }
  if (cabinet.untranslatedCount > 0) {
    caveats.push(
      `${n(cabinet.untranslatedCount, 'count of ministry rows whose label came back as a bare Q-id')} portfolios have no ` +
        'English label in Wikidata and are shown by their identifier. They are not translated here, because a guessed ' +
        'portfolio name is worse than an untranslated one.',
    );
  }

  const rows = cabinet.ministries
    .map((ministry, index) => ministryRow(ministry, source.ctx, index >= CABINET_PREVIEW && collapsed))
    .join('');

  return `<section class="gov-block">
    <h3>Cabinet <span class="gov-count">${
      /**
       * The heading count carries the qualifier too.
       *
       * A caveat paragraph below a bare "300 posts" is a correction someone has
       * to read to be corrected by. "at least 300 posts" is right on its own,
       * and the two together are not redundant: the heading is what gets
       * skimmed, and the paragraph is what explains it.
       */
      cabinet.truncated
        ? `at least ${n(total, 'count of ministry rows rendered below; the response was truncated at the row cap, so this is a floor')} posts`
        : `${n(total, 'count of ministry rows rendered immediately below')} posts`
    }</span></h3>
    ${caveats.map((caveat) => `<p class="gov-caveat">${caveat}</p>`).join('')}
    <ul class="ministry-list">${rows}</ul>
    ${
      collapsed
        ? `<button type="button" class="gov-toggle" data-expand="cabinet">
             Show all ${n(total, 'count of ministry rows in this cabinet')} posts
           </button>`
        : ''
    }
  </section>`;
}

function ministryRow(ministry: Ministry, ctx: FetchContext, hidden: boolean): string {
  const holderFact = wikidataFact(
    ministry.holder?.name ?? null,
    ctx,
    `P1308 (officeholder) on ${ministry.positionQid}`,
    ministry,
    {
      ...(ministry.holder === null
        ? { note: 'No current officeholder recorded. The post may be vacant, or simply unrecorded.' }
        : {}),
    },
  );

  const gloss = ministry.description
    ? `<div class="ministry-gloss">${escapeHtml(ministry.description)}</div>`
    : `<div class="ministry-gloss ministry-gloss--missing">No plain-English description in Wikidata.
       None is written here — a guessed remit would read as fact.</div>`;

  return `<li class="ministry${hidden ? ' ministry--hidden' : ''}">
    <div class="ministry-head">
      <span class="ministry-label${ministry.untranslated ? ' ministry-label--untranslated' : ''}">
        ${escapeHtml(ministry.label)}${
          ministry.untranslated ? ' <span class="tag tag--warn">no English label</span>' : ''
        }
      </span>
      <span class="ministry-holder">${factHtml(holderFact, { hideAsOf: true, compact: true })}</span>
    </div>
    ${gloss}
  </li>`;
}

/* -------------------------------------------------------------- legislature */

function legislatureSection(source: { value: Chamber[]; ctx: FetchContext } | null): string {
  if (!source || source.value.length === 0) {
    return pending('Legislature', 'No legislature fixture for this country.', 'the live Wikidata ingest');
  }

  const chambers = source.value
    .map((chamber) => {
      const seats = factHtml(
        wikidataFact(chamber.seats, source.ctx, `P1342 (number of seats) on ${chamber.qid}`, chamber, {
          format: (value: number) => value.toLocaleString('en'),
        }),
        { label: 'Seats', hideAsOf: true },
      );

      const complete = partyBreakdownIsComplete(chamber);
      const recorded = chamber.parties.reduce((sum, party) => sum + (party.seats ?? 0), 0);

      const breakdown = complete
        ? partyBar(chamber)
        : `<p class="gov-caveat">No party breakdown drawn.
           ${
             chamber.parties.length === 0
               ? 'Wikidata records no party composition for this chamber.'
               : `Only ${n(recorded, 'sum of party seat counts actually recorded for this chamber')} of ` +
                 `${n(chamber.seats ?? 0, 'total seats recorded for this chamber')} seats are accounted for. ` +
                 'A stacked bar drawn from partial data reads as a complete picture of a legislature.'
           }</p>`;

      return `<div class="chamber">
        <div class="chamber-head">
          <span class="chamber-name">${escapeHtml(chamber.label)}</span>
          ${seats}
        </div>
        ${breakdown}
      </div>`;
    })
    .join('');

  return `<section class="gov-block"><h3>Legislature</h3>${chambers}</section>`;
}

function partyBar(chamber: Chamber): string {
  const total = chamber.seats ?? 1;
  const segments = chamber.parties
    .map((party, index) => {
      const share = ((party.seats ?? 0) / total) * 100;
      return `<span class="party-seg party-seg--${paletteIndex(index)}"
        style="width:${n(Math.round(share * 100) / 100, 'percentage width of this segment, a rendering dimension derived from the badged seat counts listed beside it')}%"
        title="${escapeHtml(party.name)}"></span>`;
    })
    .join('');

  const legend = chamber.parties
    .map(
      (party, index) => `<li>
        <span class="party-swatch party-seg--${paletteIndex(index)}"></span>
        <span class="party-name">${escapeHtml(party.name)}</span>
        <span class="party-seats">${n(party.seats ?? 0, 'seat count for this party, sourced from the same chamber statement as the badged total above')}</span>
      </li>`,
    )
    .join('');

  return `<div class="party-bar" role="img"
      aria-label="Party composition of ${escapeHtml(chamber.label)}">${segments}</div>
    <ul class="party-legend">${legend}</ul>`;
}

/* ---------------------------------------------------------------- judiciary */

function judiciarySection(source: { value: Judiciary | null; ctx: FetchContext } | null): string {
  if (!source || !source.value) {
    return pending('Judiciary', 'No court fixture for this country.', 'the live Wikidata ingest');
  }
  const court = source.value;

  return `<section class="gov-block">
    <h3>Judiciary</h3>
    <div class="gov-row"><span class="gov-key">Court</span>
      <span>${escapeHtml(court.label)}</span></div>
    <div class="gov-row"><span class="gov-key">Seats</span>
      ${factHtml(wikidataFact(court.seats, source.ctx, `P1342 on ${court.qid}`, court), { hideAsOf: true })}</div>
    <div class="gov-row"><span class="gov-key">Chief justice</span>
      ${factHtml(wikidataFact(court.chiefJustice?.name ?? null, source.ctx, `P1308 on ${court.qid}`, court), {
        hideAsOf: true,
      })}</div>
    <p class="gov-caveat">Appointment mechanism is not recorded in Wikidata in a
    queryable form. It is left blank rather than summarised from memory.</p>
  </section>`;
}

/* ----------------------------------------------------------------- timeline */

function timelineSection(source: { value: Term[]; ctx: FetchContext } | null, today: Date): string {
  if (!source || source.value.length === 0) {
    return pending('Leadership timeline', 'No timeline fixture for this country.', 'the live Wikidata ingest');
  }

  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - TIMELINE_YEARS, today.getUTCMonth(), today.getUTCDate()));
  const terms = termsSince(source.value, cutoff);

  const rows = terms
    .map((term) => {
      const undated = term.start === null;
      return `<li class="term${undated ? ' term--undated' : ''}">
        <span class="term-dates">${
          undated
            ? '<span class="portrait-missing">dates not recorded</span>'
            : `${escapeHtml(term.start?.slice(0, 10) ?? '')} → ${
                term.end ? escapeHtml(term.end.slice(0, 10)) : '<span class="term-current">present</span>'
              }`
        }</span>
        <span class="term-person">${escapeHtml(term.personName)}</span>
        <span class="term-office">${term.office === 'head-of-state' ? 'head of state' : 'head of government'}</span>
      </li>`;
    })
    .join('');

  return `<section class="gov-block">
    <h3>Leadership, last ${n(TIMELINE_YEARS, 'length of the display window in years, a UI setting rather than data')} years</h3>
    <ul class="term-list">${rows}</ul>
    <p class="gov-caveat">Terms with no recorded dates are kept and shown last. They
    cannot be placed on the timeline, and dropping them would hide a term on a guess.</p>
  </section>`;
}

/** Expand/collapse for long cabinets. */
export function mountGovernmentTab(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('[data-expand="cabinet"]');
    if (!toggle) return;
    event.stopPropagation();
    const section = toggle.closest('.gov-block');
    section?.querySelectorAll('.ministry--hidden').forEach((row) => row.classList.remove('ministry--hidden'));
    toggle.remove();
  });
}
