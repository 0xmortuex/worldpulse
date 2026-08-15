/**
 * Prove the browser suite can fail.
 *
 * A suite that has never been observed failing is the same category of artifact
 * as a stale bundle: it produces a green result whether or not the feature
 * works. The layout self-test and the planted fact-discipline violation were
 * doing this ad hoc for two checks; this does it systematically, one mutation
 * per step, targeting that step's most load-bearing assertion.
 *
 * MUTATIONS NEVER TOUCH THE PRIMARY CHECKOUT. An earlier version edited real
 * source in place and restored it in a `finally`, which is fine right up until
 * the process does not get to run its `finally` — a crash, a timeout, a SIGKILL
 * — and then broken source is left sitting in the working tree with nothing to
 * put it back. That is not theoretical: killing this script mid-run left a
 * mutated `src/ui/government.ts` behind, which is what prompted this rewrite.
 *
 * So each run builds a detached git worktree from HEAD, mutates THAT, serves it
 * on its own port, and removes it on every exit path including signals. The
 * primary checkout is asserted clean before and after; the whole point is that
 * an interrupted run costs a temp directory and nothing else.
 *
 * Because the worktree is built from HEAD, this measures the committed tree.
 * Uncommitted work is not under test — which is why a dirty checkout is an
 * error rather than something to paper over.
 *
 * Usage: node scripts/mutation-check.mjs [--only <step-substring>]
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { INCONCLUSIVE, anchorProblem, classifyMutation, failingLabels } from './mutation-verdict.mjs';
import { freshnessProblem, readBranchState } from './branch-freshness.mjs';
import { acquireRunLock } from './run-lock.mjs';
import { glLabel } from './gl-config.mjs';
import { planFrom } from './mutation-journal.mjs';
import { appendFileSync, readFileSync as readSync } from 'node:fs';

/**
 * Verdicts are journalled as they land, so a reboot costs one mutation instead
 * of all of them. Outside /tmp deliberately — /tmp is what the reboot wiped.
 */
const journalPath = () => resolve(ROOT, '.mutation-journal.jsonl');

function readJournal() {
  try {
    return readSync(journalPath(), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          // A half-written line is what a kill mid-append looks like. Skipping
          // it costs one mutation; refusing to parse the file costs all of them.
          return null;
        }
      })
      .filter((entry) => entry !== null);
  } catch {
    return [];
  }
}

function journal(entry) {
  try {
    appendFileSync(journalPath(), `${JSON.stringify(entry)}\n`);
  } catch {
    // A journal we cannot write is a slower resume, not a wrong result.
  }
}
import { cpus, loadavg, totalmem } from 'node:os';

/**
 * The machine and harness this run measured under (rule 20a).
 *
 * Recorded because a duration is a property of the app UNDER A CONFIGURATION,
 * and a table of times with no configuration beside it is a number nobody can
 * compare against anything. The previous timing data on this project was
 * collected under unnoticed contention from three abandoned background runs,
 * which is exactly what this block plus the run lock exist to make visible.
 */
function machineProfile() {
  const cores = cpus();
  return {
    cores: cores.length,
    cpu: cores[0]?.model?.trim() ?? 'unknown',
    memGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    loadAvg1: loadavg()[0]?.toFixed(2) ?? '?',
    // The REQUESTED renderer. What was actually got is printed per-run by
    // verify-render, which asks the live context — this label is a request, and
    // labelling a run by its request is how "hardware GL" came to mean
    // SwiftShader for four sessions.
    rasteriser: `${glLabel()} (requested)`,
    chromium: process.env['PLAYWRIGHT_CHROMIUM_PATH'] ?? "playwright's own build",
  };
}

const run = promisify(execFile);

/**
 * The reason the harness gave for dying, when it died. Reported instead of the
 * app assertions precisely because there are none to report — an unset
 * PLAYWRIGHT_CHROMIUM_PATH should say so, not leave the reader to guess why a
 * mutation went unclassified.
 */
function firstHarnessFailure(out) {
  return failingLabels(out).find((label) => label.startsWith('harness'));
}
const ROOT = resolve(import.meta.dirname, '..');

