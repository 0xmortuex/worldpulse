import { LAYERS } from './layers/provider';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from './relations/score';

const DEFAULT_LAYERS = LAYERS.filter((layer) => layer.defaultOn).map((layer) => layer.id);
import type { Thresholds, Weights } from './relations/types';

export type TabId =
  | 'government'
  | 'legislature'
  | 'military'
  | 'economy'
  | 'news'
  | 'tv'
  | 'risk';

export interface AppState {
  /** Ordered so compare columns keep a stable left-to-right identity. */
  selected: string[];
  weights: Weights;
  thresholds: Thresholds;
  hovered: string | null;
  tab: TabId;
  /** Enabled globe layer ids. */
  layers: ReadonlySet<string>;
  /** Whether events flagged stale are rendered. Off by default. */
  includeStale: boolean;
  /**
   * Step 12's coverage choropleth.
   *
   * A MODE rather than a layer, because it repaints every polygon and cannot
   * coexist with relations colouring — two meanings for one channel is exactly
   * what the globe's single colour channel cannot express (question 12).
   */
  coverageMode: boolean;
}

type Listener = (state: AppState) => void;

/**
 * Minimal observable store. URL serialisation lands in step 13; keeping the
 * state in one object now means that step is a serialiser, not a refactor.
 */
export class Store {
  #state: AppState;
  readonly #listeners = new Set<Listener>();

  constructor(initial?: Partial<AppState>) {
    this.#state = {
      selected: ['USA'],
      weights: { ...DEFAULT_WEIGHTS },
      thresholds: { ...DEFAULT_THRESHOLDS },
      hovered: null,
      tab: 'government',
      layers: new Set(DEFAULT_LAYERS),
      includeStale: false,
      coverageMode: false,
      ...initial,
    };
  }

  get state(): Readonly<AppState> {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #commit(next: Partial<AppState>): void {
    this.#state = { ...this.#state, ...next };
    for (const listener of this.#listeners) listener(this.#state);
  }

  /** Plain click: this country becomes the only selection. */
  select(code: string): void {
    this.#commit({ selected: [code] });
  }

  /** Ctrl/Cmd-click: add, or remove if already selected. */
  toggle(code: string): void {
    const selected = this.#state.selected;
    this.#commit({
      selected: selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code],
    });
  }

  clear(): void {
    this.#commit({ selected: [] });
  }

  /**
   * Re-notify listeners without changing state.
   *
   * For view-local state that is not worth putting in the store — the economy
   * tab's per-indicator log/linear choice — so the re-render still goes through
   * the normal subscriber path rather than mutating the DOM behind the panel.
   */
  refresh(): void {
    this.#commit({});
  }

  setTab(tab: TabId): void {
    if (this.#state.tab === tab) return;
    this.#commit({ tab });
  }

  toggleLayer(id: string): void {
    const next = new Set(this.#state.layers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.#commit({ layers: next });
  }

  setIncludeStale(include: boolean): void {
    if (this.#state.includeStale === include) return;
    this.#commit({ includeStale: include });
  }

  setCoverageMode(on: boolean): void {
    if (this.#state.coverageMode === on) return;
    this.#commit({ coverageMode: on });
  }

  setHovered(code: string | null): void {
    if (this.#state.hovered === code) return;
    this.#commit({ hovered: code });
  }

  setWeight(kind: keyof Weights, value: number): void {
    this.#commit({ weights: { ...this.#state.weights, [kind]: value } });
  }

  resetWeights(): void {
    this.#commit({ weights: { ...DEFAULT_WEIGHTS }, thresholds: { ...DEFAULT_THRESHOLDS } });
  }

  /**
   * Restore several fields at once — for the URL, and only for the URL.
   *
   * ONE commit rather than five setters, because restoring a shared link is a
   * single event. Calling `select`, `setTab`, `setWeight`… in sequence would
   * notify subscribers five times and render five intermediate views, one of
   * which briefly shows the sender's countries with the reader's weights — a
   * view neither of them ever chose.
   *
   * Deliberately not a general "set anything" escape hatch: every field it
   * accepts is one the URL carries, and `hovered` is absent because a pointer
   * position is not a view.
   */
  hydrate(next: Partial<Omit<AppState, 'hovered'>>): void {
    this.#commit(next);
  }
}
