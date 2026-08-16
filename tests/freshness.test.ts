import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import registry from '../data/sources.json';
import { PROBE_STALE_AFTER_DAYS, freshnessRows, renderFreshness } from '../src/ui/freshness';

/**
 * Phase C.5 — the freshness monitor.
 *
 * The whole design claim is that it is GENERATED, so a source added to the
 * registry cannot be missing from it. That claim is what these tests check —
 * absence is the failure mode a hand-written monitor has, and it looks
 * identical to a source with nothing wrong.
 */

const SOURCES = (registry as { sources: Array<{ id: string }> }).sources;
const NOW = new Date('2026-08-16T00:00:00.000Z');

describe('it covers the registry, by construction', () => {
  it('every registered source has a row — none can be missing', () => {
    const rows = freshnessRows(NOW);
    assert.ok(SOURCES.length > 0, 'the registry is empty; this file would prove nothing');
    assert.equal(rows.length, SOURCES.length, `${rows.length} rows for ${SOURCES.length} sources`);

    const rowIds = new Set(rows.map((row) => row.id));
    for (const source of SOURCES) {
      assert.ok(rowIds.has(source.id), `${source.id} is registered but absent from the monitor`);
    }
  });

  it('a NEVER-PROBED source is its own state, not a very old one', () => {
    /**
     * "We have never checked" and "we checked long ago" are different facts,
     * and only the first means nobody has ever seen the source answer. A
     * monitor that renders never-probed as infinitely stale loses that.
     */
    const rows = freshnessRows(NOW);
    const never = rows.filter((row) => row.state === 'never-probed');
    for (const row of never) {
      assert.equal(row.ageDays, null, `${row.id} reports an age despite never being probed`);
    }
  });

  it('an EXCLUDED source is not stale', () => {
    /**
     * Excluded means deliberately not in use. Flagging it would train a reader
     * to ignore the column that matters — the same reason a disclosure that
     * always fires stops being read.
     */
    const rows = freshnessRows(NOW);
    for (const row of rows.filter((r) => r.state === 'excluded')) {
      assert.equal(row.ageDays, null);
    }
  });
});

describe('the staleness threshold', () => {
  it('separates fresh from stale at the stated boundary', () => {
    const rows = freshnessRows(NOW);
    for (const row of rows) {
      if (row.ageDays === null) continue;
      const expected = row.ageDays > PROBE_STALE_AFTER_DAYS ? 'stale' : 'fresh';
      assert.equal(row.state, expected, `${row.id} at ${row.ageDays} days is ${row.state}`);
    }
  });

  it('the sample contains more than one state, or the check is vacuous', () => {
    // The eighth guard this session to assert its own denominator.
    const states = new Set(freshnessRows(NOW).map((row) => row.state));
    assert.ok(states.size > 1, `every source is "${[...states][0]}" — the monitor distinguishes nothing`);
  });
});

describe('the rendered monitor states its own policy', () => {
  it('says why a threshold exists rather than just applying one', () => {
    const html = renderFreshness(NOW);
    assert.match(html, /decommissioned API/i, 'it does not say what staleness has actually cost');
    assert.match(html, /Generated from the registry/i);
  });

  it('reports all four states, including the ones that are fine', () => {
    const html = renderFreshness(NOW);
    for (const word of ['fresh', 'stale', 'never probed', 'excluded']) {
      assert.match(html, new RegExp(word, 'i'), `the summary omits "${word}"`);
    }
  });
});
