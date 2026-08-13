/**
 * Persist mutation verdicts as they land, so an interrupted run is not a lost run.
 *
 * ## Why
 *
 * The harness accumulated verdicts in memory and printed them once at the end.
 * A container reboot at mutation 1 of 11 therefore destroyed the work of every
 * mutation that had finished — and this environment restarts on roughly an
 * hourly cadence while a full run needs about an hour. A run that must win a
 * race against the machine's uptime is a run that eventually never completes.
 *
 * With a journal, a reboot costs the mutation that was in flight and nothing
 * else.
 *
 * ## The commit is part of the identity, not a label
 *
 * A verdict is evidence about the tree it was measured on. Resuming across a
 * different commit would assemble a table from several trees and print it as one
 * — the stale-bundle failure at the level of the whole suite. So entries recorded
 * against a different commit are DISCARDED rather than reused, even though
 * keeping them would make the run finish faster.
 *
 * The journal lives outside `/tmp` deliberately: `/tmp` is what the reboot wiped.
 */

import { INCONCLUSIVE } from './mutation-verdict.mjs';

/** @typedef {{ commit: string, step: string, what: string, verdict: string, detail: string, ms: number }} JournalEntry */

/**
 * An inconclusive verdict is not a decision, so it is not resumable.
 *
 * NOT-EXERCISED means the mutation's step never ran. Reusing that on a later run
 * would "resume" a row that was never measured and print a complete-looking
 * table containing it — the same vacuity the classifier fix removed, arriving
 * through the cache instead of through the classifier.
 *
 * Only a conclusive verdict answers the question the run is asking.
 */
export function isResumable(entry) {
  return typeof entry?.verdict === 'string' && !INCONCLUSIVE.includes(entry.verdict);
}

/**
 * Entries usable for a run on `commit`.
 *
 * @param {JournalEntry[]} entries
 * @param {string} commit
 * @returns {{ usable: JournalEntry[], discarded: number }}
 */
export function usableEntries(entries, commit) {
  const usable = [];
  let discarded = 0;

  for (const entry of entries) {
    if (entry?.commit === commit) usable.push(entry);
    else discarded += 1;
  }

  return { usable, discarded };
}

/**
 * Has this mutation already been decided for this commit?
 *
 * Keyed on step AND what, because a step can carry more than one mutation —
 * `7b — economy fetch states` carries two, and keying on step alone would let
 * the first one's verdict stand in for the second.
 */
export function alreadyDecided(entries, mutation) {
  return (
    entries.find(
      (entry) => entry.step === mutation.step && entry.what === mutation.what && isResumable(entry),
    ) ?? null
  );
}

/**
 * Which mutations still need running, and which are already answered.
 *
 * @returns {{ pending: object[], resumed: JournalEntry[] }}
 */
export function planFrom(entries, mutations, commit) {
  const { usable } = usableEntries(entries, commit);
  const pending = [];
  const resumed = [];

  for (const mutation of mutations) {
    const decided = alreadyDecided(usable, mutation);
    if (decided) resumed.push(decided);
    else pending.push(mutation);
  }

  return { pending, resumed };
}