/**
 * A hung run is already a failure signal; it does not need to be waited out.
 *
 * But the limit has to clear a HEALTHY run by a wide margin, or it reports
 * TIMEOUT for a suite that is merely slow — a false failure, which misleads in
 * exactly the way a false pass does. 480s was calibrated on a Linux box where a
 * full verify took about five minutes; on a software-rendered Windows machine a
 * healthy run exceeds ten, and the layout mutation was reported as hung when it
 * was working correctly.
 *
 * So: generous by default, overridable, and still bounded — the point is to
 * catch a run that will never finish, not to race the machine.
 */
const BUILD_TIMEOUT_MS = Number(process.env['MUTATE_BUILD_TIMEOUT_MS'] ?? 300_000);
const VERIFY_TIMEOUT_MS = Number(process.env['MUTATE_VERIFY_TIMEOUT_MS'] ?? 1_800_000);
const PORT = 4273;

/**
 * Each mutation names the step it covers, the edit, and the assertion whose
 * failure is required.
 *
 * `expect` is matched against the FAILING check labels, so a mutation that
 * breaks the app in some other visible way — turning the whole page blank, say —
 * does not count as proof that this particular assertion works. The check that
 * is supposed to catch it has to be the one that fires.
 */
const MUTATIONS = [
  {
    step: '1 — globe, selection, relations',
    what: 'relations scoring returns neutral for every pair',
    nonVacuity:
      'Relations classification is computed in exactly one place; no other module assigns ally/adversary. A panel could still render, so nothing else turns the classification wrong into a visible failure.',
    file: 'src/relations/score.ts',
    from: '  const tier = resolveTier(total, thresholds);',
    to: '  const tier = resolveTier(0, thresholds);',
    expect: /classif|ally|adversar|tier/i,
  },
  {
    step: '2 — confidence badges, provenance inspector',
    what: 'the inspector stops surfacing the request URL',
    nonVacuity:
      'The request URL reaches the DOM only through the inspector own markup. No badge, tooltip or panel renders it, so the assertion cannot fail by any other route.',
    file: 'src/facts/inspector.ts',
    /**
     * Anchored on the SUCCESSFUL-fetch block, which is the one step 2 inspects.
     *
     * The anchor was `escapeHtml(provenance.requestUrl)`, which became ambiguous
     * the moment a `fetch-failed` branch was added above it — and since the edit
     * takes the first occurrence, the mutation moved to a block the browser suite
     * never opens. It kept reporting a verdict while testing nothing.
     */
    from:
      '      <dt>URL</dt><dd><code class="inspector-url">${escapeHtml(provenance.requestUrl)}</code></dd>\n' +
      '      <dt>HTTP</dt><dd>${provenance.httpStatus}</dd>',
    to:
      '      <dt>URL</dt><dd><code class="inspector-url"></code></dd>\n' +
      '      <dt>HTTP</dt><dd>${provenance.httpStatus}</dd>',
    expect: /request url/i,
  },
  {
    step: '3 — dossier header, leader resolution',
    what: 'the de-facto-authority branch reports the wrong resolution rule',
    nonVacuity:
      'Only resolve.ts names which rule fired, and the three checks matching /rule/ are all step-3 resolution checks. Verified: no other check label in the suite contains the word.',
    file: 'src/dossier/resolve.ts',
    from: "ruleLabel: 'Rule 1 — de facto authority above the formal head of state',",
    to: "ruleLabel: 'Rule 7 — de facto authority above the formal head of state',",
    expect: /rule/i,
  },
  {
    step: '4 — government tab',
    what: 'vacant cabinet posts stop being counted',
    nonVacuity:
      'The vacancy count is derived in government.ts alone. The posts still render, so the row count is unchanged and only the counted total moves.',
    file: 'src/ui/government.ts',
    from: "n(cabinet.vacantCount, 'count of positions rendered below with no officeholder; each row shows its own state')",
    to: "n(0, 'count of positions rendered below with no officeholder; each row shows its own state')",
    expect: /vacanc|officeholder/i,
  },
  {
    step: '5 — economy tab',
    what: 'a gap in a series is bridged instead of breaking the line',
    nonVacuity:
      'Segment splitting happens only in chart.ts. The values, axis and badges are untouched, so a failure can only come from the path geometry.',
    file: 'src/economy/chart.ts',
    from: '    if (point.value === null) {',
    to: '    if (false) {',
    expect: /gap|segment/i,
  },
  {
    // Re-pointed when the sentiment timeline was removed with GDELT (decision
    // 11b). V5 requires a mutation per step, so step 6 keeps one — aimed now at
    // the syndication grouping, the news tab's other derived behaviour.
    step: '6 — news tab',
    what: 'syndicated copies stop collapsing, so one story reads as many',
    nonVacuity:
      'Grouping lives only in news-text.ts. Every article still parses and renders, so nothing else changes the row count.',
    file: 'src/sources/news-text.ts',
    from: 'export function groupSyndicated(articles: readonly Article[]): ArticleGroup[] {',
    to: 'export function groupSyndicated(articles: readonly Article[]): ArticleGroup[] {\n  return articles.map((a) => ({ lead: a, outlets: [a.domain], copies: 1 }));',
    expect: /syndicat|outlet/i,
  },
  {
    step: '7 — globe event layers',
    what: 'back-facing markers become pickable through the planet',
    nonVacuity:
      'The occlusion test is the only thing preventing a far-side pick; the marker is present in the scene either way. The assertion aims at a point behind the globe, which no other guard filters.',
    file: 'src/globe.ts',
    from: 'return cosAngle > horizon;',
    to: 'return true;',
    expect: /occlusion|behind the globe|far side/i,
  },
  {
    /**
     * `degraded` collapsing into `ok`.
     *
     * The state most likely to be skipped and the one whose loss is silent: a
     * panel showing two of three indicators would look exactly like a panel
     * showing three, with no marker and no shortfall line. Nothing about the
     * remaining values is wrong, which is precisely why nothing else catches it.
     */
    step: '7b — economy fetch states',
    what: 'a partially-answered panel reports itself complete',
    nonVacuity:
      'panelStateFor is the only computation of the panel marker, and the shortfall line is rendered from the same result. The answered indicators still render correctly, so nothing else distinguishes partial from complete.',
    file: 'src/economy/panel-state.ts',
    from: '  if (failed > 0 || unconfigured > 0) return \'degraded\';',
    to: '  if (false) return \'degraded\';',
    expect: /degraded|names what is missing/i,
  },
  {
    /**
     * The conflation the fifth fact state exists to prevent: a failed request
     * worded as the subject having no data. "No GDP data for this country" when
     * the truth is that we could not reach the World Bank.
     */
    step: '7b — economy fetch states',
    what: 'a failed request is worded as the country having no data',
    nonVacuity:
      'valueMarkup is the only place the absent-value wording is chosen, and the inspector shares it via absentValueWording. The badge, panel state and provenance are untouched, so only the wording moves.',
    file: 'src/facts/badge.ts',
    from: "      return '<span class=\"fact-value fact-value--unavailable\">source unavailable</span>';",
    to: "      return '<span class=\"fact-value fact-value--nodata\">no data</span>';",
    expect: /worded as the country having no data/i,
  },
  {
    step: 'cross-cutting — text fidelity (rule 9)',
    what: 'axis labels stop being compacted, so long values overflow the gutter',
    nonVacuity:
      'Compaction happens once, in series.ts. The chart geometry and the badged values are unchanged, so an overflow can only come from the label text.',
    file: 'src/economy/series.ts',
    from: "  if (spec.basis === 'ratio') return value.toFixed(Math.abs(value) >= 100 ? 0 : 1);",
    to: '  return String(value);',
    expect: /axis/i,
  },
  {
    step: 'cross-cutting — layout geometry (rule 8)',
    what: 'party legend rows collapse to zero height — present in the DOM, invisible on screen',
    nonVacuity:
      'The rows remain in the DOM with correct text, so every presence and text assertion still passes. Only the geometry check can see it, which is the point of the mutation.',
    file: 'src/styles.css',
    // A COLLAPSE, not an overlay. The first attempt laid the dossier portraits
    // over the title block, which made an overlapping element intercept pointer
    // events; a badge click in step 2 then timed out and the whole suite died
    // before the rule-8 assertions ran. The mutation was detected in the sense
    // that everything downstream broke, which proves nothing about whether the
    // layout checks can see a layout defect.
    //
    // A zero-height row intercepts nothing, so the run reaches the assertion —
    // and "present in the DOM but invisible" is the exact failure rule 8 exists
    // for, since every presence and text check still passes on it.
    from: '.party-legend li { display: flex; gap: 6px; align-items: center; padding: 1px 0; }',
    to: '.party-legend li { display: flex; gap: 6px; align-items: center; padding: 1px 0; height: 0; overflow: hidden; }',
    expect: /party legend/i,
  },
];

