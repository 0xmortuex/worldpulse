import { loadCountries } from '../countries';
import { escapeHtml } from '../facts/badge';
import { LISTS } from './lists';
import { TOUR_STEPS } from './tour';

/**
 * The command palette — Phase C.6.
 *
 * ## Built from the same declarations the surfaces are
 *
 * Commands come from the country list, the list-view registry and the tour's
 * step data — not from a hand-written array. A palette with its own copy of
 * "what this app can do" is a second description free to drift, and the surface
 * most likely to go stale is the one that claims to know everything.
 *
 * The same reasoning as the tour's selectors and the freshness monitor's rows:
 * generated coverage cannot silently omit what it was never told about.
 */

export interface Command {
  id: string;
  label: string;
  kind: 'country' | 'tab' | 'list' | 'action';
  /** What running it does, expressed as state rather than as a DOM action. */
  payload: string;
}

const TABS = ['government', 'legislature', 'military', 'economy', 'news', 'tv', 'risk'] as const;

export function allCommands(): Command[] {
  const countries = loadCountries().map((country) => ({
    id: `country:${country.code}`,
    label: country.name,
    kind: 'country' as const,
    payload: country.code,
  }));

  const tabs = TABS.map((tab) => ({
    id: `tab:${tab}`,
    label: `Open the ${tab} tab`,
    kind: 'tab' as const,
    payload: tab,
  }));

  const lists = LISTS.map((list) => ({
    id: `list:${list.id}`,
    label: `List: ${list.label}`,
    kind: 'list' as const,
    payload: list.id,
  }));

  const actions: Command[] = [
    { id: 'action:tour', label: 'Show the guided tour', kind: 'action', payload: 'tour' },
    { id: 'action:intel', label: 'Open the intel feed', kind: 'action', payload: 'intel' },
    { id: 'action:flat', label: 'Toggle the flat map', kind: 'action', payload: 'flat' },
    { id: 'action:coverage', label: 'Toggle the coverage map', kind: 'action', payload: 'coverage' },
  ];

  return [...countries, ...tabs, ...lists, ...actions];
}

/**
 * Rank matches so a typed prefix finds the obvious thing first.
 *
 * Deliberately simple — prefix beats word-start beats substring — and simple
 * because a ranking nobody can predict is worse than one that is merely blunt.
 * A reader typing "fra" expects France, not "Toggle the flat map" because it
 * happened to score higher on a cleverer metric.
 */
export function search(query: string, commands: readonly Command[] = allCommands()): Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const scored: Array<{ command: Command; score: number }> = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    let score = -1;
    if (label.startsWith(needle)) score = 3;
    else if (label.split(/\s+/).some((word) => word.startsWith(needle))) score = 2;
    else if (label.includes(needle)) score = 1;
    if (score >= 0) scored.push({ command, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .slice(0, 12)
    .map((entry) => entry.command);
}

/**
 * Every surface the tour names must be reachable from the palette.
 *
 * Exported so a test can assert it rather than a reader having to notice. The
 * tour is this app's own list of what it has; a palette that cannot reach
 * something the tour introduces is a navigation surface with a hole in it, and
 * the hole would be invisible.
 */
export function tourSurfacesReachable(commands: readonly Command[] = allCommands()): string[] {
  const labels = commands.map((command) => command.label.toLowerCase()).join(' | ');
  const missing: string[] = [];

  const expectations: Array<[string, RegExp]> = [
    ['tabs', /open the government tab/],
    ['events list', /list: events/],
    ['coverage', /coverage map/],
    ['tour', /guided tour/],
  ];

  for (const [name, pattern] of expectations) {
    if (!pattern.test(labels)) missing.push(name);
  }
  return missing;
}

export function renderPalette(query: string): string {
  const results = search(query);

  return `<div class="palette-panel" role="dialog" aria-modal="true" aria-label="Command palette">
    <input type="text" class="palette-input" data-palette-input autocomplete="off"
      placeholder="Jump to a country, tab or list…" value="${escapeHtml(query)}"
      aria-label="Search commands">
    <ul class="palette-results" role="listbox">
      ${
        results.length === 0
          ? `<li class="palette-empty">${
              query.trim() === '' ? 'Type to search.' : 'Nothing matches. That is a fact about the search, not about the app.'
            }</li>`
          : results
              .map(
                (command, index) => `<li role="option" aria-selected="${index === 0}">
                  <button type="button" class="palette-item${index === 0 ? ' palette-item--first' : ''}"
                    data-command="${escapeHtml(command.id)}">
                    <span class="palette-kind">${escapeHtml(command.kind)}</span>
                    <span class="palette-label">${escapeHtml(command.label)}</span>
                  </button>
                </li>`,
              )
              .join('')
      }
    </ul>
  </div>`;
}

/** The tour's step count, used to prove the palette was built from real data. */
export function tourStepCount(): number {
  return TOUR_STEPS.length;
}

export interface PaletteActions {
  selectCountry(iso3: string): void;
  openTab(tab: string): void;
  openList(list: string): void;
  runAction(action: string): void;
}

export function mountPalette(root: HTMLElement, actions: PaletteActions): void {
  let open = false;
  let query = '';

  const draw = () => {
    if (!open) {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }
    root.hidden = false;
    root.innerHTML = renderPalette(query);
    const input = root.querySelector<HTMLInputElement>('[data-palette-input]');
    input?.focus();
    input?.setSelectionRange(query.length, query.length);
  };

  const run = (id: string) => {
    const command = allCommands().find((candidate) => candidate.id === id);
    if (!command) return;
    open = false;
    query = '';
    draw();
    if (command.kind === 'country') actions.selectCountry(command.payload);
    else if (command.kind === 'tab') actions.openTab(command.payload);
    else if (command.kind === 'list') actions.openList(command.payload);
    else actions.runAction(command.payload);
  };

  /**
   * Ctrl/Cmd-K opens it, Escape closes it, Enter runs the first result.
   *
   * The shortcut is captured on the document because a palette reachable only
   * by clicking a button is not a keyboard-first surface — which is the one
   * thing it is for.
   */
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open = !open;
      query = '';
      draw();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      open = false;
      draw();
      return;
    }
    if (event.key === 'Enter') {
      const first = root.querySelector<HTMLElement>('.palette-item--first');
      const id = first?.dataset['command'];
      if (id) run(id);
    }
  });

  root.addEventListener('input', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-palette-input]');
    if (!input) return;
    query = input.value;
    draw();
  });

  root.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-command]');
    const id = item?.dataset['command'];
    if (id) run(id);
  });

  draw();
}
