/**
 * Generate `data/armed-forces.json` — whether each country has armed forces.
 *
 * ## The design, per the reviewer's decision on OPEN-QUESTIONS 31
 *
 * Option A (query-generated) with option C's discipline where it matters:
 *
 *   - the QUERY generates the table, so 190+ countries are not hand-maintained
 *   - a REVIEW FLAG marks entries the query is uncertain about
 *   - reviewed entries carry a CITATION, per the leader-override precedent
 *   - the table is COMMITTED AND VERSIONED, not fetched at runtime — a
 *     constitutional fact should not flicker with an edit war
 *   - re-running and diffing is a FINDING to investigate, never an auto-update
 *
 * ## What the query gets right, measured
 *
 * The dissolution-date filter handles the hard transitional case exactly:
 *
 *     HTI  Armed Forces of Haiti    DISSOLVED 1995-12-06
 *          Defence Force of Haiti   (no dissolution date)   -> has forces
 *
 * Disbanded in 1995, remobilised in 2017, and the query follows it without
 * special-casing.
 *
 * ## What it gets wrong, and why that is a REVIEW case rather than a bug
 *
 *     CRI  "Public Force of Costa Rica"    (no dissolution date)
 *     PAN  "Panamanian Public Forces"      (no dissolution date)
 *     ISL  "defence of Iceland"            (no dissolution date)
 *
 * Wikidata types each country's police or public force as an armed force.
 * That is not a data error — a gendarmerie IS a security force — it is a
 * DEFINITIONAL boundary: whether a constabulary counts as armed forces is the
 * question, not a fact the query can settle.
 *
 * So the generator does not pretend to settle it. It detects the shape and
 * flags it, which is precisely the "disputed, transitional, or recently
 * changed" class the review flag was specified for.
 *
 *   npx tsx scripts/generate-armed-forces.mjs           # write the table
 *   npx tsx scripts/generate-armed-forces.mjs --diff    # compare, never write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const HEADERS = {
  'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) armed-forces-table',
  Accept: 'application/sparql-results+json',
  'Content-Type': 'application/sparql-query',
};

const OUT = resolve(import.meta.dirname, '..', 'data', 'armed-forces.json');
const diffOnly = process.argv.includes('--diff');

/**
 * Entities whose name marks them as a police or public force rather than a
 * military. Matching one is not a verdict — it is a reason to ask a human.
 */
const CONSTABULARY = /\b(police|public forces?|constabular\w*|gendarm\w*|coast guards?|civil defen[cs]e)\b/i;

/**
 * ## Hand-checked entries, applied over the query — the leader-override precedent
 *
 * The reviewer's decision is option A "with C's discipline where it matters":
 * the query generates the table, a human reviews what it cannot settle, and
 * reviewed entries carry a citation.
 *
 * These are the entries reviewed so far. Each records what the QUERY said, so
 * a future re-run that agrees can retire the override rather than keeping it
 * forever — and so nobody has to re-derive why it exists.
 *
 * The pattern in every disagreement is the same: **Wikidata types a country's
 * police or defence agency as armed forces.** That is not a data error, it is a
 * definitional boundary — whether a constabulary counts is the question itself.
 */
const REVIEWED = {
  CRI: {
    hasArmedForces: false,
    querySaid: true,
    reviewedOn: '2026-08-16',
    citation:
      'Constitution of Costa Rica, Article 12 (1949): the army as a permanent institution is ' +
      'abolished. The "Public Force" Wikidata returns is the national police.',
  },
  PAN: {
    hasArmedForces: false,
    querySaid: true,
    reviewedOn: '2026-08-16',
    citation:
      'Constitution of Panama, Article 310 (1994 amendment): the Republic shall not have an ' +
      'army. The "Panamanian Public Forces" are police and border service.',
  },
  ISL: {
    hasArmedForces: false,
    querySaid: true,
    reviewedOn: '2026-08-16',
    citation:
      'Iceland maintains no standing army. The entity returned, "defence of Iceland", covers ' +
      'the Coast Guard and NATO host-nation arrangements rather than a military. THE NAME-BASED ' +
      'FLAG DOES NOT CATCH THIS ONE — it reads as a defence body, which is why human review is ' +
      'part of the design rather than a fallback.',
  },
  HTI: {
    hasArmedForces: true,
    querySaid: true,
    reviewedOn: '2026-08-16',
    citation:
      'Disbanded 1995, remobilised from 2017. The query gets this RIGHT without special-casing: ' +
      '"Armed Forces of Haiti" carries a dissolution date of 1995-12-06 and "Defence Force of ' +
      'Haiti" carries none, so the live-force filter resolves it correctly.',
  },
};

