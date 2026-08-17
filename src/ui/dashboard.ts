import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * The dashboard — SPEC-WARWATCH §4.
 *
 * Per-user, local-only. No accounts, no server-side profile, no tiers.
 *
 * ## No clearance language, and the reason is not squeamishness
 *
 * §4 forbids clearance levels, tier badges and "access" wording outright. This
 * project is non-commercial with nothing to gate (decision 3), so a clearance
 * indicator would be theatre — and theatre with a specific false claim: it
 * implies the data behind it is privileged when every byte of it is public.
 * `tests/dashboard.test.ts` asserts the rendered markup against that vocabulary
 * rather than trusting nobody adds it later.
 *
 * ## Storage is injected
 *
 * The functions here take a `Store` rather than reaching for `localStorage`, so
 * every behaviour below is testable without a browser and a quota error is a
 * value rather than an exception thrown across the render.
 */

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVED_KEY = 'worldpulse.saved';
export const HISTORY_KEY = 'worldpulse.history';

/** History is capped: a reading list nobody can scroll is not a reading list. */
export const HISTORY_LIMIT = 25;

export interface SavedItem {
  /** ISO3 country code. */
  code: string;
  name: string;
  /** Epoch ms when it was saved, so the list can be ordered without guessing. */
  savedAt: number;
}

export interface HistoryEntry {
  code: string;
  name: string;
  seenAt: number;
}

/**
 * Read a list, treating anything unreadable as EMPTY rather than throwing.
 *
 * Storage can contain whatever a previous version wrote, or whatever another
 * tab wrote, or nothing. A dashboard that throws on a malformed key takes the
 * whole page down with it, and the honest reading of "I cannot parse this" is
 * that we have no saved items to show — not that the app is broken.
 */
function readList<T>(store: Store, key: string): T[] {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return [];
  }
  if (raw === null || raw === '') return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList(store: Store, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // A full quota is not a reason to lose the page. The write is dropped and
    // the in-memory list the caller holds is still correct for this session.
  }
}

export function savedItems(store: Store): SavedItem[] {
  return readList<SavedItem>(store, SAVED_KEY)
    .filter((item) => typeof item?.code === 'string' && item.code !== '')
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function saveItem(store: Store, item: SavedItem): SavedItem[] {
  const existing = savedItems(store).filter((entry) => entry.code !== item.code);
  const next = [item, ...existing];
  writeList(store, SAVED_KEY, next);
  return next;
}

export function removeItem(store: Store, code: string): SavedItem[] {
  const next = savedItems(store).filter((entry) => entry.code !== code);
  writeList(store, SAVED_KEY, next);
  return next;
}

export function history(store: Store): HistoryEntry[] {
  return readList<HistoryEntry>(store, HISTORY_KEY)
    .filter((entry) => typeof entry?.code === 'string' && entry.code !== '')
    .sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0));
}

/**
 * Record a view. Re-visiting a country MOVES its entry rather than adding a
 * second one — a history that lists the same country nine times is a log, and
 * §4 asked for reading history.
 */
export function recordView(store: Store, entry: HistoryEntry): HistoryEntry[] {
  const existing = history(store).filter((row) => row.code !== entry.code);
  const next = [entry, ...existing].slice(0, HISTORY_LIMIT);
  writeList(store, HISTORY_KEY, next);
  return next;
}

/** Clear-all is visible in the UI and total here: both keys, not just one. */
export function clearAll(store: Store): void {
  try {
    store.removeItem(SAVED_KEY);
    store.removeItem(HISTORY_KEY);
  } catch {
    // Same reasoning as writeList: a storage failure must not take the page.
  }
}

function relative(then: number, nowMs: number): string {
  const delta = nowMs - then;
  if (!Number.isFinite(delta) || delta < 0) return 'time unavailable';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function renderDashboard(store: Store, nowMs: number): string {
  const saved = savedItems(store);
  const seen = history(store);

  return `<div class="dash-panel" role="dialog" aria-modal="true" aria-label="Your dashboard">
    <header class="dash-header">
      <h2>Your dashboard</h2>
      <button type="button" class="dash-close" data-dash-close aria-label="Close the dashboard">Close</button>
    </header>

    <p class="dash-note">
      Everything here is stored in this browser only. There is no account, nothing is sent
      anywhere, and clearing it below removes it for good.
    </p>

    <section class="dash-section" aria-label="Saved countries">
      <h3>Saved <span class="dash-count">${n(saved.length, 'a count of rows this reader saved in their own browser')}</span></h3>
      ${
        saved.length === 0
          ? '<p class="dash-empty">Nothing saved yet.</p>'
          : `<ul class="dash-saved">${saved
              .map(
                (item) => `<li class="dash-item">
                  <a href="?c=${escapeHtml(item.code)}" data-dash-open="${escapeHtml(item.code)}">${escapeHtml(item.name)}</a>
                  <span class="dash-when">${escapeHtml(relative(item.savedAt, nowMs))}</span>
                  <button type="button" data-dash-remove="${escapeHtml(item.code)}"
                    aria-label="Remove ${escapeHtml(item.name)} from saved">Remove</button>
                </li>`,
              )
              .join('')}</ul>`
      }
    </section>

    <section class="dash-section" aria-label="Reading history">
      <h3>Recently viewed <span class="dash-count">${n(seen.length, 'a count of this reader\'s own visits, held in their browser')}</span></h3>
      ${
        seen.length === 0
          ? '<p class="dash-empty">No history yet.</p>'
          : `<ul class="dash-history">${seen
              .map(
                (entry) => `<li class="dash-item">
                  <a href="?c=${escapeHtml(entry.code)}" data-dash-open="${escapeHtml(entry.code)}">${escapeHtml(entry.name)}</a>
                  <span class="dash-when">${escapeHtml(relative(entry.seenAt, nowMs))}</span>
                </li>`,
              )
              .join('')}</ul>`
      }
    </section>

    <section class="dash-section" aria-label="Clear your data">
      <button type="button" class="dash-clear" data-dash-clear>Clear everything stored in this browser</button>
    </section>
  </div>`;
}

export interface DashboardActions {
  selectCountry(code: string): void;
}

export function mountDashboard(
  root: HTMLElement,
  launcher: HTMLElement,
  store: Store,
  now: () => number,
  actions: DashboardActions,
): void {
  let open = false;

  const draw = () => {
    if (!open) {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }
    root.hidden = false;
    root.innerHTML = renderDashboard(store, now());
  };

  launcher.addEventListener('click', () => {
    open = !open;
    draw();
  });

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('[data-dash-close]')) {
      open = false;
      draw();
      return;
    }
    if (target.closest('[data-dash-clear]')) {
      clearAll(store);
      draw();
      return;
    }

    const remove = target.closest<HTMLElement>('[data-dash-remove]');
    if (remove) {
      removeItem(store, remove.dataset['dashRemove'] ?? '');
      draw();
      return;
    }

    const openCountry = target.closest<HTMLElement>('[data-dash-open]');
    if (openCountry) {
      event.preventDefault();
      actions.selectCountry(openCountry.dataset['dashOpen'] ?? '');
      open = false;
      draw();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!open || event.key !== 'Escape') return;
    open = false;
    draw();
  });

  draw();
}
