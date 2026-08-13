/**
 * Refuse to measure a tree that is not what the branch says it is.
 *
 * ## Why this runs before every mutation and verify run
 *
 * Two agents worked the same branch from different machines. The benign version
 * of that is caught for you: the loser's `git push` is rejected and somebody has
 * to look. The dangerous version is silent — the timings differ by minutes, the
 * second writer's commits land, and the first writer goes on measuring a tree
 * that is **two commits behind the branch**, then reports a green table for code
 * that is not on the branch.
 *
 * That happened here. A mutation run spent its time on `18cd64a` while origin had
 * moved to `a9a0994`. Nothing in the harness noticed, because nothing was wrong
 * with the tree it was given — it was clean, it built, and it would have produced
 * a table. The table would simply have described the wrong software.
 *
 * A rejected push catches it only if you have something to push. A reader of the
 * table has no way to tell.
 *
 * ## Shape
 *
 * An assertion that runs regardless, at startup, like `requireCleanCheckout` —
 * not cleanup at exit. A check that only runs when someone remembers is a check
 * that eventually does not run (the same argument that moved the unexercised-path
 * sweep into the deploy gate).
 *
 * Pure, per rule 32: the caller does the git I/O and passes the three facts in.
 */

/**
 * @param {{localHead: string, remoteHead: string | null, branch: string, ahead: number, behind: number}} state
 * @returns {string | null} the problem, or null when the tree may be measured
 */
export function freshnessProblem({ localHead, remoteHead, branch, ahead, behind }) {
  if (remoteHead === null) {
    /**
     * No tracking branch is NOT a failure. A local-only branch is a legitimate
     * way to work, and refusing here would block the offline case to catch the
     * concurrent-writer case. Rule 30's shape: no answer about the remote is not
     * an answer that the remote disagrees.
     */
    return null;
  }

  if (behind > 0 && ahead > 0) {
    return (
      `${branch} has diverged from origin: ${ahead} local commit(s), ${behind} remote commit(s).\n` +
      `  local  ${localHead}\n  origin ${remoteHead}\n` +
      'Another writer has pushed to this branch. Reconcile before measuring — a table\n' +
      'produced now describes neither tree.'
    );
  }

  if (behind > 0) {
    return (
      `${branch} is ${behind} commit(s) behind origin.\n` +
      `  local  ${localHead}\n  origin ${remoteHead}\n` +
      'Another writer has pushed to this branch. Anything measured now describes code\n' +
      'that is not on the branch, and the result will read as if it does.\n' +
      'Fast-forward first: git merge --ff-only origin/' +
      branch
    );
  }

  /**
   * Ahead-only is allowed, deliberately.
   *
   * Local commits that are not yet pushed are the normal state during work, and
   * the mutation harness explicitly measures HEAD rather than origin. Blocking
   * here would make the harness unusable for its main purpose.
   */
  return null;
}

/**
 * Read the three facts from git. The only impure part, kept separate so
 * `freshnessProblem` can be planted-cased without a repository.
 *
 * Deliberately does NOT fetch. A harness that reaches the network before every
 * run is a harness that fails when the network does, and the check is about
 * agreeing with what this clone last saw. `git fetch` is the operator's call —
 * which is why the message names it.
 *
 * @param {(args: string[]) => Promise<string>} runGit
 */
export async function readBranchState(runGit) {
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const localHead = (await runGit(['rev-parse', '--short', 'HEAD'])).trim();

  let remoteHead = null;
  let ahead = 0;
  let behind = 0;
  try {
    remoteHead = (await runGit(['rev-parse', '--short', '@{u}'])).trim();
    const counts = (await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])).trim();
    const [aheadRaw, behindRaw] = counts.split(/\s+/);
    ahead = Number(aheadRaw ?? 0);
    behind = Number(behindRaw ?? 0);
  } catch {
    // No upstream configured. Handled as "no answer", not as disagreement.
    remoteHead = null;
  }

  return { localHead, remoteHead, branch, ahead, behind };
}
