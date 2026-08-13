export interface JournalEntry {
  commit: string;
  step: string;
  what: string;
  verdict: string;
  detail: string;
  ms: number;
}

export interface MutationLike {
  step: string;
  what: string;
}

export function usableEntries(
  entries: JournalEntry[],
  commit: string,
): { usable: JournalEntry[]; discarded: number };

export function isResumable(entry: JournalEntry | null | undefined): boolean;
export function alreadyDecided(entries: JournalEntry[], mutation: MutationLike): JournalEntry | null;

export function planFrom<T extends MutationLike>(
  entries: JournalEntry[],
  mutations: readonly T[],
  commit: string,
): { pending: T[]; resumed: JournalEntry[] };
