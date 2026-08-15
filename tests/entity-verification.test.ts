import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import entities from '../data/wikidata-entities.json';

/**
 * The check that was already sitting in the entity table as a field.
 *
 * Every entry carries `expectedLabel` beside its `qid`. Comparing the two
 * against Wikidata takes one request, and nobody ever did it — so
 * `courtOfLastResort` pointed at `Q1513611`, which is **"Supreme Court of Ghana",
 * a specific court with zero instances**, while its `expectedLabel` said
 * "supreme court". The judiciary query's fallback branch could never match for
 * any country, and it spent an unbounded subclass walk finding that out.
 *
 * The entry also carried `"verified": false`. **The doubt was recorded and the
 * means to resolve it was recorded, and neither did any work.** That is P12's
 * shape in a data file: a flag that reads as diligence and functions as a
 * comment.
 */

interface Entity {
  qid: string;
  expectedLabel?: string;
  verified?: boolean;
  verifiedOn?: string;
  usedBy?: string;
  note?: string;
}

const TABLE = (entities as { entities: Record<string, Entity> }).entities;
const ENTRIES = Object.entries(TABLE);

describe('the entity table describes itself honestly (no network)', () => {
  it('every entity carries a Q-id and the label it is expected to have', () => {
    // Without an expectedLabel there is nothing to check the qid against, and
    // the entry becomes unverifiable by construction.
    for (const [name, entity] of ENTRIES) {
      assert.match(entity.qid, /^Q\d+$/, `${name} has no valid Q-id`);
      assert.ok(
        (entity.expectedLabel ?? '').trim().length > 0,
        `${name} has no expectedLabel, so nothing can check its qid`,
      );
    }
  });

  /**
   * THE RULE THAT MAKES A DOUBT EXPIRE.
   *
   * `verified: false` records uncertainty and discharges nobody. An entry may
   * carry it, but not silently: it must say what it is waiting for, so the
   * flag is a task rather than a permanent shrug.
   */
  it('an unverified entity states what would resolve it', () => {
    for (const [name, entity] of ENTRIES) {
      if (entity.verified === true) continue;
      assert.ok(
        (entity.note ?? '').trim().length > 0,
        `${name} is unverified with no note saying what would resolve it — ` +
          'a recorded doubt with no expiry is a comment, not diligence',
      );
    }
  });

  it('a verified entity records WHEN it was verified', () => {
    // "Verified" without a date is a claim about an unknown moment, and Wikidata
    // changes. The date is what makes the claim re-checkable later.
    for (const [name, entity] of ENTRIES) {
      if (entity.verified !== true) continue;
      assert.match(entity.verifiedOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${name} is verified but not dated`);
    }
  });

  it('every entity says what uses it', () => {
    // An entity nothing uses is one nobody will notice going stale.
    for (const [name, entity] of ENTRIES) {
      assert.ok((entity.usedBy ?? '').trim().length > 0, `${name} does not say what uses it`);
    }
  });
});

describe('the entity table matches Wikidata (PROBE_LIVE only)', () => {
  const live = process.env['PROBE_LIVE'] === '1';

  it('every qid resolves to the label recorded beside it, and exists as a class', async (t) => {
    if (!live) return t.skip('set PROBE_LIVE=1');

    const values = ENTRIES.map(([, e]) => `wd:${e.qid}`).join(' ');
    let bindings: Array<Record<string, { value: string }>>;
    try {
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: {
          'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) entity-verification',
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/sparql-query',
        },
        body: `SELECT ?e ?eLabel (COUNT(DISTINCT ?i) AS ?instances) WHERE {
          VALUES ?e { ${values} }
          OPTIONAL { ?i wdt:P31 ?e . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
        } GROUP BY ?e ?eLabel`,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        process.stderr.write(`INCONCLUSIVE entity check: WDQS returned ${res.status}\n`);
        return;
      }
      bindings = (await res.json()).results.bindings;
    } catch {
      // Rule 3: unreachable answers a different question from wrong.
      process.stderr.write('INCONCLUSIVE entity check: WDQS unreachable\n');
      return;
    }

    const live_ = new Map(
      bindings.map((row) => [
        row['e']!.value.split('/').pop()!,
        { label: row['eLabel']?.value ?? '', instances: Number(row['instances']?.value ?? 0) },
      ]),
    );

    for (const [name, entity] of ENTRIES) {
      const actual = live_.get(entity.qid);
      assert.ok(actual, `${name}: ${entity.qid} did not resolve at all`);
      assert.equal(
        actual.label.toLowerCase(),
        String(entity.expectedLabel).toLowerCase(),
        `${name}: ${entity.qid} is "${actual.label}", not "${entity.expectedLabel}". ` +
          'This is the check that would have caught Q1513611 being the Supreme Court of Ghana.',
      );

      /**
       * A CLASS WITH NO INSTANCES IS NOT A CLASS.
       *
       * The label check alone would not have caught the court entry if the wrong
       * QID had happened to share a label. Zero instances is the other half:
       * every entity here is used as a CLASS in a `wdt:P31` walk, so one that
       * nothing instantiates cannot match, whatever it is called.
       */
      assert.ok(
        actual.instances > 0,
        `${name}: ${entity.qid} ("${actual.label}") has ZERO instances, so a P31 walk to it ` +
          'can never match. It is an individual, not a class.',
      );
    }
  });
});
