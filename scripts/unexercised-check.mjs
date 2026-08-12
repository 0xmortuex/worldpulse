/**
 * Standing check: is anything DECLARED but never exercised by the fixtures the
 * app actually renders?
 *
 * Wired into the deploy gate because the one-off sweep caught `eonet:floods`
 * within an hour of its being registered — a layer whose category mapping,
 * marker, tooltip, click and provenance had never run. Debt found at creation is
 * cheaper than debt found at audit, and an audit that happens when someone
 * remembers is an audit that eventually does not happen.
 *
 * It NAMES what is unexercised and why it matters. A gate that says "something is
 * unexercised" trains people to re-run it; one that says which path and what
 * cannot be trusted as a result gets fixed.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What each kind of declaration promises, so the failure can say what breaks. */
const WHY = {
  layer:
    'its category mapping, marker rendering, tooltip, click handling and provenance have never run against data — five paths that could each be broken with nothing to show it',
  source:
    'no fixture reaches it, so its parser, its shape assertions and its degraded states are unproven in the running app',
};

/**
 * The rule, pure and separate from the I/O that feeds it.
 *
 * Exported so a planted violation drives THIS function rather than a copy of it
 * in a test — a duplicated rule is a rule that drifts from the one that runs.
 *
 * @param {{ declaredLayers: string[], exercisedLayers: string[], liveSourceIds: string[], fixtureIds: string[] }} input
 * @returns {string[]}
 */
export function unexercisedProblems(input) {
  const exercised = new Set(input.exercisedLayers);
  const fixtures = new Set(input.fixtureIds);
  const problems = [];

  for (const layer of input.declaredLayers) {
    if (!exercised.has(layer)) {
      problems.push(`${layer} is declared as a layer but no fixture event exercises it — ${WHY.layer}`);
    }
  }
  for (const id of input.liveSourceIds) {
    if (!fixtures.has(id)) {
      problems.push(`${id} is marked live but no fixture is registered for it — ${WHY.source}`);
    }
  }
  return problems;
}

export async function findUnexercised() {
  const problems = [];

  // ---- Layers declared in provider.ts versus layers the fixture set produces.
  const provider = await readFile(resolve(ROOT, 'src/layers/provider.ts'), 'utf8');
  const declaredLayers = [...provider.matchAll(/id: '([a-z]+:[a-z-]+)'/g)].map((m) => m[1]);

  const eonet = JSON.parse(await readFile(resolve(ROOT, 'tests/fixtures/layers/eonet-mixed.json'), 'utf8'));
  const exercised = new Set(
    (eonet.events ?? []).map(
      (event) => `eonet:${String(event.categories?.[0]?.title ?? '').toLowerCase().replace(/\s+/g, '-')}`,
    ),
  );
  // USGS layers come from the quake fixtures, which the provider always loads.
  exercised.add('usgs:earthquakes');

  const registry = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));
  const fixtureSrc = await readFile(resolve(ROOT, 'tests/fixtures/index.ts'), 'utf8');
  const fixtureIds = new Set([...fixtureSrc.matchAll(/sourceId:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));

  const liveSourceIds = registry.sources
    .filter((source) => !source.excluded && source.verifiedAgainst === 'live')
    .map((source) => source.id);

  problems.push(
    ...unexercisedProblems({
      declaredLayers,
      exercisedLayers: [...exercised],
      liveSourceIds,
      fixtureIds: [...fixtureIds],
    }),
  );

  return { problems, declaredLayers, exercisedLayers: [...exercised] };
}
