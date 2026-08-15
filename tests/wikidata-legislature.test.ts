import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { buildLegislatureQuery, parseLegislature } from '../src/sources/wikidata-government';

/**
 * Contract test for the sixth query builder.
 *
 * It had none, for a reason that was recorded rather than skipped quietly: the
 * query could not complete against live WDQS for ANY country tried — 504 for
 * GBR, 500 after 60.6s for Iceland, 504 after 65.5s for Vatican City — so there
 * was no real response to capture.
 *
 * The cause was not a slow service. A `BIND` in its own UNION branch left
 * `?chamber` unbound, and the `OPTIONAL { ?chamber wdt:P1342 ?seats }` below it
 * then matched every entity in Wikidata with a seat count. That is both the
 * timeout and the reason a query for the United Kingdom returned Swiss cantons.
 *
 * Both fixtures are live captures taken after the fix, from real countries.
 */
function capture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/wikidata', `${name}.json`), 'utf8'));
}

function rowsAndDistinct(raw: unknown, variable: string): { rows: number; distinct: number } {
  const bindings = (raw as { results: { bindings: Array<Record<string, { value?: string }>> } }).results.bindings;
  return {
    rows: bindings.length,
    distinct: new Set(bindings.map((row) => row[variable]?.value).filter(Boolean)).size,
  };
}

describe('query 6 — legislature', () => {
  it('names the label service, without which every *Label binding is absent', () => {
    assert.match(buildLegislatureQuery('GBR'), /SERVICE wikibase:label/);
  });

  it('does not reintroduce the unbound-BIND idiom', () => {
    // Regression guard for the actual defect. A property path keeps ?chamber in
    // one scope; the UNION form did not, and nothing about the symptom
    // (a timeout) pointed at the cause.
    const query = buildLegislatureQuery('GBR');
    assert.match(query, /wdt:P527\? \?chamber/);
    assert.doesNotMatch(query, /BIND\(\?body AS \?chamber\)/);
  });

  it('constrains chambers by type, so parts that are not chambers stay out', () => {
    // Without this the query returns the Monarch of the United Kingdom, "Member
    // of the Althing", and the chauffeur service of the German Bundestag as
    // legislative chambers. It completed; it was still wrong.
    //
    // AMENDED 2026-08-15. This asserted the exact string `wdt:P31/wdt:P279*`,
    // which pinned the unbounded operator rather than the constraint it exists
    // for — so bounding the walk failed a test whose stated intent the change
    // preserves. Rule 25: assert the invariant, not the instance.
    //
    // The invariant is that chambers are reached by a P31 walk to a declared
    // chamber type. Verified against the unbounded form on six countries before
    // this was changed — identical chamber sets for VAT, ISL, GBR, IND, USA and
    // DEU, so the Monarch is still not a chamber.
    const query = buildLegislatureQuery('GBR');
    assert.match(query, /\?chamber wdt:P31\/wdt:P279/, 'chambers are no longer type-constrained');
    assert.match(query, /VALUES \?chamberType/, 'the chamber types are no longer declared');
  });

  it('does NOT use an unbounded subclass walk', () => {
    /**
     * The other half, and the reason the assertion above was widened rather than
     * deleted. `wdt:P279*` cost the sibling cabinet query 24 of its 52 seconds,
     * and this query carried the same clause while merely not paying for it that
     * day. A regression to the unbounded form is the specific change that
     * reintroduces a 60-second query.
     */
    assert.equal(buildLegislatureQuery('GBR').includes('wdt:P279*'), false);
  });

  it('parses the United Kingdom capture: three chambers from five rows (rule 28)', () => {
    const raw = capture('legislature-gbr');
    assert.deepEqual(rowsAndDistinct(raw, 'chamber'), { rows: 5, distinct: 3 });

    const chambers = parseLegislature(raw);
    assert.equal(chambers.length, 3);
    const commons = chambers.find((chamber) => chamber.label === 'House of Commons');
    assert.ok(commons, 'the House of Commons is missing from a UK legislature capture');
    assert.equal(commons.seats, 650);
  });

  it('parses a single-chamber capture', () => {
    // Iceland is the country whose failure disproved "it is a volume problem":
    // one chamber, and it still timed out under the old query.
    const chambers = parseLegislature(capture('legislature-isl'));
    assert.equal(chambers.length, 1);
    assert.equal(chambers[0]?.label, 'Althing');
    assert.equal(chambers[0]?.seats, 63);
  });

  it('records that Iceland returns one party, which is data sparsity and not a pass', () => {
    // Stated rather than asserted as success. The Althing has more than one
    // party; Wikidata lists one composition statement. A test that read
    // "parties > 0" as coverage would be asserting our query works from a fact
    // about Wikidata's completeness.
    const chambers = parseLegislature(capture('legislature-isl'));
    assert.equal(chambers[0]?.parties.length, 1);
  });
});
