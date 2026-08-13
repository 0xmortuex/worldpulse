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
