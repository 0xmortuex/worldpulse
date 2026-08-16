import type { Country } from '../countries';
import { renderLegislatureTab } from './legislature';
import { renderMilitaryTab } from './military';
import { renderTvTab } from './tv';
import { factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import { scoreFact } from '../relations/provenance';
import { pairKey, score } from '../relations/score';
import type { Finding, RelationResult, Tier } from '../relations/types';
import type { AppState, Store } from '../state';
import { TIER_COLORS, TIER_GLYPH, TIER_LABELS } from '../theme';
import { escapeHtml } from './popover';
import { comparePortrait, renderDossierHeader } from './header';
import { renderGovernmentTab } from './government';
import { renderEconomyTab, resetEconomyScales } from './economy';
import { renderNewsTab, resetNewsFilters } from './news';
import type { TabId } from '../state';

const TIER_ORDER: Tier[] = ['ally', 'adversary', 'strained', 'neutral', 'nodata'];

export interface PanelContext {
  byCode: ReadonlyMap<string, Country>;
  findings: ReadonlyMap<string, Finding[]>;
  currentYear: number;
  /** Compile date of the seed fact table, stamped onto derived provenance. */
  compiledAt: string;
  /** Injected so the time scrub can later render the dossier as of a past date. */
  today: Date;
}

const TABS: Array<{ id: TabId; label: string; step: string | null }> = [
  { id: 'government', label: 'Government', step: null },
  { id: 'legislature', label: 'Legislature', step: null },
  { id: 'military', label: 'Military', step: 'step 8' },
  { id: 'economy', label: 'Economy', step: null },
  { id: 'news', label: 'News', step: null },
  { id: 'tv', label: 'Live TV', step: null },
  { id: 'risk', label: 'Risk', step: 'step 10' },
];

export function mountPanel(root: HTMLElement, store: Store, context: PanelContext): void {
  root.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (tab) {
      const id = tab.dataset['tab'];
      if (id) store.setTab(id as TabId);
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-select]');
    if (!target) return;
    const code = target.dataset['select'];
    if (code) store.select(code);
  });

  // Number keys jump between dossier tabs, per the spec's keyboard map.
  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const index = Number.parseInt(event.key, 10);
    if (!Number.isInteger(index) || index < 1 || index > TABS.length) return;
    const tab = TABS[index - 1];
    if (tab) store.setTab(tab.id);
  });

  let lastSubject: string | undefined;
  store.subscribe((state) => {
    // Scale choices are per indicator, not per country: carrying a log toggle
    // across a country switch would silently change how the next chart reads.
    const subject = state.selected.length === 1 ? state.selected[0] : undefined;
    if (subject !== lastSubject) {
      resetEconomyScales();
      resetNewsFilters();
      lastSubject = subject;
    }
    root.innerHTML = render(state, context);
  });
}

function render(state: AppState, context: PanelContext): string {
  const selected = state.selected
    .map((code) => context.byCode.get(code))
    .filter((country): country is Country => country !== undefined);

  if (selected.length === 0) {
    return `<div class="panel-empty">
      <h2>No country selected</h2>
      <p>Click a country to select it. Ctrl or Cmd-click to add another and open
      the compare view.</p>
    </div>`;
  }

  if (selected.length === 1) {
    const subject = selected[0] as Country;
    return singleView(subject, state, context);
  }

  return compareView(selected, state, context);
}

function relationsFor(subject: Country, state: AppState, context: PanelContext): RelationResult[] {
  const results: RelationResult[] = [];
  for (const [code] of context.byCode) {
    if (code === subject.code) continue;
    results.push(
      score(
        subject.code,
        code,
        context.findings.get(pairKey(subject.code, code)),
        state.weights,
        state.thresholds,
        context.currentYear,
      ),
    );
  }
  return results;
}

function countByTier(results: readonly RelationResult[]): Record<Tier, number> {
  const counts: Record<Tier, number> = { ally: 0, adversary: 0, strained: 0, neutral: 0, nodata: 0 };
  for (const result of results) counts[result.tier] += 1;
  return counts;
}

