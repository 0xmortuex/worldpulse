import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lockDecision, type LockRecord } from '../scripts/run-lock.mjs';

/**
 * Planted cases for the concurrency guard (rules 27 and 32).
 *
 * This guard exists because a previous session's timing data was collected
 * while three abandoned background runs competed for the machine, unnoticed.
 * Every state below is reachable here without spawning a process.
 */
const held: LockRecord = {
  pid: 4242,
  kind: 'mutate',
  startedAt: '2026-08-13T12:00:00.000Z',
  commit: 'abc1234',
};
const now = Date.parse('2026-08-13T12:20:00.000Z');
const alive = () => true;
const dead = () => false;

describe('run lock', () => {
  it('proceeds when nothing holds the lock', () => {
    const decision = lockDecision({ existing: null, now, isAlive: alive, kind: 'mutate' });
    assert.equal(decision.proceed, true);
  });

  it('REFUSES while another run is live, naming it and how long it has been going', () => {
    const decision = lockDecision({ existing: held, now, isAlive: alive, kind: 'mutate' });
    assert.equal(decision.proceed, false);
    if (decision.proceed) return;
    assert.match(decision.reason, /pid 4242/);
    assert.match(decision.reason, /20 min ago/);
    assert.match(decision.reason, /kill 4242/, 'the refusal must say how to clear it, not just that it is blocked');
  });

  it('refuses a run of a different kind too — contention is contention', () => {
    // A verify run competing with a mutation run is the same problem. Keying the
    // lock on kind would have permitted exactly the mix that produced the bad
    // timing data.
    const decision = lockDecision({ existing: held, now, isAlive: alive, kind: 'verify' });
    assert.equal(decision.proceed, false);
  });

  it('takes over a lock whose process is gone, rather than blocking forever', () => {
    // Runs get killed: container restarts, timeouts, Ctrl-C. A lock that
    // outlived its process must never wedge the machine.
    const decision = lockDecision({ existing: held, now, isAlive: dead, kind: 'mutate' });
    assert.equal(decision.proceed, true);
    assert.equal(decision.proceed === true && decision.replacing?.pid, 4242);
  });

  it('explains why the timing, not the verdicts, is what contention ruins', () => {
    const decision = lockDecision({ existing: held, now, isAlive: alive, kind: 'mutate' });
    assert.match(decision.proceed === false ? decision.reason : '', /rule 20a/);
  });

  it('does not choke on an unparseable start time', () => {
    const decision = lockDecision({
      existing: { ...held, startedAt: 'not a date' },
      now,
      isAlive: alive,
      kind: 'mutate',
    });
    assert.equal(decision.proceed, false);
    assert.match(decision.proceed === false ? decision.reason : '', /unknown ago/);
  });
});

describe('signal handling does not cut short a caller with its own teardown', () => {
  it('registers no exiting signal handler when exitOnSignal is false', async () => {
    // Node runs EVERY signal listener. A lock handler that calls process.exit
    // synchronously kills the process before an async teardown registered
    // earlier can finish — which is how a git worktree got leaked the first time
    // this lock met a SIGTERM.
    const { acquireRunLock } = await import('../scripts/run-lock.mjs');
    const path = `${process.env['TMPDIR'] ?? '/tmp'}/worldpulse-locktest-${process.pid}.lock`;

    const before = process.listenerCount('SIGTERM');
    const release = acquireRunLock('test', 'commit', path, { exitOnSignal: false });
    const added = process.listeners('SIGTERM').slice(before);
    try {
      assert.equal(added.length, 1, 'expected exactly one SIGTERM listener from the lock');
      assert.doesNotMatch(
        String(added[0]),
        /process\.exit/,
        'the lock installed an exiting handler despite exitOnSignal: false',
      );
    } finally {
      for (const listener of added) process.removeListener('SIGTERM', listener as never);
      release();
    }
  });
});
