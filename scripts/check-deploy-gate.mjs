#!/usr/bin/env node
/**
 * Deployment gate.
 *
 * Nothing ships to a real deployment while any source it depends on is still
 * `verifiedAgainst: "documentation"` — that is, while its endpoint contract has
 * only ever been read from vendor docs and never confirmed against a live
 * response.
 *
 * Run before any deploy:  npm run check:deploy
 * Exits non-zero and names every source still unverified.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));

// Only runtime-fetched sources are gated. A source with no probeUrl is bundled
// at build time from a version-pinned package: it cannot drift underneath us,
// and its shape is asserted directly against the real bytes by the test suite.
// There is no live response for it to be confirmed against.
const active = registry.sources.filter((source) => !source.excluded && source.probeUrl);
const bundled = registry.sources.filter((source) => !source.excluded && !source.probeUrl);
const unverified = active.filter((source) => source.verifiedAgainst !== 'live');

if (unverified.length === 0) {
  console.log(
    `deploy gate: OK — all ${active.length} runtime sources verified against live responses ` +
      `(${bundled.length} bundled source(s) not gated)`,
  );
  process.exit(0);
}

console.error(
  `deploy gate: BLOCKED — ${unverified.length} of ${active.length} runtime sources have never been confirmed against a live response.\n`,
);
for (const source of unverified) {
  console.error(`  ${source.id.padEnd(24)} ${source.name}`);
}
console.error(
  '\nEach of these has an endpoint contract taken from vendor documentation only.\n' +
    'To clear one: run `npm run probe`, capture a real response over its fixture in\n' +
    'tests/fixtures/, confirm `PROBE_LIVE=1 npm test` passes, then set its\n' +
    '`verifiedAgainst` to "live" in data/sources.json.\n',
);
process.exit(1);
