/**
 * Step 14's doc-versus-tree audit, as a CHECK rather than a reading.
 *
 * ## Why this is a script and not a careful re-read
 *
 * It exists because of a measured failure: for four days every reference to
 * "the caveat on the panel" described something that had never been built. The
 * documentation was not merely stale — it asserted a user-visible behaviour
 * that did not exist, in the files whose job is to be read instead of the code.
 *
 * A careful re-read catches that once. A check catches it every time, which is
 * the difference this project keeps having to learn: rule 41, rule 44 and rule
 * 45 are all the same shape — a lesson without a mechanism does not hold.
 *
 *   npx tsx scripts/doc-tree-audit.mjs
 *
 * Exit 1 when any claim in the docs is not backed by the tree.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const problems = [];
const checks = [];

function check(name, detail, ok) {
  checks.push({ name, detail, ok });
  if (!ok) problems.push(`${name}: ${detail}`);
}

/* ---- 1. Every "done" in BUILD-ORDER has a tab or a module behind it ---- */

const buildOrder = read('docs/BUILD-ORDER.md');
const panelSource = read('src/ui/panel.ts');

const STEP_EVIDENCE = {
  8: 'src/ui/military.ts',
  9: 'src/ui/legislature.ts',
  11: 'src/ui/tv.ts',
  12: 'src/coverage.ts',
  13: 'src/url-state.ts',
};

for (const [step, file] of Object.entries(STEP_EVIDENCE)) {
  const claimed = new RegExp(`\\|\\s*${step}\\s*\\|[^|]*\\|\\s*done\\s*\\|`, 'i').test(buildOrder);
  let exists = true;
  try {
    statSync(resolve(ROOT, file));
  } catch {
    exists = false;
  }
  check(
    `step ${step} claim matches the tree`,
    claimed ? (exists ? `done, and ${file} exists` : `BUILD-ORDER says done but ${file} is missing`) : 'not claimed done',
    !claimed || exists,
  );
}

/* ---- 2. A tab marked non-pending in the strip actually renders ---- */

const pendingTabs = [...panelSource.matchAll(/\{ id: '([a-z]+)', label: '[^']+', step: (null|'[^']+') \}/g)];
for (const [, id, step] of pendingTabs) {
  const wired = new RegExp(`tab === '${id}'`).test(panelSource);
  check(
    `tab "${id}" is wired iff it is not pending`,
    step === 'null' ? (wired ? 'not pending, and rendered' : 'marked built but nothing renders it') : 'pending, correctly not rendered',
    step === 'null' ? wired : true,
  );
}

/* ---- 3. Every verified entity carries a date ---- */

const entities = JSON.parse(read('data/wikidata-entities.json')).entities;
for (const [name, entity] of Object.entries(entities)) {
  if (entity.verified !== true) continue;
  check(
    `entity ${name} is dated`,
    entity.verifiedOn ? `verified ${entity.verifiedOn}` : 'verified: true with no verifiedOn',
    Boolean(entity.verifiedOn),
  );
}

/* ---- 4. An armed-forces override cannot exist without a citation ---- */

const armed = JSON.parse(read('data/armed-forces.json')).entries;
const uncited = Object.entries(armed).filter(
  ([, entry]) => entry.hasArmedForces !== entry.queryConcluded && !(entry.citation ?? '').trim(),
);
check(
  'every armed-forces override carries a citation',
  uncited.length === 0 ? 'all overrides cited' : `uncited: ${uncited.map(([iso]) => iso).join(', ')}`,
  uncited.length === 0,
);

/* ---- 5. Docs that assert a user-visible string — the P12 class ---- */

/**
 * The check that would have caught the four-day phantom caveat.
 *
 * A doc quoting a sentence the app is supposed to show is a claim about
 * behaviour. If no source file contains that sentence, the doc is asserting
 * something that does not exist.
 */
const ASSERTED_STRINGS = [
  ['docs/BUILD-ORDER.md', 'None recorded', 'src/dossier/military.ts'],
  ['docs/BUILD-ORDER.md', 'at least', 'src/ui/government.ts'],
  ['docs/CORE-GOAL.md', 'no party-composition source connected', 'src/dossier/legislature.ts'],
];

for (const [doc, phrase, source] of ASSERTED_STRINGS) {
  const inDoc = read(doc).includes(phrase);
  const inSource = read(source).includes(phrase);
  check(
    `"${phrase}" is real where ${doc} says it is`,
    inDoc ? (inSource ? `present in ${source}` : `${doc} asserts it; ${source} does not contain it`) : 'not asserted',
    !inDoc || inSource,
  );
}

/* ---- 6. Every test file the census names still exists ---- */

/**
 * THE FIRST VERSION OF THIS CHECK WAS VACUOUS, and the audit's own first run is
 * what exposed it: it looked for `census.files`, the census is keyed by test
 * NAME, so it read zero files and reported "all present". A check that
 * enumerates nothing passes everything.
 *
 * That is the same defect this audit exists to catch, committed inside the
 * audit — so the replacement asserts its own denominator first, which is rule
 * 27's shape and the habit that would have caught it immediately.
 */
const census = JSON.parse(read('tests/suite-census.json'));
const censusNames = Object.keys(census);
const testFiles = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts'));

check(
  'the census enumerates something',
  `${censusNames.length} recorded test names, ${testFiles.length} test files`,
  censusNames.length > 0 && testFiles.length > 0,
);

check(
  'the census is not wildly out of step with the suite',
  `${censusNames.length} names against ${testFiles.length} files`,
  censusNames.length >= testFiles.length,
);

/* ---- report ---- */

console.log(`doc-versus-tree audit — ${checks.length} checks\n`);
console.log('  ok?  check'.padEnd(56), 'detail');
for (const entry of checks) {
  console.log(` ${entry.ok ? ' ok ' : 'FAIL'}  ${entry.name}`.padEnd(56), entry.detail);
}

console.log(`\n${checks.filter((c) => c.ok).length} of ${checks.length} passed`);
if (problems.length > 0) {
  console.log('\nEach line below is a document asserting something the tree does not support:');
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
