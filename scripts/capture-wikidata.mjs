/**
 * Capture a live WDQS response THROUGH THE APP'S OWN QUERY BUILDER.
 *
 * ## Why this is a script and not a curl command
 *
 * The gate requires a live fixture captured via the app's builder, and every
 * Wikidata fixture in this repo before now was captured by hand. That is how
 * `legislature-gbr.json` came to contain a defect: the query returned the
 * parent body as a chamber of itself, the capture recorded it faithfully, and
 * the contract test then asserted the wrong count as the expected one. A
 * hand-captured fixture proves the endpoint answered. It does not prove the
 * app asked what the app asks.
 *
 * Importing the builder makes the fixture and the shipped query the same
 * question by construction. If the builder changes, re-running this is the
 * whole update.
 *
 * ## Usage
 *
 *   npx tsx scripts/capture-wikidata.mjs legislature GBR
 *   npx tsx scripts/capture-wikidata.mjs cabinet ISL judiciary GBR
 *
 * Pairs of <query> <iso3>. Writes tests/fixtures/wikidata/<query>-<iso>.json.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCabinetQuery,
  buildJudiciaryQuery,
  buildLegislatureQuery,
} from '../src/sources/wikidata-government.ts';

const BUILDERS = {
  legislature: buildLegislatureQuery,
  cabinet: buildCabinetQuery,
  judiciary: buildJudiciaryQuery,
};

const ENDPOINT = 'https://query.wikidata.org/sparql';
const HEADERS = {
  'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) fixture-capture',
  Accept: 'application/sparql-results+json',
  'Content-Type': 'application/sparql-query',
};

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  console.error('usage: npx tsx scripts/capture-wikidata.mjs <query> <ISO3> [<query> <ISO3> ...]');
  console.error(`queries: ${Object.keys(BUILDERS).join(', ')}`);
  process.exit(2);
}

let failures = 0;

for (let i = 0; i < args.length; i += 2) {
  const kind = args[i];
  const iso = args[i + 1].toUpperCase();
  const build = BUILDERS[kind];
  if (!build) {
    console.error(`unknown query "${kind}" — expected one of ${Object.keys(BUILDERS).join(', ')}`);
    failures += 1;
    continue;
  }

  const query = build(iso);
  const started = Date.now();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: HEADERS,
      body: query,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.error(`${kind}/${iso}: unreachable after ${Date.now() - started}ms — ${err.name}`);
    failures += 1;
    continue;
  }
  const ms = Date.now() - started;

  if (!res.ok) {
    console.error(`${kind}/${iso}: HTTP ${res.status} after ${ms}ms — NOT written`);
    failures += 1;
    continue;
  }

  const body = await res.json();
  const rows = body.results.bindings.length;

  // A capture with no rows is almost always a defect in the query rather than a
  // fact about the country, and writing it would bake that defect into the
  // suite as an expected value — which is exactly what happened here before.
  if (rows === 0) {
    console.error(`${kind}/${iso}: ZERO rows after ${ms}ms — NOT written. Check the query before capturing.`);
    failures += 1;
    continue;
  }

  const path = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'wikidata', `${kind}-${iso.toLowerCase()}.json`);
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${kind}/${iso}: ${rows} rows in ${ms}ms -> ${path.split(/[\\/]/).slice(-2).join('/')}`);
}

process.exit(failures === 0 ? 0 : 1);