/**
 * Rule 34, enforced rather than trusted.
 *
 * A mutation without a written non-vacuity argument is one nobody has asked the
 * only question that makes its CAUGHT verdict mean anything: what ELSE would
 * produce this failure. Both a real catch and a vacuous one print the same word,
 * so the verdict cannot supply the answer.
 */
for (const mutation of MUTATIONS) {
  if (typeof mutation.nonVacuity !== 'string' || mutation.nonVacuity.trim().length < 40) {
    throw new Error(
      `mutation "${mutation.step} / ${mutation.what}" has no non-vacuity argument. ` +
        'State what behaviour the edit removes and why no other mechanism supplies it (TESTING.md rule 34).',
    );
  }
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/**
 * `--check-anchors`: validate every anchor against the working tree and exit.
 *
 * A full run is hours. Learning three hours in that an anchor went stale or
 * ambiguous — which is exactly what happened when a second
 * `escapeHtml(provenance.requestUrl)` appeared in the inspector — is a slow way
 * to be told something that takes milliseconds to check. Runs against the real
 * checkout rather than a worktree, since it writes nothing.
 */
if (process.argv.includes('--check-anchors')) {
  const { readFile: read } = await import('node:fs/promises');
  let bad = 0;
  for (const mutation of MUTATIONS) {
    const source = (await read(resolve(ROOT, mutation.file), 'utf8')).replace(/\r\n/g, '\n');
    const hits = source.split(mutation.from).length - 1;
    const state = hits === 1 ? 'ok' : hits === 0 ? 'STALE' : `AMBIGUOUS (${hits})`;
    if (hits !== 1) bad += 1;
    console.log(`  ${state.padEnd(16)} ${mutation.step} — ${mutation.file}`);
  }
  console.log(`\n${MUTATIONS.length} anchor(s), ${bad} unusable`);
  process.exit(bad === 0 ? 0 : 1);
}

/* ------------------------------------------------------- primary checkout */

async function trackedDirt() {
  const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT });
  return stdout.trim();
}

