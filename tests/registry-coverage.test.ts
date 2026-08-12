import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { allSources } from '../src/facts/registry';

/**
 * Every network fetch and every bundled dataset the app consumes must resolve
 * through the source registry.
 *
 * Where this came from: the source-coverage grid was keyed on source-id strings,
 * so it could only see a dependency the code names. `naturalearth` scored "not
 * referenced" because the app reaches it through the `world-atlas` package, and
 * that near-miss turned out to be the general case — **a source the grid cannot
 * see is a source no gate covers.** That is the same shape as every other
 * finding this session: a check that cannot see its subject.
 *
 * Searching for it found a second bundled dataset, `i18n-iso-countries`, which
 * had no registry entry at all — no licence class, no attribution, invisible to
 * `npm run check:deploy`.
 *
 * These tests are deliberately syntactic. They cannot prove the app fetches only
 * what it declares at runtime; they prove that no host or bundled dataset
 * appears in the source without a registry record to account for it, which is
 * the part that silently drifts.
 */

const ROOT = resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const SOURCE_FILES = walk(join(ROOT, 'src'));

/**
 * Hosts that are not data sources and never carry a fact.
 *
 * Each needs a reason, because an allowlist without reasons becomes the place
 * exceptions go to avoid the rule.
 */
const NON_SOURCE_HOSTS = new Map<string, string>([
  ['www.w3.org', 'SVG and XML namespace URIs, never fetched'],
  ['creativecommons.org', 'licence deed links rendered as attribution, never fetched'],
  ['schema.org', 'vocabulary URI in SPARQL, never fetched'],
  ['www.wikidata.org', 'entity URIs appearing in SPARQL results, not a fetch target'],
  ['github.com', 'repository links in attribution text'],
]);

/**
 * Bundled datasets: an npm package whose *data* the app ships, as opposed to a
 * library whose code it calls. Each must name the registry source it satisfies.
 */
const BUNDLED_DATA_PACKAGES = new Map<string, string>([
  ['world-atlas', 'naturalearth'],
  ['i18n-iso-countries', 'iso-3166-names'],
]);

describe('every fetched host resolves through the registry', () => {
  const registryHosts = new Map<string, string>();
  for (const source of allSources()) {
    if (!source.probeUrl) continue;
    registryHosts.set(new URL(source.probeUrl).host, source.id);
  }

  const found: Array<{ file: string; host: string }> = [];
  for (const file of SOURCE_FILES) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      found.push({ file: file.slice(ROOT.length + 1), host: match[1] as string });
    }
  }

  it('examined some source files and found some hosts', () => {
    // Rule 16: a pass condition of "no offenders" must first prove it looked.
    assert.ok(SOURCE_FILES.length > 0, 'no TypeScript files found under src/');
    assert.ok(found.length > 0, 'no URLs found in src/ — the scan matched nothing');
  });

  it('every host in src/ is a registered source or a documented non-source', () => {
    const unaccounted = found.filter(
      ({ host }) => !registryHosts.has(host) && !NON_SOURCE_HOSTS.has(host),
    );
    assert.deepEqual(
      unaccounted,
      [],
      'these hosts appear in src/ with no registry source and no documented exemption:\n' +
        unaccounted.map(({ file, host }) => `  ${host} (${file})`).join('\n'),
    );
  });
});

describe('every bundled dataset resolves through the registry', () => {
  const imports: Array<{ file: string; pkg: string }> = [];
  for (const file of SOURCE_FILES) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)) {
      const specifier = match[1] as string;
      const pkg = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] as string);
      imports.push({ file: file.slice(ROOT.length + 1), pkg });
    }
  }

  it('examined some imports', () => {
    assert.ok(imports.length > 0, 'no package imports found in src/');
  });

  it('every bundled data package names a registry source that exists', () => {
    const ids = new Set(allSources().map((source) => source.id));
    const used = [...new Set(imports.map(({ pkg }) => pkg))].filter((pkg) =>
      BUNDLED_DATA_PACKAGES.has(pkg),
    );
    assert.ok(used.length > 0, 'no bundled data packages detected — the map may be stale');

    for (const pkg of used) {
      const sourceId = BUNDLED_DATA_PACKAGES.get(pkg) as string;
      assert.ok(
        ids.has(sourceId),
        `the app bundles data from "${pkg}", which must be registered as source ` +
          `"${sourceId}" in data/sources.json so the deploy gate can see it`,
      );
    }
  });
});
