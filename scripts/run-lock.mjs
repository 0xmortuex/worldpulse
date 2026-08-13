import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Refuse to start a long measuring run while another one is already running.
 *
 * ## Why this exists
 *
 * A previous session's timing data was collected while three abandoned
 * background runs were competing for the same CPU, unnoticed. Every duration it
 * produced described a contended machine, and a wrong estimate went
 * unchallenged for an hour because nothing said otherwise.
 *
 * The verdicts survive contention — a mutation is CAUGHT or not regardless of
 * how slowly it got there. **Durations do not.** So the moment the harness
 * starts recording time (which it now does), it needs to be able to say whether
 * anything else was competing for the machine while it measured. This is rule
 * 20a's mechanism: a number is a property of the app *under a stated
 * configuration*, and "alone on this box" is part of that configuration.
 *
 * ## Refuse rather than warn
 *
 * A warning at the top of an hour-long run is a warning nobody reads, and the
 * cost of proceeding is a full run whose timing has to be thrown away. Refusing
 * costs one message and the run can start again in a second.
 *
 * ## Directly callable (rule 32)
 *
 * `lockDecision` takes the recorded lock, the clock and a liveness predicate,
 * and returns a decision. It touches no filesystem, so a planted case can put it
 * in every state — held, stale, corrupt, absent — without spawning a process.
 */

const LOCK_PATH = join(tmpdir(), 'worldpulse-measuring.lock');

/**
 * @typedef {object} LockRecord
 * @property {number} pid
 * @property {string} kind   'mutate' | 'verify' | anything a caller names
 * @property {string} startedAt  ISO
 * @property {string} [commit]
 */

/**
 * @param {{ existing: LockRecord | null, now: number, isAlive: (pid: number) => boolean, kind: string }} input
 * @returns {{ proceed: true, replacing: LockRecord | null } | { proceed: false, reason: string }}
 */
export function lockDecision({ existing, now, isAlive, kind }) {
  if (!existing) return { proceed: true, replacing: null };

  // A lock naming a process that no longer exists is debris, not a claim. Runs
  // get killed — container restarts, timeouts, Ctrl-C — and a lock that
  // outlived its process must never be able to block the machine forever.
  if (!isAlive(existing.pid)) return { proceed: true, replacing: existing };

  const ageMs = Math.max(0, now - Date.parse(existing.startedAt));
  const age = Number.isNaN(ageMs) ? 'unknown' : `${Math.round(ageMs / 60_000)} min`;

  return {
    proceed: false,
    reason:
      `another measuring run is already in progress on this machine: ` +
      `${existing.kind} (pid ${existing.pid}), started ${age} ago` +
      (existing.commit ? ` on ${existing.commit}` : '') +
      `.\n\n` +
      `Two runs sharing a machine contend for CPU, and every duration either one records then ` +
      `describes a contended box rather than the app (TESTING.md rule 20a). Verdicts would survive ` +
      `that; timings would not.\n\n` +
      `Wait for it, or stop it and re-run:\n\n  kill ${existing.pid}\n\n` +
      `If it is already gone, this lock is stale and will be taken over automatically — ` +
      `re-running is enough.`,
  };
}

/** A lock file that cannot be parsed is debris, exactly like a dead pid. */
export function readLock(path = LOCK_PATH) {
  try {
    if (!existsSync(path)) return null;
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof record?.pid !== 'number' || typeof record?.startedAt !== 'string') return null;
    return record;
  } catch {
    return null;
  }
}

export function processIsAlive(pid) {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else — still alive.
    return error?.code === 'EPERM';
  }
}

/**
 * Take the lock or throw. Returns a release function.
 *
 * The release is registered on `exit` as well as being returned, because the
 * failure this guards against is precisely a run that ended without cleaning up
 * after itself.
 */
export function acquireRunLock(kind, commit, path = LOCK_PATH, options = {}) {
  const decision = lockDecision({
    existing: readLock(path),
    now: Date.now(),
    isAlive: processIsAlive,
    kind,
  });

  if (!decision.proceed) throw new Error(decision.reason);

  if (decision.replacing) {
    console.log(
      `note: took over a stale lock from ${decision.replacing.kind} (pid ${decision.replacing.pid}), which is no longer running`,
    );
  }

  const record = { pid: process.pid, kind, startedAt: new Date().toISOString(), commit };
  writeFileSync(path, JSON.stringify(record, null, 2));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      // Only remove OUR lock: a run that overran and was taken over must not
      // delete the lock now held by the run that replaced it.
      const current = readLock(path);
      if (current?.pid === process.pid) unlinkSync(path);
    } catch {
      // A lock we cannot remove is stale-but-harmless: the next run sees a dead
      // pid and takes it over.
    }
  };

  process.on('exit', release);

  /**
   * Exiting on a signal is OPT-OUT, and the opt-out is load-bearing.
   *
   * Node runs every registered signal listener. A caller with its own async
   * teardown — `mutation-check.mjs` removes a git worktree and waits for a
   * preview port to close — registers first; if this handler then calls
   * `process.exit` synchronously, the process dies before that teardown can
   * finish. That is not hypothetical: it leaked a worktree the first time this
   * lock met a SIGTERM, and the harness's own comment ("a signal-killed run must
   * still take its worktree with it") was correct about its intent and wrong
   * about the outcome, because of a handler added later in a different file.
   *
   * So a caller that cleans up asynchronously passes `exitOnSignal: false` and
   * keeps responsibility for exiting. A caller with nothing to clean up leaves
   * the default, because installing a signal listener at all suppresses Node's
   * default termination — without this the process would ignore Ctrl-C.
   */
  if (options.exitOnSignal !== false) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        release();
        process.exit(130);
      });
    }
  } else {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      // Release the lock, then stand aside: whoever owns cleanup owns the exit.
      process.on(signal, release);
    }
  }

  return release;
}

export { LOCK_PATH };
