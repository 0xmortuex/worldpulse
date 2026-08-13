import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { freshnessProblem, readBranchState } from '../scripts/branch-freshness.mjs';

/**
 * Planted cases for the branch-freshness assertion (rules 27 and 32).
 *
 * Two agents worked this branch from different machines. The benign version of
 * that is caught for you — the loser's push is rejected and someone looks. The
 * dangerous version is silent: the second writer's commits land, and the first
 * goes on measuring a tree two commits behind the branch, then reports a green
 * table for code that is not on the branch.
 *
 * That is what happened, and nothing noticed, because nothing was wrong with the
 * tree the harness was handed. It was clean, it built, and it would have produced
 * a table describing the wrong software.
 */
const state = (over: Partial<Parameters<typeof freshnessProblem>[0]> = {}): Parameters<typeof freshnessProblem>[0] => ({
  localHead: '18cd64a',
  remoteHead: 'a9a0994',
  branch: 'claude/worldpulse-globe-dashboard',
  ahead: 0,
  behind: 0,
  ...over,
});

describe('branch freshness', () => {
  it('allows a branch level with origin', () => {
    assert.equal(freshnessProblem(state()), null);
  });

  it('REFUSES a branch behind origin, and names both heads', () => {
    // The exact case that occurred: behind 2, ahead 0.
    const problem = freshnessProblem(state({ behind: 2 }));
    assert.ok(problem, 'a run was allowed to measure a tree two commits behind the branch');
    assert.match(problem, /2 commit\(s\) behind/);
    assert.match(problem, /18cd64a/);
    assert.match(problem, /a9a0994/);
    assert.match(problem, /git merge --ff-only/, 'the message must say how to fix it');
  });

  it('REFUSES a diverged branch and says neither tree is what would be measured', () => {
    const problem = freshnessProblem(state({ ahead: 1, behind: 2 }));
    assert.match(problem ?? '', /diverged/);
    assert.match(problem ?? '', /describes neither tree/);
  });

  it('ALLOWS ahead-only, because that is the harness working normally', () => {
    // The mutation harness measures HEAD deliberately. Blocking unpushed local
    // commits would make it unusable for its main purpose.
    assert.equal(freshnessProblem(state({ ahead: 3, remoteHead: 'a9a0994' })), null);
  });

  it('ALLOWS a branch with no upstream rather than blocking offline work', () => {
    // Rule 30: no answer about the remote is not an answer that the remote
    // disagrees. Refusing here would block the offline case to catch the
    // concurrent-writer case.
    assert.equal(freshnessProblem(state({ remoteHead: null })), null);
  });

  it('reads ahead/behind from git output in the right order', () => {
    // `--left-right --count HEAD...@{u}` prints "<ahead> <behind>". Reversing
    // them would invert the whole check: a behind branch would read as ahead and
    // be allowed through, which is the failure mode this exists to stop.
    const responses: Record<string, string> = {
      'rev-parse --abbrev-ref HEAD': 'feature\n',
      'rev-parse --short HEAD': 'aaaaaaa\n',
      'rev-parse --short @{u}': 'bbbbbbb\n',
      'rev-list --left-right --count HEAD...@{u}': '0\t2\n',
    };
    return readBranchState(async (args: string[]) => {
      const key = args.join(' ');
      const value = responses[key];
      if (value === undefined) throw new Error(`unexpected git call: ${key}`);
      return value;
    }).then((result) => {
      assert.equal(result.ahead, 0);
      assert.equal(result.behind, 2);
      assert.ok(freshnessProblem(result), 'a behind branch was not refused');
    });
  });

  it('treats a missing upstream as no upstream rather than crashing', () => {
    return readBranchState(async (args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-parse --abbrev-ref HEAD') return 'solo\n';
      if (key === 'rev-parse --short HEAD') return 'aaaaaaa\n';
      throw new Error('no upstream configured');
    }).then((result) => {
      assert.equal(result.remoteHead, null);
      assert.equal(freshnessProblem(result), null);
    });
  });
});
