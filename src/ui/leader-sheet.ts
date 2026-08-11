import { escapeHtml, factHtml } from '../facts/badge';
import type { Fact } from '../facts/types';
import { loadBio, loadDossier } from '../dossier/provider';
import { resolveLeader, type ResolvedPortrait } from '../dossier/resolve';
import { ageFact } from '../sources/wikidata-dossier';

/**
 * Leader detail sheet, opened by clicking a portrait.
 *
 * Sections the dossier query does not yet supply — career timeline, party
 * history, predecessor and successor, news mentions — render as explicit
 * no-data cards naming the step that will fill them. Leaving them out entirely
 * would hide that they were promised; filling them with plausible text would be
 * exactly the failure this app is built to avoid.
 */

interface Located {
  countryCode: string;
  countryName: string;
  resolved: ResolvedPortrait;
}

/** Find a leader by Wikidata Q-id across the countries that have dossiers. */
function locate(qid: string, codes: readonly string[], nameOf: (code: string) => string): Located | null {
  for (const code of codes) {
    const source = loadDossier(code);
    if (!source) continue;
    const resolution = resolveLeader(code, source.record);
    for (const candidate of [resolution.primary, resolution.secondary]) {
      if (candidate && candidate.person.qid === qid) {
        return { countryCode: code, countryName: nameOf(code), resolved: candidate };
      }
    }
  }
  return null;
}

function pending(title: string, step: string): string {
  return `<section class="sheet-block">
    <h3>${escapeHtml(title)}</h3>
    <p class="sheet-pending"><strong>No data.</strong> This needs a query that is not
    built yet — arriving with ${escapeHtml(step)}. It is listed here rather than hidden
    so the gap is visible.</p>
  </section>`;
}

export function renderLeaderSheet(
  qid: string,
  codes: readonly string[],
  nameOf: (code: string) => string,
  today: Date,
): string {
  const found = locate(qid, codes, nameOf);
  if (!found) {
    return `<div class="sheet-body"><header class="sheet-head">
      <div><div class="sheet-eyebrow">Leader</div><div class="sheet-name">Not found</div></div>
      <button type="button" class="sheet-close" aria-label="Close">✕</button>
    </header>
    <p class="sheet-pending">No leader is currently rendered with the id
    <code>${escapeHtml(qid)}</code>.</p></div>`;
  }

  const { resolved, countryName, countryCode } = found;
  const person = resolved.person;
  const source = loadDossier(countryCode);
  const bio = loadBio(person.name);

  const bioFact: Fact<string> = {
    value: bio ? bio.extract : null,
    asOf: 'current',
    tier: 'OFFICIAL',
    provenance: bio
      ? {
          kind: 'fetch',
          sourceId: 'wikipedia-rest',
          requestUrl: bio.ctx.requestUrl,
          httpStatus: bio.ctx.httpStatus,
          fetchedAt: bio.ctx.fetchedAt,
          cache: bio.ctx.cache,
          raw: { extract: bio.extract, url: bio.url },
          extractedBy: 'REST v1 page summary, .extract',
          fromFixture: true,
        }
      : {
          kind: 'fetch',
          sourceId: 'wikipedia-rest',
          requestUrl: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(person.name)}`,
          httpStatus: 404,
          fetchedAt: '1970-01-01T00:00:00.000Z',
          cache: 'miss',
          raw: { type: 'not_found', detail: 'Page or revision not found.' },
          extractedBy: 'REST v1 page summary — 404, no article',
          fromFixture: true,
        },
    ...(bio
      ? {}
      : { note: 'No English Wikipedia article. The dossier renders without a biography rather than substituting one.' }),
  };

  return `<div class="sheet-body">
    <header class="sheet-head">
      <div>
        <div class="sheet-eyebrow">${escapeHtml(resolved.role)} · ${escapeHtml(countryName)}</div>
        <div class="sheet-name">${escapeHtml(person.name)}</div>
        <div class="sheet-title">${
          resolved.title ? escapeHtml(resolved.title) : '<span class="portrait-missing">office title not recorded</span>'
        }</div>
      </div>
      <button type="button" class="sheet-close" aria-label="Close detail sheet">✕</button>
    </header>

    <section class="sheet-block">
      <h3>Vitals</h3>
      <dl class="inspector-grid">
        <dt>Party</dt><dd>${factHtml(
          {
            value: person.party,
            asOf: 'current',
            tier: 'OFFICIAL',
            provenance: source
              ? {
                  kind: 'fetch',
                  sourceId: 'wikidata-sparql',
                  requestUrl: source.ctx.requestUrl,
                  httpStatus: source.ctx.httpStatus,
                  fetchedAt: source.ctx.fetchedAt,
                  cache: source.ctx.cache,
                  raw: person,
                  extractedBy: 'P102 (member of political party)',
                  fromFixture: true,
                }
              : null,
          } satisfies Fact<string>,
          { hideAsOf: true },
        )}</dd>
        <dt>Age</dt><dd>${
          source ? factHtml(ageFact(person, source.ctx, today), { hideAsOf: true }) : 'no data'
        }</dd>
      </dl>
    </section>

    <section class="sheet-block">
      <h3>Biography</h3>
      ${factHtml(bioFact, { hideAsOf: true })}
      ${bio ? `<a class="sheet-link" href="${escapeHtml(bio.url)}" target="_blank" rel="noreferrer noopener">Read on Wikipedia</a>` : ''}
    </section>

    ${pending('Career timeline', 'the Government tab in step 4')}
    ${pending('Party history', 'the Government tab in step 4')}
    ${pending('Predecessor and successor', 'the Government tab in step 4')}
    ${pending('Recent news mentions', 'the News tab in step 6')}
  </div>`;
}

export function mountLeaderSheet(
  root: HTMLElement,
  codes: readonly string[],
  nameOf: (code: string) => string,
): (qid: string) => void {
  const dialog = document.createElement('div');
  dialog.className = 'sheet';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Leader detail');
  root.appendChild(dialog);

  const close = (): void => {
    dialog.hidden = true;
    dialog.innerHTML = '';
  };

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.sheet-close') || !target.closest('.sheet-body')) close();
  });

  // Same reasoning as the provenance inspector: both Escape handlers live on
  // `document`, so stopping the sibling needs stopImmediatePropagation or the
  // country selection is cleared behind the sheet.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) {
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
    }
  });

  return (qid: string): void => {
    dialog.innerHTML = renderLeaderSheet(qid, codes, nameOf, new Date());
    dialog.hidden = false;
  };
}
