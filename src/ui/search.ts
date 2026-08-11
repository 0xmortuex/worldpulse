import type { Country } from '../countries';
import type { Store } from '../state';
import { escapeHtml } from './popover';

/**
 * Country search. Doubles as the keyboard equivalent of clicking the globe —
 * every selection reachable by pointer must be reachable without one, and
 * without WebGL.
 */
export function mountSearch(root: HTMLElement, store: Store, countries: readonly Country[]): void {
  root.innerHTML = `
    <input class="search-input" type="search" placeholder="Search countries  /"
           aria-label="Search countries" autocomplete="off" role="combobox"
           aria-expanded="false" aria-controls="search-results" />
    <ul class="search-results" id="search-results" role="listbox" hidden></ul>`;

  const input = root.querySelector<HTMLInputElement>('.search-input');
  const list = root.querySelector<HTMLUListElement>('.search-results');
  if (!input || !list) return;

  let matches: Country[] = [];
  let active = -1;

  const close = (): void => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  const paint = (): void => {
    list.innerHTML = matches
      .map(
        (country, index) =>
          `<li role="option" data-code="${escapeHtml(country.code)}" aria-selected="${index === active}"
               class="${index === active ? 'active' : ''}">
             <span>${escapeHtml(country.name)}</span><code>${escapeHtml(country.code)}</code>
           </li>`,
      )
      .join('');
    list.hidden = matches.length === 0;
    input.setAttribute('aria-expanded', String(matches.length > 0));
  };

  const commit = (code: string, additive: boolean): void => {
    if (additive) store.toggle(code);
    else store.select(code);
    input.value = '';
    matches = [];
    close();
  };

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    matches = query.length === 0 ? [] : rank(countries, query).slice(0, 8);
    active = matches.length > 0 ? 0 : -1;
    paint();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      matches = [];
      close();
      input.blur();
      return;
    }
    if (matches.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + delta + matches.length) % matches.length;
      paint();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = matches[active];
      if (chosen) commit(chosen.code, event.ctrlKey || event.metaKey);
    }
  });

  list.addEventListener('mousedown', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-code]');
    const code = item?.dataset['code'];
    if (code) {
      event.preventDefault();
      commit(code, event.ctrlKey || event.metaKey);
    }
  });

  input.addEventListener('blur', () => window.setTimeout(close, 120));

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });
}

/** Prefix matches on name or code first, then substring matches. */
function rank(countries: readonly Country[], query: string): Country[] {
  const scored: Array<{ country: Country; rank: number }> = [];
  for (const country of countries) {
    const name = country.name.toLowerCase();
    const code = country.code.toLowerCase();
    if (code === query) scored.push({ country, rank: 0 });
    else if (name.startsWith(query)) scored.push({ country, rank: 1 });
    else if (code.startsWith(query)) scored.push({ country, rank: 2 });
    else if (name.includes(query)) scored.push({ country, rank: 3 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name));
  return scored.map((entry) => entry.country);
}