/**
 * The branch must be what origin says it is.
 *
 * Same shape as the clean-checkout assertion above and for the same reason: a
 * run that measured something other than what it reported is the failure this
 * harness exists to remove. Two agents on one branch produced exactly that —
 * a run spent an hour on a tree two commits behind origin, and nothing noticed,
 * because nothing was wrong with the tree it was handed.
 */
async function requireFreshBranch() {
  const state = await readBranchState(async (args) => (await run('git', args, { cwd: ROOT })).stdout);
  const problem = freshnessProblem(state);
  if (problem === null) return;
  console.error(`BRANCH IS NOT WHAT ORIGIN SAYS IT IS:\n\n  ${problem}\n`);
  process.exit(1);
}

async function requireCleanCheckout(when) {
  const dirt = await trackedDirt();
  if (dirt.length === 0) return;
  console.error(
    `PRIMARY CHECKOUT NOT CLEAN ${when}:\n${dirt}\n\n` +
      (when === 'before starting'
        ? 'Mutations run against HEAD in a throwaway worktree, so uncommitted work is not\n' +
          'under test. Commit or stash first — a run that silently measured something other\n' +
          'than what it reported is the failure this whole harness exists to remove.'
        : 'The worktree was supposed to absorb every write. Something leaked into the real\n' +
          'checkout — treat the results above as suspect and inspect the diff.'),
  );
  process.exit(1);
}

/* ------------------------------------------------------------- worktree */

let worktree = null;
let preview = null;
let cleaningUp = false;

async function teardown() {
  if (cleaningUp) return;
  cleaningUp = true;
  if (preview && preview.exitCode === null) {
    preview.kill('SIGKILL');
    // Wait for the socket to actually close. Returning before the port is free
    // makes the next run's preflight see a live server and refuse to start.
    for (let attempt = 0; attempt < 20 && preview.exitCode === null; attempt += 1) {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  if (worktree) {
    try {
      await run('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT });
    } catch {
      // The directory may already be gone; prune the registration either way so
      // a killed run does not leave a stale worktree entry behind.
      await rm(worktree, { recursive: true, force: true }).catch(() => {});
      await run('git', ['worktree', 'prune'], { cwd: ROOT }).catch(() => {});
    }
    // The worktree lives in a subdirectory of the mkdtemp root, so removing it
    // leaves the root behind — an empty directory per run, accumulating
    // silently. Cleanup that removes the thing it named and forgets what it
    // created around it is the same shape as killing a wrapper and leaving the
    // server running.
    await rm(dirname(worktree), { recursive: true, force: true }).catch(() => {});
    worktree = null;
  }
}

// Every exit path. A signal-killed run must still take its worktree with it —
// that is the entire reason this harness stopped editing the primary checkout.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    teardown().finally(() => process.exit(130));
  });
}
process.on('uncaughtException', (error) => {
  console.error(error);
  teardown().finally(() => process.exit(1));
});
process.on('exit', () => {
  // Best-effort synchronous backstop: async cleanup cannot run here, but the
  // handlers above cover every path that gets a chance to be asynchronous.
  if (worktree && existsSync(worktree)) {
    console.error(`\nworktree may remain at ${worktree} — run: git worktree prune`);
  }
});

