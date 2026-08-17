import registry from '../../data/sources.json';
import watchlist from '../../data/watchlist.json';
import { loadCountries } from '../countries';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';
import { clusterEvents, type GlobeEvent } from '../layers/events';
import { colorFor, loadEvents } from '../layers/provider';

/**
 * Universal list views — v2 section 1.2.
 *
 * ## An equal surface, not a fallback
 *
 * Every collection this app renders visually must also exist as a clear,
 * complete, browsable list. This is B6's accessibility parallel-table
 * requirement promoted to a first-class feature, reachable from an obvious
 * place rather than tucked behind a preference.
 *
 * **A framing note that changed under us.** These lists were specified partly
 * as L9's standing mitigation — the globe's marker click failed on real
 * hardware, so the list was the only working route. L9 is now
 * RESOLVED-BY-CAUSE-REMOVAL, so **they are no longer load-bearing for that
 * defect**, and nothing here says they are. Shipping copy that describes a
 * fixed bug is the doc-versus-tree class pointed at users.
 *
 * They earn their place on their own merits: a sphere is a poor way to find a
 * specific thing, and a list is keyboard-complete by construction.
 */

/**
 * Re-exported from `lists-registry.ts`, which holds the declaration alone so the
 * palette can read it without dragging these renderers into the entry chunk.
 * Existing importers keep working; nothing here is a second copy.
 *
 * Imported as well as re-exported because a bare `export … from` does not bring
 * the names into this module's own scope, and the renderers below use both.
 */
export { LISTS, type ListId } from './lists-registry';
import { LISTS, type ListId } from './lists-registry';

interface SourceRow {
  id: string;
  name: string;
  panel?: string;
  licenseClass?: string;
  verifiedAgainst?: string;
  excluded?: boolean;
}

const SOURCES = (registry as { sources: SourceRow[] }).sources;

/**
 * Deep links use the same query parameter the URL state already reads, so a row
 * link and a shared view are the same mechanism rather than two that can
 * disagree.
 */
function countryHref(iso3: string): string {
  return `?c=${encodeURIComponent(iso3)}`;
}

export function renderList(id: ListId, now: Date): string {
  switch (id) {
    case 'events':
      return eventsList(now);
    case 'countries':
      return countriesList();
    case 'sources':
      return sourcesList();
    case 'watchlist':
      return watchlistList();
  }
}

function eventsList(now: Date): string {
  const clusters = clusterEvents(loadEvents(now));
  if (clusters.length === 0) {
    return '<p class="list-empty">No events are loaded. That is a statement about the layers, not about the world.</p>';
  }

  const rows = clusters
    .map((cluster) => {
      const event: GlobeEvent = cluster.representative;
      const extra = cluster.members.length > 1 ? ` +${n(cluster.members.length - 1, 'other events sharing this marker, a property of this app\'s clustering')}` : '';
      return `<tr>
        <td><span class="list-swatch" style="background:${colorFor(event.layer)}"></span>
          ${escapeHtml(event.layer)}</td>
        <td>${escapeHtml(event.title)}${extra}</td>
        <td>${escapeHtml(event.time.slice(0, 10))}</td>
        <td>${event.stale ? '<span class="list-stale">stale</span>' : ''}</td>
      </tr>`;
    })
    .join('');

  return table(['Layer', 'Event', 'Reported', ''], rows, `${clusters.length} markers`);
}

function countriesList(): string {
  const countries = loadCountries();
  const rows = countries
    .map(
      (country) => `<tr>
        <td><a href="${countryHref(country.code)}">${escapeHtml(country.name)}</a></td>
        <td><code>${escapeHtml(country.code)}</code></td>
        <td>${country.codeStatus === 'user-assigned' ? '<span class="tag tag--warn">non-ISO</span>' : ''}</td>
      </tr>`,
    )
    .join('');

  return table(['Country', 'Code', ''], rows, `${countries.length} countries`);
}

function sourcesList(): string {
  /**
   * Sources carry their licence class and verification status, because that is
   * what a reader checking this app's claims actually needs — and it is the one
   * list whose value is entirely in the columns rather than the rows.
   */
  const rows = SOURCES.filter((source) => !source.excluded)
    .map(
      (source) => `<tr>
        <td>${escapeHtml(source.name)}</td>
        <td>${escapeHtml(source.panel ?? '')}</td>
        <td><span class="list-licence">${escapeHtml(source.licenseClass ?? 'unknown')}</span></td>
        <td>${
          source.verifiedAgainst === 'live'
            ? '<span class="list-verified">live</span>'
            : `<span class="list-unverified">${escapeHtml(source.verifiedAgainst ?? 'unverified')}</span>`
        }</td>
      </tr>`,
    )
    .join('');

  const live = SOURCES.filter((source) => !source.excluded && source.verifiedAgainst === 'live').length;
  return table(
    ['Source', 'Panel', 'Licence', 'Verified against'],
    rows,
    `${SOURCES.filter((s) => !s.excluded).length} sources, ${live} verified against a live capture`,
  );
}

function watchlistList(): string {
  const predictions = (watchlist as { predictions: Array<{ subject: string; predicted: string; observed: string; verdict: string }> })
    .predictions;

  const rows = predictions
    .map(
      (prediction) => `<tr>
        <td>${escapeHtml(prediction.subject)}</td>
        <td>${escapeHtml(prediction.predicted)}</td>
        <td>${escapeHtml(prediction.observed)}</td>
        <td><span class="list-verdict list-verdict--${escapeHtml(prediction.verdict.toLowerCase())}">${escapeHtml(prediction.verdict)}</span></td>
      </tr>`,
    )
    .join('');

  const refuted = predictions.filter((prediction) => prediction.verdict === 'REFUTED').length;
  return table(
    ['Subject', 'Predicted', 'Observed', 'Verdict'],
    rows,
    refuted === 0
      ? `${predictions.length} predictions, none refuted — recorded, not filtered`
      : `${predictions.length} predictions, ${refuted} refuted`,
  );
}

function table(headings: string[], rows: string, caption: string): string {
  return `<table class="list-table">
    <caption>${escapeHtml(caption)}</caption>
    <thead><tr>${headings.map((heading) => `<th scope="col">${escapeHtml(heading)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ------------------------------------------------------------------ mount */

let openList: ListId | null = null;

export function mountLists(root: HTMLElement, launcher: HTMLElement, now: Date): void {
  const draw = () => {
    if (openList === null) {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }
    root.hidden = false;
    root.innerHTML = `
      <div class="lists-panel" role="dialog" aria-modal="true" aria-label="Browse lists">
        <div class="lists-tabs">
          ${LISTS.map(
            (entry) => `<button type="button" class="lists-tab${entry.id === openList ? ' lists-tab--on' : ''}"
              data-list="${entry.id}" aria-pressed="${entry.id === openList}">${escapeHtml(entry.label)}</button>`,
          ).join('')}
          <button type="button" class="lists-close" data-lists-close aria-label="Close lists">Close</button>
        </div>
        <div class="lists-body">${renderList(openList, now)}</div>
      </div>`;
    root.querySelector<HTMLElement>('.lists-tab--on')?.focus();
  };

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-lists-close]')) {
      openList = null;
      draw();
      return;
    }
    const tab = target.closest<HTMLElement>('[data-list]');
    const id = tab?.dataset['list'];
    if (id) {
      openList = id as ListId;
      draw();
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      openList = null;
      draw();
    }
  });

  launcher.addEventListener('click', () => {
    openList = openList === null ? 'events' : null;
    draw();
  });

  draw();
}
