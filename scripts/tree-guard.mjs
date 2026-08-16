/**
 * The lock protects the measurement's TREE, not just its CPU.
 *
 * ## Why this exists, and why a written-down lesson was not enough
 *
 * Two mutation runs were voided in one session by edits made to the tracked
 * tree while they measured. The second happened AFTER the first was recorded in
 * `FOUND.md`, promoted to a lesson, and restated — in the same breath as "I am
 * leaving the tree untouched".
 *
 * That is this project's own recurring proof: **a recorded lesson without a
 * mechanism does not hold.** The shell tally needed rule 41 to stop happening;
 * reading a green summary over a red failure line needed rule 44's ban on
 * piping a gate. This needed the same treatment.
 *
 * ## What was wrong with the old guard
 *
 * `requireCleanCheckout` runs at exactly two points — before starting and after
 * finishing. It is a FRESHNESS check: it proves, afterwards, whether the result
 * can be trusted. It cannot prevent anything, and it delivers its verdict
 * twenty minutes after the damage, when the only remaining option is to discard
 * the whole run.
 *
 * This closes that window. The tree is sampled every second while the lock is
 * held, so a stray write costs **one second of measurement instead of twenty
 * minutes** — and it says so immediately, while the person who made the edit
 * still remembers making it.
 *
 * ## The specific habit it defends against
 *
 * Not carelessness. **A long background job makes the repository feel free**,
 * because the work is happening elsewhere. Both leaks were documentation — work
 * that feels like paperwork rather than like touching the code under test.
 * `--untracked-files=no` is deliberate for the same reason the harness uses it:
 * a new file is invisible to the measurement, and only edits to TRACKED files
 * can change what is being measured.
 */
import { execFileSync } from 'node:child_process';
import { readLock, processIsAlive } from './run-lock.mjs';

const SAMPLE_MS = 1000;

function trackedDirt(root) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    // A git failure is not evidence the tree is clean, and it is not evidence
    // it is dirty either. Rule 3: report the inconclusive case rather than
    // resolving it in whichever direction is convenient.
    return null;
  }
}

/**
 * Watch until the lock is released, the run dies, or the tree changes.
 *
 * Exported as a pure-ish function so a test can drive it without a real run —
 * rule 32: a guard reachable only through a twenty-minute harness is a guard
 * nobody has tested.
 */
export function guardDecision({ lock, dirt, alive }) {
  if (!lock) return { stop: true, reason: 'no run lock held — nothing to guard' };
  if (!alive) return { stop: true, reason: `run pid ${lock.pid} is no longer alive` };
  if (dirt === null) return { stop: false, reason: null };
  if (dirt !== '') {
    return {
      stop: true,
      violation: true,
      reason:
        `TRACKED TREE MODIFIED WHILE ${lock.kind} WAS MEASURING ${lock.commit}\n\n${dirt}\n\n` +
        'The run is no longer measuring one tree, so its result would be unusable. Killing it ' +
        'now costs seconds; discovering this at the freshness check costs the whole run.\n' +
        'Commit or stash the change, then re-run on a verified-clean checkout.',
    };
  }
  return { stop: false, reason: null };
}

export async function watch(root, { onViolation } = {}) {
  for (;;) {
    const lock = readLock();
    const decision = guardDecision({
      lock,
      dirt: lock ? trackedDirt(root) : '',
      alive: lock ? processIsAlive(lock.pid) : false,
    });

    if (decision.stop) {
      if (decision.violation) {
        console.error(`\n${decision.reason}\n`);
        /**
         * Killing the run is the point. Letting it continue would spend
         * nineteen more minutes producing a table the harness will refuse to
         * stand behind anyway — and a table that LOOKS complete is worse than
         * no table, because someone will read it.
         */
        if (lock && onViolation !== false) {
          try {
            process.kill(lock.pid, 'SIGTERM');
            console.error(`sent SIGTERM to ${lock.kind} (pid ${lock.pid})`);
          } catch {
            console.error(`could not signal pid ${lock.pid}; stop it by hand`);
          }
        }
        process.exitCode = 1;
      } else {
        console.log(decision.reason);
      }
      return decision;
    }

    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }
}

if (import.meta.filename === process.argv[1]) {
  await watch(process.cwd());
}
