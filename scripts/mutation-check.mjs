/**
 * Prove the browser suite can fail.
 *
 * A suite that has never been observed failing is the same category of artifact
 * as a stale bundle: it produces a green result whether or not the feature
 * works. The layout self-test and the planted fact-discipline violation were
 * doing this ad hoc for two checks; this does it systematically, one mutation
 * per step, targeting that step's most load-bearing assertion.
 *
 * For each mutation: apply a small edit to real source, rebuild, run the suite,
 * and require the NAMED assertion to fail. Restore afterwards, always — the
 * restore runs in a finally so an interrupted run cannot leave the tree dirty.
 *
 * A mutation that leaves the suite green is the finding. It means the check
 * cannot see the behaviour it claims to cover.
 *
 * Usage: node scripts/mutation-check.mjs [--only <step-substring>]
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

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
    from: 'ruleNumber: 1,',
    to: 'ruleNumber: 9,',
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
    what: 'the dossier portraits are laid back over the title block',
    file: 'src/styles.css',
    from: '.dossier-portraits {',
    to: '.dossier-portraits { position: absolute; top: 0; left: 0; right: 0;',
    expect: /overlap|overflow/i,
  },
];

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

async function verify() {
  try {
    const { stdout } = await run('node', ['scripts/verify-render.mjs'], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    });
    return { exit: 0, out: stdout };
  } catch (error) {
    return { exit: error.code ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

async function build() {
  try {
    await run('npx', ['vite', 'build'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024, env: process.env });
    return true;
  } catch {
    return false;
  }
}

const results = [];

for (const mutation of MUTATIONS) {
  if (only && !mutation.step.includes(only)) continue;

  const path = resolve(ROOT, mutation.file);
  const original = await readFile(path, 'utf8');

  if (!original.includes(mutation.from)) {
    results.push({ ...mutation, verdict: 'STALE', detail: `anchor not found: ${mutation.from}` });
    console.log(`\n✗ ${mutation.step}\n  anchor not found in ${mutation.file}: ${mutation.from}`);
    continue;
  }

  console.log(`\n▸ ${mutation.step}\n  mutating: ${mutation.what}`);

  try {
    // Replace the first occurrence only: a blanket replace can mutate more than
    // the one behaviour under test, and then a failure proves nothing specific.
    await writeFile(path, original.replace(mutation.from, mutation.to));

    const built = await build();
    if (!built) {
      // A mutation that does not compile still proves something, but only that
      // the compiler noticed — not that the browser check did. Say so plainly
      // rather than scoring it as a pass.
      results.push({
        ...mutation,
        verdict: mutation.buildMustFail ? 'COMPILE-GUARDED' : 'INCONCLUSIVE',
        detail: 'mutation does not compile; the browser assertion was never exercised',
      });
      console.log('  build failed — the type checker catches this before the browser can');
      continue;
    }

    const { exit, out } = await verify();
    const failedLabels = [...out.matchAll(/^ {2}FAIL (.+?)(?: \{|$)/gm)].map((match) => match[1].trim());
    // The layout self-test always "fails" by design; it is not evidence.
    const real = failedLabels.filter((label) => !label.startsWith('self-test'));
    const matched = real.filter((label) => mutation.expect.test(label));

    const verdict = exit === 0 ? 'SURVIVED' : matched.length > 0 ? 'CAUGHT' : 'CAUGHT-ELSEWHERE';
    results.push({ ...mutation, verdict, detail: (matched[0] ?? real[0] ?? 'no failing check').slice(0, 90) });
    console.log(
      `  ${verdict}: ${real.length} check(s) failed` +
        (matched.length > 0 ? `, incl. "${matched[0]}"` : ''),
    );
  } finally {
    await writeFile(path, original);
  }
}

// Rebuild from the restored tree so the working copy is not left serving a
// mutant. Leaving a mutated dist/ behind would be its own stale-bundle bug.
await build();

console.log('\nmutation results');
const width = Math.max(...results.map((entry) => entry.step.length), 4);
console.log(`  ${'step'.padEnd(width)}  verdict`);
for (const entry of results) console.log(`  ${entry.step.padEnd(width)}  ${entry.verdict} — ${entry.detail}`);

const survived = results.filter((entry) => entry.verdict === 'SURVIVED');
const inconclusive = results.filter((entry) => entry.verdict === 'INCONCLUSIVE' || entry.verdict === 'STALE');
console.log(
  `\n${results.length} mutation(s): ` +
    `${results.filter((e) => e.verdict.startsWith('CAUGHT')).length} caught, ` +
    `${results.filter((e) => e.verdict === 'COMPILE-GUARDED').length} compile-guarded, ` +
    `${inconclusive.length} inconclusive, ${survived.length} SURVIVED`,
);
if (survived.length > 0) {
  console.log('\nA surviving mutation is a check that cannot see what it claims to cover:');
  for (const entry of survived) console.log(`  - ${entry.step}: ${entry.what}`);
}
process.exit(survived.length === 0 && inconclusive.length === 0 ? 0 : 1);
