import type { Country } from '../countries';
import { escapeHtml, factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import type { Fact } from '../facts/types';
import { resolvePortrait, type Portrait } from '../dossier/portrait';
import { loadAttribution, loadBio, loadDossier } from '../dossier/provider';
import { resolveLeader, type LeaderResolution, type ResolvedPortrait } from '../dossier/resolve';
import {
  ageFact,
  capitalFact,
  officialNameFact,
  populationFact,
  type PersonRecord,
} from '../sources/wikidata-dossier';
import type { FetchContext } from '../sources/adapter';

/**
 * The dossier header: flag, vitals, and the leader portrait chosen by the
 * five-rule resolution order.
 *
 * The rule that fired is always displayed. A header that shows a face without
 * saying why that face was chosen is making an editorial judgement invisibly,
 * and "who leads this country" is exactly the kind of judgement that deserves
 * to be arguable.
 */

const PORTRAIT_PX = 96;
const SECONDARY_PX = 56;

/**
 * A CSS pixel dimension on its way into markup.
 *
 * The fact-discipline rule correctly flags these — they are numbers reaching the
 * DOM — and it is right to keep flagging them rather than carving out an
 * exemption for style attributes, which would leave a hole a real fact could
 * slip through. Declaring the reason once here keeps the audit trail without
 * seven throwaway repetitions.
 */
function px(value: number): string {
  return notAFact(value, 'CSS pixel dimension for a portrait frame — a layout constant, not data about the world');
}

export function renderDossierHeader(country: Country, today: Date): string {
  const source = loadDossier(country.code);

  if (!source) {
    return `<header class="dossier">
      <div class="dossier-main">
        ${flagPlaceholder(country)}
        <div class="dossier-titles">
          <h2>${escapeHtml(country.name)}</h2>
          <div class="dossier-code">${escapeHtml(country.code)}</div>
          <p class="dossier-nodata">No dossier data for this country. The Wikidata
          ingest is not connected yet, and only a few countries have fixtures.</p>
        </div>
      </div>
    </header>`;
  }

  const { record, ctx } = source;
  const resolution = resolveLeader(country.code, record);

  return `<header class="dossier">
    <div class="dossier-main">
      ${flagPlaceholder(country)}
      <div class="dossier-titles">
        <h2>${escapeHtml(country.name)}</h2>
        <div class="dossier-official">${factHtml(officialNameFact(record, ctx), { hideAsOf: true })}</div>
        <dl class="dossier-vitals">
          <dt>Capital</dt><dd>${factHtml(capitalFact(record, ctx), { hideAsOf: true })}</dd>
          <dt>Population</dt><dd>${factHtml(populationFact(record, ctx), { hideAsOf: true })}</dd>
        </dl>
      </div>
    </div>
    ${portraitBlock(resolution, ctx, today)}
    ${ruleBlock(resolution)}
  </header>`;
}

function flagPlaceholder(country: Country): string {
  // The real flag comes from Wikidata P41, which cannot be fetched here. The
  // placeholder shows the code rather than a generic banner, so nobody mistakes
  // it for a flag we failed to identify.
  return `<div class="dossier-flag" role="img"
    aria-label="Flag not loaded for ${escapeHtml(country.name)}">
    <span>${escapeHtml(country.code)}</span>
  </div>`;
}

function portraitBlock(resolution: LeaderResolution, ctx: FetchContext, today: Date): string {
  if (!resolution.primary) {
    return `<div class="dossier-portraits">
      <div class="portrait portrait--empty">
        <div class="portrait-frame portrait-frame--placeholder"><span>—</span></div>
        <div class="portrait-caption">No leader recorded</div>
      </div>
    </div>`;
  }

  const primary = portraitFigure(resolution.primary, ctx, today, PORTRAIT_PX, true);
  const secondary = resolution.secondary
    ? portraitFigure(resolution.secondary, ctx, today, SECONDARY_PX, false)
    : '';

  return `<div class="dossier-portraits">${primary}${secondary}</div>`;
}

function portraitFigure(
  resolved: ResolvedPortrait,
  ctx: FetchContext,
  today: Date,
  size: number,
  isPrimary: boolean,
): string {
  const person = resolved.person;
  const bio = loadBio(person.name);
  const portrait = resolvePortrait(person.name, person.imageUrl, bio ? wikipediaThumb() : null, size * 2);
  const attribution = loadAttribution(portrait.fileTitle);

  const creditTitle = attribution
    ? `${attribution.licenseShortName ?? 'licence unknown'}${attribution.artist ? ` — ${attribution.artist}` : ''}`
    : portrait.origin === 'placeholder'
      ? 'No photograph available. Initials placeholder — never a substitute image.'
      : 'Licence and credit not loaded.';

  return `<figure class="portrait ${isPrimary ? 'portrait--primary' : 'portrait--secondary'}"
      data-leader="${escapeHtml(person.qid)}" tabindex="0" role="button"
      aria-label="Open detail sheet for ${escapeHtml(person.name)}">
    ${portraitFrame(portrait, size, creditTitle)}
    <figcaption class="portrait-caption">
      <div class="portrait-role">${escapeHtml(resolved.role)}</div>
      <div class="portrait-name">${escapeHtml(person.name)}</div>
      <div class="portrait-title">${
        resolved.title
          ? escapeHtml(resolved.title)
          : '<span class="portrait-missing">office title not recorded</span>'
      }</div>
      ${isPrimary ? personVitals(person, ctx, today) : ''}
      ${
        attribution?.creditRequired && attribution.artist
          ? `<div class="portrait-credit">© ${escapeHtml(attribution.artist)}${
              attribution.licenseShortName ? ` · ${escapeHtml(attribution.licenseShortName)}` : ''
            }</div>`
          : ''
      }
    </figcaption>
  </figure>`;
}

function wikipediaThumb(): string | null {
  // The REST summary thumbnail is only used when P18 is absent; the fixture's
  // URL is not fetchable here, so the placeholder path takes over on error.
  return null;
}

function portraitFrame(portrait: Portrait, size: number, creditTitle: string): string {
  const placeholder = `<div class="portrait-frame portrait-frame--placeholder"
      style="width:${px(size)}px;height:${px(size)}px" title="${escapeHtml(creditTitle)}">
      <span>${escapeHtml(portrait.initials)}</span>
    </div>`;

  if (!portrait.url) return placeholder;

  // The placeholder sits underneath. A failed image is removed by the error
  // handler in mountDossierHeader, revealing it — so a broken URL degrades to
  // initials rather than to a broken-image icon or, worse, a blank frame that
  // looks like a person we could not name.
  return `<div class="portrait-stack" style="width:${px(size)}px;height:${px(size)}px">
    ${placeholder}
    <img class="portrait-img" src="${escapeHtml(portrait.url)}" width="${px(size)}" height="${px(size)}"
      loading="lazy" decoding="async" alt="${escapeHtml(portrait.initials)}"
      title="${escapeHtml(creditTitle)}" />
  </div>`;
}

function personVitals(person: PersonRecord, ctx: FetchContext, today: Date): string {
  const party: Fact<string> = {
    value: person.party,
    asOf: 'current',
    tier: 'OFFICIAL',
    provenance: {
      kind: 'fetch',
      sourceId: 'wikidata-sparql',
      requestUrl: ctx.requestUrl,
      httpStatus: ctx.httpStatus,
      fetchedAt: ctx.fetchedAt,
      cache: ctx.cache,
      raw: person,
      extractedBy: 'P102 (member of political party)',
      ...(ctx.fromFixture === undefined ? {} : { fromFixture: ctx.fromFixture }),
    },
  };

  const since: Fact<string> = {
    value: person.inOfficeSince ? person.inOfficeSince.slice(0, 10) : null,
    asOf: 'current',
    tier: 'OFFICIAL',
    provenance: {
      kind: 'fetch',
      sourceId: 'wikidata-sparql',
      requestUrl: ctx.requestUrl,
      httpStatus: ctx.httpStatus,
      fetchedAt: ctx.fetchedAt,
      cache: ctx.cache,
      raw: person,
      extractedBy: 'P580 (start time) qualifier on the office statement',
      ...(ctx.fromFixture === undefined ? {} : { fromFixture: ctx.fromFixture }),
    },
  };

  return `<dl class="portrait-vitals">
    <dt>Party</dt><dd>${factHtml(party, { hideAsOf: true, compact: true })}</dd>
    <dt>In office since</dt><dd>${factHtml(since, { hideAsOf: true, compact: true })}</dd>
    <dt>Age</dt><dd>${factHtml(ageFact(person, ctx, today), { hideAsOf: true, compact: true })}</dd>
  </dl>`;
}

function ruleBlock(resolution: LeaderResolution): string {
  const warnings = resolution.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join('');

  const override = resolution.override
    ? `<div class="rule-override">
        <strong>Reviewed override.</strong> ${escapeHtml(resolution.override.reason)}
        <a href="${escapeHtml(resolution.override.sourceUrl)}" target="_blank" rel="noreferrer noopener"
          >${escapeHtml(resolution.override.source)}</a>
        · reviewed ${escapeHtml(resolution.override.reviewedAt)}
      </div>`
    : '';

  return `<div class="rule-block" data-rule="${notAFact(resolution.ruleNumber, 'internal rule identifier used only as a CSS styling hook; the classification itself is rendered as a badged DERIVED value beside it')}">
    <div class="rule-line">
      <span class="rule-chip">${escapeHtml(resolution.ruleLabel)}</span>
      <span class="badge badge--derived" title="Which office leads is a judgement this app makes from the recorded form of government, not something any source states.">ƒ DERIVED</span>
    </div>
    <div class="rule-reason">${escapeHtml(resolution.ruleReason)}</div>
    ${override}
    ${warnings ? `<ul class="rule-warnings">${warnings}</ul>` : ''}
  </div>`;
}

/** Compact portrait for a compare column. */
export function comparePortrait(country: Country, today: Date): string {
  const source = loadDossier(country.code);
  if (!source) return '<div class="compare-portrait compare-portrait--empty">no data</div>';
  const resolution = resolveLeader(country.code, source.record);
  if (!resolution.primary) return '<div class="compare-portrait compare-portrait--empty">no leader</div>';
  return `<div class="compare-portrait">${portraitFigure(resolution.primary, source.ctx, today, 48, false)}</div>`;
}

/**
 * Wires portrait interactions: failed images fall back to initials, and
 * clicking or keyboard-activating a portrait opens the leader detail sheet.
 */
export function mountDossierHeader(root: HTMLElement, openSheet: (qid: string) => void): void {
  // Capture phase: image errors do not bubble.
  root.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLImageElement && target.classList.contains('portrait-img')) target.remove();
    },
    true,
  );

  root.addEventListener('click', (event) => {
    const figure = (event.target as HTMLElement).closest<HTMLElement>('[data-leader]');
    const qid = figure?.dataset['leader'];
    if (qid) {
      event.stopPropagation();
      openSheet(qid);
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const figure = (event.target as HTMLElement).closest<HTMLElement>('[data-leader]');
    const qid = figure?.dataset['leader'];
    if (qid) {
      event.preventDefault();
      openSheet(qid);
    }
  });
}

/** Count of countries with dossier fixtures, for the coverage note. */
export function fixtureCoverageNote(total: number, covered: number): string {
  return `Dossier fixtures cover ${notAFact(covered, 'count of fixture files present in the repository, a property of this build rather than of the world')} of ${notAFact(total, 'number of countries rendered on the globe')} countries.`;
}
