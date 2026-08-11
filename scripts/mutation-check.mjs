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

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

/** A hung run is already a failure signal; it does not need to be waited out. */
const BUILD_TIMEOUT_MS = 180_000;
const VERIFY_TIMEOUT_MS = 480_000;
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
    file: 'src/relations/score.ts',
    from: '  const tier = resolveTier(total, thresholds);',
    to: '  const tier = resolveTier(0, thresholds);',
    expect: /classif|ally|adversar|tier/i,
  },
  {
    step: '2 — confidence badges, provenance inspector',
    what: 'the inspector stops surfacing the request URL',
    file: 'src/facts/inspector.ts',
    from: 'escapeHtml(provenance.requestUrl)',
    to: "escapeHtml('')",
    expect: /request url/i,
  },
  {
    step: '3 — dossier header, leader resolution',
    what: 'the de-facto-authority branch reports the wrong resolution rule',
    file: 'src/dossier/resolve.ts',
    from: "ruleLabel: 'Rule 1 — de facto authority above the formal head of state',",
    to: "ruleLabel: 'Rule 7 — de facto authority above the formal head of state',",
    expect: /rule/i,
  },
  {
    step: '4 — government tab',
    what: 'vacant cabinet posts stop being counted',
    file: 'src/ui/government.ts',
    from: "n(cabinet.vacantCount, 'count of positions rendered below with no officeholder; each row shows its own state')",
    to: "n(0, 'count of positions rendered below with no officeholder; each row shows its own state')",
    expect: /vacanc|officeholder/i,
  },
  {
    step: '5 — economy tab',
    what: 'a gap in a series is bridged instead of breaking the line',
    file: 'src/economy/chart.ts',
    from: '    if (point.value === null) {',
    to: '    if (false) {',
    expect: /gap|segment/i,
  },
  {
    step: '6 — news tab',
    what: 'the derived tone loses its DERIVED badge',
    file: 'src/news/tone-chart.ts',
    from: '<span class="badge badge--derived">ƒ DERIVED</span>',
    to: '<span class="badge"></span>',
    expect: /derived|tone/i,
  },
  {
    step: '7 — globe event layers',
    what: 'back-facing markers become pickable through the planet',
    file: 'src/globe.ts',
    from: 'return cosAngle > horizon;',
    to: 'return true;',
    expect: /occlusion|behind the globe|far side/i,
  },
  {
    step: 'cross-cutting — text fidelity (rule 9)',
    what: 'axis labels stop being compacted, so long values overflow the gutter',
    file: 'src/economy/series.ts',
    from: "  if (spec.basis === 'ratio') return value.toFixed(Math.abs(value) >= 100 ? 0 : 1);",
    to: '  return String(value);',
    expect: /axis/i,
  },
  {
    step: 'cross-cutting — layout geometry (rule 8)',
    what: 'party legend rows collapse to zero height — present in the DOM, invisible on screen',
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

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/* ------------------------------------------------------- primary checkout */

async function trackedDirt() {
  const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT });
  return stdout.trim();
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

