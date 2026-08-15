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

  it('a parliament is not returned as a chamber of itself', () => {
    /**
     * THIS TEST USED TO ASSERT THE DEFECT.
     *
     * It read `assert.equal(chambers.length, 3)` for the United Kingdom, under
     * the heading "three chambers from five rows (rule 28)". The rule-28 part
     * was real — the parser does collapse rows to distinct entities — but the
     * expected count came from the capture, and the capture came from a query
     * that returned the parent body alongside its own two houses:
     *
     *   House of Commons                    650
     *   House of Lords                      808
     *   Parliament of the United Kingdom   1433   <- the other two, added up
     *
     * Nobody asked whether three was right. It was blessed in three places at
     * once: this assertion, the captured fixture, and the builder's own comment
     * listing "(Parliament 1433, Lords 808, Commons 650)" as a success.
     */
    const query = buildLegislatureQuery('GBR');
    assert.match(query, /FILTER NOT EXISTS/, 'the parent-body guard is gone');
    assert.match(query, /\?chamber wdt:P527 \?child/, 'the guard no longer looks at children');

    const raw = capture('legislature-gbr');
    const chambers = parseLegislature(raw);
    assert.deepEqual(
      chambers.map((chamber) => chamber.label).sort(),
      ['House of Commons', 'House of Lords'],
      'the United Kingdom is bicameral; a third chamber means the parent is back',
    );
    assert.equal(chambers.find((c) => c.label === 'House of Commons')?.seats, 650);
    assert.equal(chambers.find((c) => c.label === 'House of Lords')?.seats, 808);
  });

  it('keeps the body itself when it has no chamber children — the unicameral case', () => {
    /**
     * The guard's other half, and the reason it is relational rather than
     * structural. Requiring a real P527 hop would drop Iceland entirely, and
     * measurement said it would also drop BOTH German chambers, which are
     * separate P194 values of the country rather than children of one parent.
     *
     * Chambers returned per country when this was chosen:
     *
     *   iso   before   require-a-hop   drop-"parliament"   this guard
     *   GBR      3           2                 2                2
     *   NZL      2           1                 0                1
     *   DEU      2           0                 2                2
     *   ISL      1           0                 0                1
     */
    const chambers = parseLegislature(capture('legislature-isl'));
    assert.equal(chambers.length, 1, 'Iceland lost its only chamber');
    assert.equal(chambers[0]?.label, 'Althing');
    assert.equal(chambers[0]?.seats, 63);
  });

  it('does not call a committee, a library or an office a political party', () => {
    /**
     * THE SECOND ASSERTION THAT BLESSED A DEFECT.
     *
     * It read "records that Iceland returns one party, which is data sparsity
     * and not a pass" — careful about the wrong thing. The single row was not a
     * sparse party list; it was **"Member of the Althing"**, an office. P527 is
     * "has part(s)", and a chamber's parts are not its parties.
     *
     * Measured across eight countries, the unconstrained clause returned the
     * Monarch of the United Kingdom, the Bundesrat Library, the Enquete
     * Commission on Afghanistan, the Finance Committee of the French National
     * Assembly, and bare Q-ids. **Not one political party.**
     *
     * Constraining ?party to be a political party returns zero rows for every
     * country tried, which is the honest answer and renders as "Wikidata
     * records no party composition for this chamber". A real sourcing route is
     * OPEN-QUESTIONS 30.
     */
    assert.match(buildLegislatureQuery('GBR'), /\?party wdt:P31/, 'the party-type constraint is gone');

    for (const iso of ['gbr', 'isl']) {
      const chambers = parseLegislature(capture(`legislature-${iso}`));
      for (const chamber of chambers) {
        assert.deepEqual(
          chamber.parties,
          [],
          `${iso}: ${chamber.label} reports parties, which no live capture has ever legitimately produced`,
        );
      }
    }
  });

  it('reports how many rows each capture actually had, rather than implying breadth', () => {
    // Rule 40: a test whose sample is thin should say so, not pass quietly and
    // let a reader infer coverage. Both captures are small BECAUSE the fixes
    // above removed rows that should never have been there.
    assert.deepEqual(rowsAndDistinct(capture('legislature-gbr'), 'chamber'), { rows: 2, distinct: 2 });
    assert.deepEqual(rowsAndDistinct(capture('legislature-isl'), 'chamber'), { rows: 1, distinct: 1 });
  });
});
