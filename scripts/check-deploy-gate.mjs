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
};

const sources = registry.sources.filter((source) => !source.excluded);
const excluded = registry.sources.filter((source) => source.excluded);

const MARK = { live: '  ok  ', bundled: 'bundled', documentation: ' BLOCK' };

const problems = [];
console.log(`deploy gate: ${sources.length} active sources\n`);

for (const source of sources) {
  const status = source.verifiedAgainst ?? 'documentation';
  let detail = '';

  if (status === 'bundled') {
    const evidence = BUNDLED_EVIDENCE[source.id];
    if (!evidence) {
      problems.push(`${source.id}: claims "bundled" but no byte-level shape assertion is registered for it`);
      detail = 'NO EVIDENCE REGISTERED';
    } else {
      const covered = await readFile(resolve(ROOT, evidence), 'utf8').catch(() => null);
      if (covered === null) {
        problems.push(`${source.id}: claims "bundled" but its evidence file ${evidence} is missing`);
        detail = `missing ${evidence}`;
      } else {
        detail = `asserted by ${evidence}`;
      }
    }
  } else if (status === 'documentation') {
    problems.push(`${source.id}: contract read from documentation only, never confirmed against a live response`);
    detail = 'never seen a live response';
  } else if (status === 'live') {
    detail = 'confirmed against a live response';
  } else {
    problems.push(`${source.id}: unknown verifiedAgainst value ${JSON.stringify(status)}`);
    detail = 'unknown status';
  }

  console.log(`  [${MARK[status] ?? '  ??  '}] ${source.id.padEnd(24)} ${detail}`);
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