/**
 * TWO CHEAP QUERIES, JOINED HERE — because the join is what costs.
 *
 * Characterised rather than guessed, adding one clause at a time:
 *
 * ```
 * 1. count of P31 armed forces          1 row      1133ms
 * 2. + P17 country                    338 rows      820ms
 * 3. + ?country wdt:P298 ?iso         HTTP 504    65327ms   <- the whole cost
 * 4. + dissolution OPTIONAL           HTTP 504    65568ms
 * 5. + label service                  HTTP 504    65548ms
 * ```
 *
 * The forces themselves are cheap. **Attaching the ISO code is what dies** —
 * and an earlier version that anchored on countries instead died the same way,
 * so it is the cross-product, not the direction.
 *
 * So neither query does the join. The forces come back keyed by country QID,
 * the ISO codes come back separately, and the two are matched in JavaScript
 * where a 338 × 275 match costs nothing.
 *
 * This is the session's third instance of the same lesson: a SPARQL endpoint
 * will happily accept a query whose cost is a product, and the fix is always to
 * stop asking it for the product.
 */
const FORCES_QUERY = `SELECT ?country ?afLabel ?dissolved WHERE {
  ?af wdt:P31 wd:Q772547 .
  ?af wdt:P17 ?country .
  OPTIONAL { ?af wdt:P576 ?dissolved . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}`;

const ISO_QUERY = `SELECT ?country ?countryLabel ?iso WHERE {
  ?country wdt:P298 ?iso .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}`;

async function ask(label, query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: query,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    console.error(`${label}: WDQS returned ${res.status} — nothing written`);
    process.exit(1);
  }
  return (await res.json()).results.bindings;
}

const forceRows = await ask('forces', FORCES_QUERY);
const isoRows = await ask('iso codes', ISO_QUERY);

/** country QID -> { iso, label } */
const isoByQid = new Map(
  isoRows.map((row) => [
    row.country.value,
    { iso: row.iso.value, label: row.countryLabel?.value ?? row.iso.value },
  ]),
);

/** iso -> { country, forces: [{ label, dissolved }] } */
const byCountry = new Map();
for (const row of forceRows) {
  const match = isoByQid.get(row.country.value);
  // A force whose country has no ISO-3 code — a historical or unrecognised
  // state. Skipped rather than guessed at, and not silently: counted below.
  if (!match) continue;
  const entry = byCountry.get(match.iso) ?? { country: match.label, forces: [] };
  entry.forces.push({
    label: row.afLabel?.value ?? '(unlabelled)',
    dissolved: row.dissolved?.value?.slice(0, 10) ?? null,
  });
  byCountry.set(match.iso, entry);
}

const unmatched = forceRows.filter((row) => !isoByQid.has(row.country.value)).length;

/**
 * Countries the query returned nothing for still need a row.
 *
 * "No armed-forces entity" is a real answer and the one most likely to be
 * correct for a country with no army — but it is also what a coverage gap looks
 * like, so those entries are flagged for review rather than trusted. The list
 * comes from the app's own country table, not from a second query.
 */
const ALL_ISO = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'data', 'country-codes.json'), 'utf8'),
);
for (const iso of ALL_ISO) {
  if (!byCountry.has(iso)) byCountry.set(iso, { country: iso, forces: [] });
}

const entries = {};
let flagged = 0;