try {
  await requireCleanCheckout('before starting');
  const tree = await makeWorktree();
  console.log(`worktree: ${tree}\n`);

  const first = await build(tree);
  if (!first.ok) throw new Error(`baseline build failed in the worktree: ${first.detail}`);
  await startPreview(tree);

  for (const mutation of MUTATIONS) {
    if (only && !mutation.step.includes(only)) continue;

    const path = join(tree, mutation.file);
    const original = await readFile(path, 'utf8');

    if (!original.includes(mutation.from)) {
      results.push({ ...mutation, verdict: 'STALE', detail: `anchor not found: ${mutation.from.slice(0, 60)}` });
      console.log(`\n✗ ${mutation.step}\n  anchor not found in ${mutation.file}`);
      continue;
    }

    console.log(`\n▸ ${mutation.step}\n  mutating: ${mutation.what}`);

    try {
      // First occurrence only: a blanket replace can change more than the one
      // behaviour under test, and then a failure proves nothing specific.
      await writeFile(path, original.replace(mutation.from, mutation.to));

      const built = await build(tree);
      if (!built.ok) {
        // A mutation that does not build proves the compiler noticed, not that
        // the browser assertion can see the behaviour. Those are different
        // claims and scoring them the same would overstate the suite.
        results.push({ ...mutation, verdict: 'BUILD-FAILED', detail: built.detail });
        console.log('  BUILD-FAILED — the assertion was never exercised');
        continue;
      }

      const { exit, out, timedOut } = await verify(tree);
      if (timedOut) {
        results.push({ ...mutation, verdict: 'TIMEOUT', detail: `no verdict within ${VERIFY_TIMEOUT_MS / 1000}s` });
        console.log('  TIMEOUT — a hang is a failure signal, not a pass');
        continue;
      }

      const failedLabels = [...out.matchAll(/^ {2}FAIL (.+?)(?: \{|$)/gm)].map((match) => match[1].trim());
      // The layout self-test always "fails" by design; it is not evidence.
      const real = failedLabels.filter((label) => !label.startsWith('self-test'));
      const matched = real.filter((label) => mutation.expect.test(label));

      // A non-zero exit with nothing parsed is not a catch. The suite stopped
      // for a reason this parser cannot see — an early abort, or a skipped
      // check, both of which mean the assertion under test never rendered a
      // verdict. Calling that CAUGHT would be the same overstatement as calling
      // a build failure a catch.
      const verdict =
        exit === 0
          ? 'SURVIVED'
          : real.length === 0
            ? 'UNPARSED'
            : matched.length > 0
              ? 'CAUGHT'
              : 'CAUGHT-ELSEWHERE';

      let detail = (matched[0] ?? real[0] ?? `exit ${exit}, no failing check parsed`).slice(0, 90);
      if (verdict !== 'CAUGHT') {
        // Keep the evidence. Diagnosing a surprising verdict by re-running the
        // whole suite is how a surprising verdict gets waved through instead.
        const dump = join(tmpdir(), `mutation-${verdict.toLowerCase()}-${mutation.file.replace(/\W+/g, '-')}.log`);
        await writeFile(dump, out);
        detail += ` [output: ${dump}]`;
      }

      results.push({ ...mutation, verdict, detail });
      console.log(`  ${verdict}: ${real.length} check(s) failed${matched.length > 0 ? `, incl. "${matched[0]}"` : ''}`);
    } finally {
      await writeFile(path, original);
    }
  }
} finally {
  await teardown();
}

await requireCleanCheckout('after finishing');

console.log('\nmutation results');
const width = Math.max(...results.map((entry) => entry.step.length), 4);
console.log(`  ${'step'.padEnd(width)}  verdict`);
for (const entry of results) console.log(`  ${entry.step.padEnd(width)}  ${entry.verdict} — ${entry.detail}`);

const inconclusive = results.filter((entry) =>
  ['SURVIVED', 'STALE', 'BUILD-FAILED', 'TIMEOUT', 'UNPARSED'].includes(entry.verdict),
);
console.log(
  `\n${results.length} mutation(s): ` +
    `${results.filter((e) => e.verdict === 'CAUGHT').length} caught by the named assertion, ` +
    `${results.filter((e) => e.verdict === 'CAUGHT-ELSEWHERE').length} caught elsewhere, ` +
    `${results.filter((e) => e.verdict === 'SURVIVED').length} SURVIVED, ` +
    `${results.filter((e) => ['STALE', 'BUILD-FAILED', 'TIMEOUT', 'UNPARSED'].includes(e.verdict)).length} inconclusive`,
);
if (inconclusive.length > 0) {
  console.log('\nNot proof that the suite can see these behaviours:');
  for (const entry of inconclusive) console.log(`  - [${entry.verdict}] ${entry.step}: ${entry.what}`);
}
process.exit(inconclusive.length === 0 ? 0 : 1);
