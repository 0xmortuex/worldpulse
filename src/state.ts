import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from './relations/score';
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

  setTab(tab: TabId): void {
    if (this.#state.tab === tab) return;
    this.#commit({ tab });
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
}
