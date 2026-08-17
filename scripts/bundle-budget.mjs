/**
 * Step 14's performance pass, in the one dimension that is deterministic.
 *
 * ## Why bundle weight and not frame rate
 *
 * Frame rate is the performance number that matters most for a globe, and it is
 * the one this project cannot assert. Measured on this machine: **59.9fps under
 * a GPU renderer and 1.3fps under SwiftShader** — a 46x spread on identical
 * code. A budget wide enough to pass on both asserts nothing; one tight enough
 * to mean something fails on weather. That is rule 15's condition exactly, and
 * rule 20a's reason: a frame rate is a property of the app UNDER a harness
 * configuration.
 *
 * `scripts/measure-frame-profile.mjs` therefore MEASURES frame rate and records
 * its configuration, and does not gate on it. This file gates on the number
 * that is identical on every machine.
 *
 * ## The budgets, set from measurement
 *
 * Measured 2026-08-16 on the current tree:
 *
 * ```
 * globe-*.js              1839.5 KB     three.js + globe.gl
 * index-*.js               495.6 KB     the app, topojson, i18n-iso-countries
 * index-*.css               25.7 KB
 *
 * ## Raised once, with the measurement
 *
 * 2026-08-16 — the stylesheet moved 25.7 KB → 34.2 KB across v2 Phase C and the
 * intel feed: the flat map, the lists views, the tour, the command palette and
 * the feed each brought their own block. Measured, not estimated, and the
 * budget follows the same 15%-above rule the others do.
 *
 * The app chunk is the one to watch, and it is now the binding constraint:
 * **564.8 KB against 570 KB, leaving 5.2 KB.** The dashboard and the chokepoint
 * monitor consumed the headroom the intel feed left.
 *
 * **The next surface does not fit, and must not be made to fit by raising this
 * number.** The answer is code-splitting: the chokepoint capture and the news
 * fixtures are committed artefacts loaded eagerly by modules the first paint
 * does not need, and a dynamic `import()` behind the tab that uses them is the
 * shape this project already applies to large artefacts elsewhere. That is a
 * real refactor — the panel's render path is synchronous today — so it is named
 * here rather than started at the end of an unrelated commit.
 *
 * Recorded because a budget raised without saying why is a budget switched off,
 * and a budget raised twice in a row is one nobody believes.
 * ```
 *
 * Each budget sits about 15% above its observed value — enough headroom that
 * ordinary work does not trip it, tight enough that a careless import does. A
 * budget set at a round number far above the truth is a budget that never
 * fires, which is the same failure as a guard nobody runs.
 *
 * **The globe chunk is split deliberately** so the app's own code can be read
 * against its own budget: three.js dominates the total and would otherwise mask
 * a doubling of everything else.
 *
 *   npx tsx scripts/bundle-budget.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'dist', 'assets');

const BUDGETS = [
  {
    name: 'globe vendor chunk',
    match: /^globe-.*\.js$/,
    observedKb: 1839.5,
    budgetKb: 2120,
    why: 'three.js and globe.gl. Large by nature; the budget catches a second copy or an unshaken import.',
  },
  {
    name: 'app chunk',
    match: /^index-.*\.js$/,
    observedKb: 495.6,
    budgetKb: 570,
    why: 'this app plus topojson and the ISO country tables. The number a careless import moves first.',
  },
  {
    name: 'stylesheet',
    match: /^index-.*\.css$/,
    observedKb: 34.2,
    budgetKb: 39,
    why: 'one stylesheet, hand-written. Growth here is usually a duplicated block rather than a feature.',
  },
];

let files;
try {
  files = readdirSync(ASSETS);
} catch {
  console.error(`no build output at ${ASSETS} — run \`npm run build\` first`);
  process.exit(2);
}

const problems = [];
console.log('bundle budget\n');
console.log('  chunk'.padEnd(26), 'size'.padEnd(12), 'budget'.padEnd(12), 'headroom');

for (const budget of BUDGETS) {
  const matches = files.filter((file) => budget.match.test(file));

  /**
   * A budget matching nothing is a budget that passes everything — the vacuity
   * this project has now met in a scanner, a two-state assertion, and a
   * doc audit. It fails loudly rather than silently succeeding.
   */
  if (matches.length === 0) {
    problems.push(`${budget.name}: no file matched ${budget.match} — the budget is checking nothing`);
    console.log(`  ${budget.name.padEnd(24)} NO MATCH`);
    continue;
  }

  const kb = matches.reduce((sum, file) => sum + statSync(join(ASSETS, file)).size, 0) / 1024;
  const headroom = budget.budgetKb - kb;
  const ok = kb <= budget.budgetKb;
  if (!ok) problems.push(`${budget.name}: ${kb.toFixed(1)} KB over its ${budget.budgetKb} KB budget`);

  console.log(
    `  ${(ok ? 'ok  ' : 'OVER') + ' ' + budget.name}`.padEnd(26),
    `${kb.toFixed(1)} KB`.padEnd(12),
    `${budget.budgetKb} KB`.padEnd(12),
    `${headroom >= 0 ? '+' : ''}${headroom.toFixed(1)} KB`,
  );
}

console.log('\nFrame rate is measured, not gated — 59.9fps under a GPU renderer against 1.3fps');
console.log('under SwiftShader on this same machine. See scripts/measure-frame-profile.mjs.');

if (problems.length > 0) {
  console.log('\n');
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log('\nRaise a budget only with the measurement that justifies it, in the same commit.');
  process.exitCode = 1;
}
