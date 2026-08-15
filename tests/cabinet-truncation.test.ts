import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CABINET_ROW_LIMIT, parseCabinet } from '../src/sources/wikidata-government';

/**
 * The truncation the timeout was hiding.
 *
 * Measured 2026-08-15, immediately after the cabinet query stopped timing out:
 * the United Kingdom returns **exactly 300 rows against `LIMIT 300`**. Its
 * cabinet is cut off, the true count is unknown, and nothing said so — 300
 * ministries is a plausible number and there is no error.
 *
 * **The truncation is older than the fix.** The query used to 504 for the United
 * Kingdom, so it never returned rows to be truncated. Repairing the timeout did
 * not create this defect; it revealed one that a louder failure had been masking.
 */

function rows(count: number, opts: { holdersPerPosition?: number } = {}): unknown {
  const perPosition = opts.holdersPerPosition ?? 1;
  const bindings = [];
  for (let i = 0; i < count; i += 1) {
    const position = `http://www.wikidata.org/entity/Q${1000 + Math.floor(i / perPosition)}`;
    bindings.push({
      position: { value: position },
      positionLabel: { value: `Ministry ${Math.floor(i / perPosition)}` },
      holder: { value: `http://www.wikidata.org/entity/P${i}` },
      holderLabel: { value: `Holder ${i}` },
    });
  }
  return { head: { vars: ['position', 'positionLabel', 'holder', 'holderLabel'] }, results: { bindings } };
}

describe('a saturated cabinet response is reported, not rendered as complete', () => {
  it('flags truncation when the row count reaches the limit', () => {
    const cabinet = parseCabinet(rows(CABINET_ROW_LIMIT));
    assert.equal(cabinet.truncated, true, 'a full page was not reported as truncated');
  });

  it('does not flag a response one row short of the limit', () => {
    // The pair, per rule 42: a flag that is always true reports nothing.
    const cabinet = parseCabinet(rows(CABINET_ROW_LIMIT - 1));
    assert.equal(cabinet.truncated, false);
  });

  it('an ordinary small cabinet is not flagged', () => {
    assert.equal(parseCabinet(rows(33)).truncated, false);
  });

  /**
   * THE CASE A MINISTRY-COUNT CHECK WOULD MISS.
   *
   * `ministries` collapses rows by position, so 300 truncated rows carrying
   * several holder statements each can collapse to a handful of ministries and
   * look completely unremarkable. Saturation is a property of the ROWS the
   * server returned, and must be measured there.
   */
  it('detects saturation even when the collapsed list looks small', () => {
    const cabinet = parseCabinet(rows(CABINET_ROW_LIMIT, { holdersPerPosition: 30 }));
    assert.ok(cabinet.ministries.length < 20, 'the fixture should collapse heavily');
    assert.equal(cabinet.truncated, true, 'saturation was measured on the collapsed view');
  });

  it('an empty response is not truncated', () => {
    // Rule 30: nothing returned is an answer, not a cut-off one.
    const cabinet = parseCabinet(rows(0));
    assert.equal(cabinet.truncated, false);
    assert.deepEqual(cabinet.ministries, []);
  });
});