async function makeWorktree() {
  const dir = await mkdtemp(join(tmpdir(), 'worldpulse-mutate-'));
  const path = join(dir, 'tree');
  await run('git', ['worktree', 'add', '--detach', path, 'HEAD'], { cwd: ROOT });
  worktree = path;

  // Linked rather than installed: a fresh npm install per run would dominate the
  // runtime, and the dependency tree is exactly the one under test.
  //
  // A junction on Windows, where creating a directory SYMLINK needs elevation or
  // developer mode — the harness died with EPERM before running a single
  // mutation. Junctions are directory-only and need neither.
  symlinkSync(
    join(ROOT, 'node_modules'),
    join(path, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return path;
}

/* ---------------------------------------------------------------- steps */

// The vite binary, run by node directly. `npx` is a .cmd on Windows and
// execFile cannot launch it without a shell — the harness reported "baseline
// build failed" with an empty reason, which is the same mistake the preview
// server made and the reason its detail now includes the message as well.
const viteBin = (cwd) => join(cwd, 'node_modules/vite/bin/vite.js');

async function build(cwd) {
  try {
    await run(process.execPath, [viteBin(cwd), 'build'], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      timeout: BUILD_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (error) {
    const detail = [error.message, error.stderr, error.stdout].filter(Boolean).join(' | ');
    return { ok: false, detail: (detail || String(error)).slice(0, 300) };
  }
}

async function verify(cwd) {
  try {
    const { stdout } = await run(process.execPath, ['scripts/verify-render.mjs', `http://localhost:${PORT}`], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      timeout: VERIFY_TIMEOUT_MS,
      // The parent already holds the machine-wide lock, and this child IS the
      // work it was taken for. Without this the very first mutation would
      // refuse to run, blocked by its own parent.
      env: { ...process.env, MUTATE_CHILD: '1' },
    });
    return { exit: 0, out: stdout, timedOut: false };
  } catch (error) {
    return {
      exit: error.code ?? 1,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      timedOut: error.killed === true || error.signal === 'SIGTERM',
    };
  }
}

/**
 * Serve the worktree's build.
 *
 * Spawned as the vite binary directly rather than through `npx`. Via npx the
 * thing this process can kill is the wrapper, and the actual server is its
 * grandchild — teardown killed the wrapper, the server kept running, and it held
 * the port after its worktree had been deleted. The next run then found a live
 * socket serving a directory that no longer existed and gave up. One process,
 * one kill.
 *
 * `--strictPort` so a taken port is an error rather than vite quietly serving
 * somewhere else, which is how the stale server stayed invisible.
 */
async function startPreview(cwd) {
  try {
    const response = await fetch(`http://localhost:${PORT}/`);
    throw new Error(
      `something is already serving port ${PORT} (HTTP ${response.status}). ` +
        'Refusing to start: the run could verify a build that is not the one it just made.',
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('something is already serving')) throw error;
    // Connection refused is the expected case — the port is free.
  }

  preview = spawn(
    process.execPath,
    [viteBin(cwd), 'preview', '--port', String(PORT), '--strictPort'],
    { cwd, stdio: 'ignore' },
  );

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (preview.exitCode !== null) throw new Error(`preview server exited immediately (code ${preview.exitCode})`);
    try {
      const response = await fetch(`http://localhost:${PORT}/`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`preview server never came up on ${PORT}`);
    await new Promise((done) => setTimeout(done, 500));
  }
}

/* ------------------------------------------------------------------ run */

const results = [];
let releaseLock = () => {};
const runStartedAt = Date.now();

try {
  const head = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })).stdout.trim();
  // exitOnSignal: false — this harness removes a worktree and waits for a port
  // to close on the way out, and a lock handler calling process.exit() would cut
  // that short. It leaked a worktree exactly once, which is how this was found.
  releaseLock = acquireRunLock('mutate', head, undefined, { exitOnSignal: false });

  const profile = machineProfile();
  console.log(
    `machine: ${profile.cores} cores, ${profile.cpu}, ${profile.memGb}GB, node ${profile.node}\n` +
      `harness: ${profile.rasteriser}, chromium ${profile.chromium}\n` +
      `load average at start: ${profile.loadAvg1}  (durations below describe THIS configuration — rule 20a)\n` +
      `measuring: ${head}\n`,
  );

  await requireCleanCheckout('before starting');
  await requireFreshBranch();
  const tree = await makeWorktree();
  console.log(`worktree: ${tree}\n`);

  const selected = only ? MUTATIONS.filter((mutation) => mutation.step.includes(only)) : MUTATIONS;
  const { pending, resumed } = planFrom(readJournal(), selected, head);

  if (resumed.length > 0) {
    console.log(
      `resuming: ${resumed.length} verdict(s) already recorded for ${head}, ${pending.length} to run\n` +
        resumed.map((entry) => `  reused  ${entry.step} — ${entry.verdict}`).join('\n') +
        '\n',
    );
    results.push(...resumed);
  }

  // Nothing to run means nothing to build. A resumed run that still spends two
  // minutes compiling a worktree it never mutates is a run people stop using.
  if (pending.length > 0) {
  const first = await build(tree);
  if (!first.ok) throw new Error(`baseline build failed in the worktree: ${first.detail}`);
  await startPreview(tree);
  } else {
    console.log('every mutation already has a verdict for this commit — nothing to build.\n');
  }

  for (const mutation of pending) {

    const path = join(tree, mutation.file);
    const onDisk = await readFile(path, 'utf8');

    /**
     * Anchors are written with `\n`; a Windows checkout has `\r\n`.
     *
     * Without this, every multi-line anchor reports STALE on Windows and single-
     * line anchors keep working — so the harness would silently lose exactly the
     * anchors that were narrowed to be unambiguous, which is the opposite of the
     * intended effect. The worktree is disposable and neither tsc nor vite cares
     * about line endings, so normalising the copy under test is free.
     */
    const original = onDisk.replace(/\r\n/g, '\n');

    /**
     * Both anchor failures are decided by `anchorProblem`, which is pure and
     * planted-cased. Inline, this logic could only be exercised by an hour-long
     * run — the same shape that let the classifier bug survive, and rule 32's
     * whole point.
     */
    const anchor = anchorProblem(original, mutation.from);
    if (anchor) {
      results.push({ ...mutation, verdict: anchor.kind, detail: `${anchor.detail} in ${mutation.file}` });
      console.log(
        `\n✗ ${mutation.step}\n  ${anchor.kind} — ${anchor.detail} in ${mutation.file}.` +
          (anchor.kind === 'AMBIGUOUS-ANCHOR'
            ? '\n  Narrow the anchor so it names the one behaviour under test (rule 34).'
            : ''),
      );
      continue;
    }

    console.log(`\n▸ ${mutation.step}\n  mutating: ${mutation.what}`);
    const startedAt = Date.now();

    try {
      // First occurrence only: a blanket replace can change more than the one
      // behaviour under test, and then a failure proves nothing specific.
      await writeFile(path, original.replace(mutation.from, mutation.to));

      const built = await build(tree);
      if (!built.ok) {
        // A mutation that does not build proves the compiler noticed, not that
        // the browser assertion can see the behaviour. Those are different
        // claims and scoring them the same would overstate the suite.
        results.push({ ...mutation, verdict: 'BUILD-FAILED', detail: built.detail, ms: Date.now() - startedAt });
        console.log('  BUILD-FAILED — the assertion was never exercised');
        continue;
      }

      const { exit, out, timedOut } = await verify(tree);
      if (timedOut) {
        results.push({ ...mutation, verdict: 'TIMEOUT', detail: `no verdict within ${VERIFY_TIMEOUT_MS / 1000}s`, ms: Date.now() - startedAt });
        console.log('  TIMEOUT — a hang is a failure signal, not a pass');
        continue;
      }

      // Classification lives in mutation-verdict.mjs so planted cases can drive
      // it (rule 27). It was inline here, and inline is why it scored a browser
      // that failed to launch as CAUGHT-ELSEWHERE for the whole of this step —
      // the only way to exercise the parser was to run the suite it belongs to.
      const { verdict, evidence, matched, assertions } = classifyMutation({ exit, out, expect: mutation.expect, step: mutation.step });

      let detail =
        verdict === 'NOT-EXERCISED'
          ? `${assertions ?? 'no'} assertions ran — ${(evidence[0] ?? firstHarnessFailure(out) ?? `exit ${exit}`).slice(0, 60)}`
          : (matched[0] ?? evidence[0] ?? `exit ${exit}, no failing check parsed`).slice(0, 90);
      if (verdict !== 'CAUGHT') {
        // Keep the evidence. Diagnosing a surprising verdict by re-running the
        // whole suite is how a surprising verdict gets waved through instead.
        const dump = join(tmpdir(), `mutation-${verdict.toLowerCase()}-${mutation.file.replace(/\W+/g, '-')}.log`);
        await writeFile(dump, out);
        detail += ` [output: ${dump}]`;
      }

      const entry = { ...mutation, verdict, detail, ms: Date.now() - startedAt };
      results.push(entry);
      journal({ commit: head, step: mutation.step, what: mutation.what, verdict, detail, ms: entry.ms });
      console.log(
        verdict === 'NOT-EXERCISED'
          ? `  NOT-EXERCISED — ${detail}`
          : `  ${verdict}: ${evidence.length} check(s) failed${matched.length > 0 ? `, incl. "${matched[0]}"` : ''}`,
      );
    } finally {
      // Restore the bytes that were there, not the normalised copy, so a
      // Windows worktree is left exactly as the checkout produced it.
      await writeFile(path, onDisk);
    }
  }
} finally {
  await teardown();
  releaseLock();
}