for (const [iso, { country, forces }] of [...byCountry.entries()].sort()) {
  const live = forces.filter((force) => force.dissolved === null);
  const dissolved = forces.filter((force) => force.dissolved !== null);

  const hasArmedForces = live.length > 0;

  /**
   * Three independent reasons to ask a human, each recorded by name so the
   * reviewer knows WHY rather than only THAT.
   */
  const reasons = [];
  if (live.length > 0 && live.every((force) => CONSTABULARY.test(force.label))) {
    reasons.push(
      `every live force is named like a constabulary (${live.map((f) => f.label).join('; ')}), ` +
        'so "armed forces" here may be a police or coast-guard body rather than a military',
    );
  }
  /**
   * DISBANDED AND NOT REPLACED — the genuinely transitional case.
   *
   * An earlier version flagged any country having both dissolved and live
   * forces, which fired for France and the United States: every long-lived
   * military has historical units with end dates. A rule that flags the G7
   * flags nothing, because 31 entries a reviewer will actually read is a
   * review queue and 190 is a wall.
   */
  if (live.length === 0 && dissolved.length > 0) {
    reasons.push(
      `disbanded and not replaced: ${dissolved.map((f) => f.label).join('; ')} — confirm no ` +
        'successor force exists under another name',
    );
  }
  if (forces.length === 0) {
    reasons.push('no armed-forces entity at all, which may mean no army or may mean no record');
  }

  const reviewed = REVIEWED[iso];
  if (reviewed && reviewed.hasArmedForces !== hasArmedForces) {
    reasons.push(
      `HUMAN REVIEW OVERRODE THE QUERY: query said ${hasArmedForces}, review says ` +
        `${reviewed.hasArmedForces}`,
    );
  }

  if (reasons.length > 0) flagged += 1;

  entries[iso] = {
    country,
    /** The reviewed value wins where one exists — the leader-override precedent. */
    hasArmedForces: reviewed ? reviewed.hasArmedForces : hasArmedForces,
    queryConcluded: hasArmedForces,
    /** What the query saw, so a reviewer can judge without re-running it. */
    liveForces: live.map((force) => force.label),
    dissolvedForces: dissolved.map((force) => `${force.label} (dissolved ${force.dissolved})`),
    needsReview: reasons.length > 0,
    reviewReasons: reasons,
    reviewedOn: reviewed?.reviewedOn ?? null,
    citation: reviewed?.citation ?? null,
  };
}

const generated = {
  $comment: [
    'GENERATED by scripts/generate-armed-forces.mjs — do not hand-edit the generated fields.',
    '',
    'hasArmedForces is a constitutional fact, and this table is COMMITTED rather than fetched',
    'at runtime so it cannot flicker with an edit war upstream.',
    '',
    'A `needsReview` entry is one the query cannot settle — usually because the only live force',
    'is named like a police or coast-guard body, which is a definitional boundary rather than a',
    'data error. Reviewed entries carry reviewedBy, reviewedOn and a citation.',
    '',
    'RE-RUNNING IS A DIFF, NOT AN UPDATE. A country whose status flips is a FINDING to',
    'investigate: run with --diff, read what changed, and decide. Never auto-apply.',
  ],
  generatedOn: new Date().toISOString().slice(0, 10),
  entries,
};

if (diffOnly) {
  let previous;
  try {
    previous = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    console.error('no existing table to diff against');
    process.exit(1);
  }

  const changes = [];
  for (const [iso, entry] of Object.entries(entries)) {
    const before = previous.entries[iso];
    if (!before) {
      changes.push(`NEW      ${iso} ${entry.country}: hasArmedForces=${entry.hasArmedForces}`);
    } else if (before.hasArmedForces !== entry.hasArmedForces) {
      changes.push(
        `CHANGED  ${iso} ${entry.country}: ${before.hasArmedForces} -> ${entry.hasArmedForces}` +
          (before.reviewedBy ? `  *** REVIEWED BY ${before.reviewedBy} — do not overwrite ***` : ''),
      );
    }
  }
  for (const iso of Object.keys(previous.entries)) {
    if (!entries[iso]) changes.push(`GONE     ${iso}: no longer returned by the query`);
  }

  console.log(`${changes.length} change(s) since ${previous.generatedOn}`);
  for (const change of changes) console.log('  ', change);
  console.log(
    changes.length === 0
      ? '\nno change — nothing to investigate'
      : '\nEach line above is a FINDING. Investigate before touching the table.',
  );
  process.exit(0);
}

writeFileSync(OUT, `${JSON.stringify(generated, null, 2)}\n`);
console.log(
  `wrote ${Object.keys(entries).length} countries, ${flagged} flagged for review` +
    ` (${forceRows.length} force rows, ${unmatched} skipped for having no ISO-3 country)`,
);
