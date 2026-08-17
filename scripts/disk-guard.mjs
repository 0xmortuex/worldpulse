import { statfsSync } from 'node:fs';

/**
 * Refuse to start a measuring run that the disk cannot finish.
 *
 * ## Why this exists, in one sentence
 *
 * A mutation run died at 3 of 12 because the volume filled, and the way it died
 * was worse than the dying: `BUILD-FAILED` on four consecutive mutants, which
 * READS LIKE A VERDICT. It is not one. A mutant whose build never ran has told
 * us nothing about whether the suite can see that behaviour, and reporting it
 * beside real CAUGHT results invites exactly the reading rule 3 forbids —
 * inconclusive treated as evidence.
 *
 * ## Same class as the run lock
 *
 * `run-lock.mjs` refuses up front rather than letting two runs contend and
 * discovering it in the timings afterwards. This is the same shape: a
 * precondition checked BEFORE the work, not discovered as a corpse an hour in.
 * A warning would be useless for the same reason it is useless there — nobody
 * reads the top of an hour-long run, and the cost of proceeding is the whole
 * run.
 *
 * ## Where the floor comes from — measured, not guessed
 *
 * From the session that prompted this, on this machine:
 *
 *   - A full 12-mutant run consumed about **100 MB** of free space while
 *     running (1.8 GB → 1.7 GB, sampled repeatedly during the run). The
 *     worktree itself is only ~14 MB — it shares `node_modules` — so the cost
 *     is the per-mutant build and browser temp.
 *   - Runs **died** with free space between **0 and 78 MB**, and the first
 *     symptom was child processes failing to spawn at all
 *     (Windows `0xC0000142`), not a clean ENOSPC.
 *   - Runs **completed** starting from 1.2 GB and from 1.8 GB.
 *
 * The floor is **512 MB**: five times the measured consumption, and far above
 * the band where spawning was already broken. It is deliberately not 100 MB —
 * a floor set at exactly what a healthy run uses leaves nothing for the failure
 * modes that made this necessary, and the whole point is to refuse before the
 * machine starts behaving strangely rather than after.
 */
export const MUTATION_FLOOR_BYTES = 512 * 1024 * 1024;

/**
 * Directly callable (rule 32), and pure. Takes the reading rather than making
 * it, so every branch below — including "the reading failed" — is assertable
 * without a full disk.
 *
 * @param {{ freeBytes: number | null, floorBytes?: number, what?: string }} input
 * @returns {{ proceed: boolean, reason: string }}
 */
export function freeSpaceDecision({ freeBytes, floorBytes = MUTATION_FLOOR_BYTES, what = 'this run' }) {
  /**
   * A reading we could not take is INCONCLUSIVE, and inconclusive proceeds.
   *
   * Rule 3 cuts both ways here. "We could not measure the disk" is not evidence
   * that the disk is full, and refusing to run on it would let an unsupported
   * platform or a permissions quirk block a machine that is perfectly fine. The
   * guard exists to catch a known, measured failure — not to gate on its own
   * ability to look.
   */
  if (freeBytes === null || !Number.isFinite(freeBytes)) {
    return { proceed: true, reason: 'free space could not be measured — proceeding, unguarded' };
  }

  if (freeBytes >= floorBytes) {
    return { proceed: true, reason: `${mb(freeBytes)} free, floor ${mb(floorBytes)}` };
  }

  return {
    proceed: false,
    reason:
      `not enough free disk to finish ${what}: ${mb(freeBytes)} free, ` +
      `${mb(floorBytes)} required.\n\n` +
      'This is a REFUSAL, not a failure of the tree. A measuring run that fills the\n' +
      'disk mid-way does not stop cleanly — it reports BUILD-FAILED on the mutants it\n' +
      'never built, which reads like a verdict and is not one. Rather than produce\n' +
      'results that have to be retracted, it stops here.\n\n' +
      'Free some space and run it again; completed verdicts are journalled, so the\n' +
      'run resumes rather than starting over.',
  };
}

function mb(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * The impure half: read free bytes for the volume holding `path`.
 *
 * Returns null rather than throwing on any platform or permission problem, so
 * the decision above sees "could not measure" as a value.
 */
export function freeBytesOn(path) {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/** Convenience for callers: measure, decide, throw the refusal. */
export function requireFreeSpace(path, { floorBytes = MUTATION_FLOOR_BYTES, what = 'this run' } = {}) {
  const decision = freeSpaceDecision({ freeBytes: freeBytesOn(path), floorBytes, what });
  if (!decision.proceed) throw new Error(decision.reason);
  return decision;
}