await requireCleanCheckout('after finishing');

console.log('\nmutation results');
const width = Math.max(...results.map((entry) => entry.step.length), 4);
console.log(`  ${'step'.padEnd(width)}  ${'time'.padStart(6)}  verdict`);
for (const entry of results) {
  const time = entry.ms === undefined ? '     -' : `${(entry.ms / 1000).toFixed(0)}s`.padStart(6);
  console.log(`  ${entry.step.padEnd(width)}  ${time}  ${entry.verdict} — ${entry.detail}`);
}

/**
 * The distribution, not just the total.
 *
 * A mean alone hides the case that matters: one mutation taking four times the
 * median is the signal that something about THAT step is slow, and it is
 * invisible in a total. Reported because the reason a wrong estimate went
 * unchallenged for an hour is that the harness recorded verdicts and never
 * recorded time.
 */
const timed = results.filter((entry) => typeof entry.ms === 'number').map((entry) => entry.ms);
if (timed.length > 0) {
  const sorted = [...timed].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const seconds = (ms) => `${(ms / 1000).toFixed(0)}s`;
  const end = machineProfile();
  console.log(
    `\ntiming — ${timed.length} mutation(s) over ${seconds(Date.now() - runStartedAt)} wall clock\n` +
      `  fastest ${seconds(sorted[0])} · median ${seconds(at(0.5))} · slowest ${seconds(sorted[sorted.length - 1])}\n` +
      `  load average: ${end.loadAvg1} at finish, on ${end.cores} cores, ${end.rasteriser}\n` +
      `  measured under the run lock, so nothing else was measuring on this machine (rule 20a).`,
  );
}

const inconclusive = results.filter((entry) => INCONCLUSIVE.includes(entry.verdict));
console.log(
  `\n${results.length} mutation(s): ` +
    `${results.filter((e) => e.verdict === 'CAUGHT').length} caught by the named assertion, ` +
    `${results.filter((e) => e.verdict === 'CAUGHT-ELSEWHERE').length} caught elsewhere, ` +
    `${results.filter((e) => e.verdict === 'SURVIVED').length} SURVIVED, ` +
    // Counted off the same list that gates the exit code. These were two
    // independent literals, and CAUGHT-ELSEWHERE being absent from the gating
    // one is exactly how a run with zero executed assertions exited clean.
    `${results.filter((e) => e.verdict !== 'SURVIVED' && INCONCLUSIVE.includes(e.verdict)).length} inconclusive`,
);
if (inconclusive.length > 0) {
  console.log('\nNot proof that the suite can see these behaviours:');
  for (const entry of inconclusive) console.log(`  - [${entry.verdict}] ${entry.step}: ${entry.what}`);
}
process.exit(inconclusive.length === 0 ? 0 : 1);