function singleView(subject: Country, state: AppState, context: PanelContext): string {
  const results = relationsFor(subject, state, context);
  const counts = countByTier(results);

  const notable = results
    // Low-confidence neutrals earn a row: "we have only stale evidence" is
    // worth surfacing, where a plain neutral is not.
    .filter((result) => result.tier !== 'nodata' && (result.tier !== 'neutral' || result.lowConfidence))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.other.localeCompare(b.other));

  // Header, then tabs, then the tab body, then relations. The header is the
  // country's identity and belongs directly above the tabs; the relations block
  // is a separate view of the same country and reads better after them.
  return `
    ${renderDossierHeader(subject, context.today)}
    ${tabStrip(state.tab)}
    ${tabBody(subject, state.tab, context)}

    <div class="panel-eyebrow panel-eyebrow--section">Relations mode · single selection${
      subject.codeStatus === 'user-assigned' ? ' · <span class="tag tag--warn">non-ISO code</span>' : ''
    }</div>

    <div class="tier-counts">
      ${TIER_ORDER.map(
        (tier) => `
        <div class="tier-count">
          <span class="swatch" style="background:${TIER_COLORS[tier]}" aria-hidden="true">${TIER_GLYPH[tier]}</span>
          <span class="tier-count-n">${notAFact(counts[tier] ?? 0, 'count of rows rendered below, each of which carries its own badge and provenance')}</span>
          <span class="tier-count-l">${escapeHtml(TIER_LABELS[tier])}</span>
        </div>`,
      ).join('')}
    </div>

    <h3 class="panel-h3">Classified relations <span class="badge badge--derived">DERIVED</span></h3>
    ${
      notable.length === 0
        ? `<p class="panel-note">Nothing in the fact tables classifies ${escapeHtml(subject.name)}
           against another country. Every other country reads as no data.</p>`
        : `<ul class="relation-list">
            ${notable
              .map((result) => {
                const other = context.byCode.get(result.other);
                if (!other) return '';
                /**
                 * Three channels, never colour alone (B1): the swatch's hue, the
                 * glyph inside it, and the tier's name in text. Before this the
                 * row carried its tier ONLY as a background colour, so a reader
                 * with a red-green deficiency could not tell an adversary from a
                 * strained relation — the two the panel most needs to separate.
                 */
                return `<li data-select="${escapeHtml(result.other)}" role="button" tabindex="0">
                  <span class="swatch" style="background:${TIER_COLORS[result.tier]}"
                    aria-hidden="true">${TIER_GLYPH[result.tier]}</span>
                  <span class="relation-name">${escapeHtml(other.name)}</span>
                  <span class="relation-tier" data-tier="${escapeHtml(result.tier)}">${escapeHtml(TIER_LABELS[result.tier])}</span>
                  ${result.lowConfidence ? '<span class="tag tag--warn">low conf.</span>' : ''}
                  <span class="relation-score">${factHtml(scoreFact(result, context.compiledAt), { hideAsOf: true, compact: true })}</span>
                </li>`;
              })
              .join('')}
          </ul>`
    }`;
}

function tabStrip(active: TabId): string {
  return `<nav class="tabs" role="tablist" aria-label="Dossier sections">
    ${TABS.map(
      (tab) => `<button type="button" role="tab" data-tab="${tab.id}"
        aria-selected="${tab.id === active}"
        class="tab${tab.id === active ? ' tab--active' : ''}${tab.step ? ' tab--pending' : ''}"
        >${escapeHtml(tab.label)}</button>`,
    ).join('')}
  </nav>`;
}

function tabBody(subject: Country, tab: TabId, context: PanelContext): string {
  if (tab === 'government') return renderGovernmentTab(subject.code, subject.name, context.today);
  if (tab === 'economy') return renderEconomyTab(subject.code, subject.name, context.today);
  if (tab === 'news') return renderNewsTab(subject.code, subject.name);
  if (tab === 'military') return renderMilitaryTab(subject.code, subject.name);
  if (tab === 'legislature') return renderLegislatureTab(subject.code, subject.name);
  if (tab === 'tv') return renderTvTab(subject.code, subject.name);
  const entry = TABS.find((candidate) => candidate.id === tab);
  return `<div class="gov"><p class="gov-pending"><strong>Not built yet.</strong>
    The ${escapeHtml(entry?.label ?? tab)} tab arrives with ${escapeHtml(entry?.step ?? 'a later step')}.
    It is listed in the tab strip rather than hidden so the scope stays visible.</p></div>`;
}

function compareView(selected: readonly Country[], state: AppState, context: PanelContext): string {
  const columns = selected.map((subject) => {
    const counts = countByTier(relationsFor(subject, state, context));
    return { subject, counts };
  });

  // Pairwise classification between the selected countries themselves — the
  // one comparison that is genuinely available before the dossier panels exist.
  const pairs: string[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const a = selected[i];
      const b = selected[j];
      if (!a || !b) continue;
      const result = score(
        a.code,
        b.code,
        context.findings.get(pairKey(a.code, b.code)),
        state.weights,
        state.thresholds,
        context.currentYear,
      );
      pairs.push(`
        <li>
          <span class="swatch" style="background:${TIER_COLORS[result.tier]}" aria-hidden="true">${TIER_GLYPH[result.tier]}</span>
          <span class="relation-name">${escapeHtml(a.name)} ↔ ${escapeHtml(b.name)}</span>
          <span class="relation-score">${escapeHtml(TIER_LABELS[result.tier])}</span>
        </li>`);
    }
  }

  return `
    <header class="panel-head">
      <div class="panel-eyebrow">Compare · ${notAFact(selected.length, 'number of countries the user has selected — a UI state, not data about the world')} selected</div>
      <h2>${selected.map((country) => escapeHtml(country.name)).join(' · ')}</h2>
    </header>

    <h3 class="panel-h3">Between the selected <span class="badge badge--derived">DERIVED</span></h3>
    <ul class="relation-list">${pairs.join('')}</ul>

    <h3 class="panel-h3">Relation profile</h3>
    <table class="compare">
      <thead>
        <tr><th></th>${columns
          .map((c) => `<th>${comparePortrait(c.subject, context.today)}</th>`)
          .join('')}</tr>
        <tr><th>Tier</th>${columns.map((c) => `<th>${escapeHtml(c.subject.code)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${TIER_ORDER.map((tier) => {
          const values = columns.map((c) => c.counts[tier]);
          const max = Math.max(...values);
          return `<tr>
            <td><span class="swatch" style="background:${TIER_COLORS[tier]}" aria-hidden="true">${TIER_GLYPH[tier]}</span>${escapeHtml(TIER_LABELS[tier])}</td>
            ${values
              .map(
                (value) =>
                  `<td class="${value === max && max > 0 ? 'leads' : ''}">${notAFact(value, 'count of classifications for this column, each individually badged in that country single view')}</td>`,
              )
              .join('')}
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <p class="panel-note">Stat rows for government, economy, military and the rest
    arrive with the dossier panels in steps 4–9. This view currently compares only
    what the relations engine can compute.</p>`;
}
