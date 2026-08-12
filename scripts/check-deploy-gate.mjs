#!/usr/bin/env node
/**
 * Deployment gate.
 *
 * Nothing ships while any source is still `verifiedAgainst: "documentation"` —
 * an endpoint contract read from vendor docs and never confirmed against a live
 * response.
 *
 * The gate has NO exceptions. Every non-excluded source is printed with its
 * status on every run, including the ones that pass. A gate that silently skips
 * what it considers fine is a gate you have to read the exception list to trust,
 * and the second exception is always easier to argue for than the first.
 *
 * Statuses:
 *   live        confirmed against a real response, shape captured in a fixture
 *   bundled     not fetched at runtime; shipped from a version-pinned package
 *               and asserted byte-level against the real data by the test suite
 *   documentation   never confirmed against anything. Blocks.
 *
 * `bundled` is only legitimate when a test asserts on the real shipped bytes.
 * That claim is itself checked below, so the value cannot be used to wave a
 * source through.
 *
 * Run:  npm run check:deploy
 */
import { readFile } from 'node:fs/promises';
import { verdictFor } from './deploy-gate-rules.mjs';
import { findUnexercised } from './unexercised-check.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));

/**
 * Sources claiming `bundled` must be covered by a test that reads the shipped
 * data directly. Without this check, `bundled` is just an unaudited exemption.
 */
const BUNDLED_EVIDENCE = {
  naturalearth: 'tests/geometry.test.ts',
  'iso-3166-names': 'tests/geometry.test.ts',
};

/**
 * Which sources have a fixture and a contract test, read from the files rather
 * than from a list maintained here — a second list would drift from the first.
 */
const fixtureSrc = await readFile(resolve(ROOT, 'tests/fixtures/index.ts'), 'utf8');
const contractSrc = await readFile(resolve(ROOT, 'tests/contracts.test.ts'), 'utf8');
const fixtureIds = new Set(
  [...fixtureSrc.matchAll(/sourceId:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);
const contractIds = new Set(
  [...contractSrc.matchAll(/liveOrInconclusive\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);

const sources = registry.sources.filter((source) => !source.excluded);
const excluded = registry.sources.filter((source) => source.excluded);

const MARK = { live: '  ok  ', bundled: 'bundled', documentation: ' BLOCK' };

const problems = [];
console.log(`deploy gate: ${sources.length} active sources\n`);

// Evidence files are read once, so the rule itself stays pure and testable.
const evidencePresent = new Set();
for (const evidence of Object.values(BUNDLED_EVIDENCE)) {
  const covered = await readFile(resolve(ROOT, evidence), 'utf8').catch(() => null);
  if (covered !== null) evidencePresent.add(evidence);
}
const world = {
  fixtureIds,
  contractIds,
  bundledEvidence: BUNDLED_EVIDENCE,
  evidenceExists: (path) => evidencePresent.has(path),
};

for (const source of sources) {
  const { status, detail, problem } = verdictFor(source, world);
  if (problem) problems.push(problem);
  // The mark reflects the OUTCOME, not the claim (rule 21).
  const mark = problem ? ' BLOCK' : (MARK[status] ?? '  ??  ');
  console.log(`  [${mark}] ${source.id.padEnd(24)} ${detail}`);
}

/**
 * Standing unexercised-path check. Runs every gate run rather than when someone
 * remembers to audit — eonet:floods was registered and unexercised within the
 * same hour, and an audit that depends on memory eventually does not happen.
 */
const unexercised = await findUnexercised();
console.log(`\n  unexercised-path check: ${unexercised.declaredLayers.length} layers declared, ${unexercised.exercisedLayers.length} exercised by fixtures`);
for (const problem of unexercised.problems) problems.push(problem);
if (unexercised.problems.length === 0) {
  console.log('    every declared layer and every live source is exercised');
} else {
  for (const problem of unexercised.problems) console.log(`    [ BLOCK] ${problem}`);
}

console.log(`\n  ${excluded.length} source(s) excluded on licensing grounds and not gated:`);
for (const source of excluded) console.log(`      ${source.id}`);

if (problems.length === 0) {
  console.log('\ndeploy gate: OK');
  process.exit(0);
}

console.error(`\ndeploy gate: BLOCKED — ${problems.length} problem(s)\n`);
for (const problem of problems) console.error(`  ${problem}`);
console.error(
  '\nTo clear a documentation-only source: run `npm run probe`, capture a real\n' +
    'response over its fixture in tests/fixtures/, confirm `PROBE_LIVE=1 npm test`\n' +
    'passes, then set its `verifiedAgainst` to "live" in data/sources.json.\n',
);
process.exit(1);
