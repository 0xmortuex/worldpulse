import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fixture from './fixtures/portwatch-chokepoints.json' with { type: 'json' };

/**
 * Contract test for IMF PortWatch daily chokepoint data.
 *
 * Rule 4: shape and range, never current values. Transit counts change daily and
 * pinning one would fail every week for the wrong reason.
 *
 * The fixture is a REAL CAPTURE, not hand-authored from documentation — the
 * first in this directory, because browser and Node egress both reach the origin
 * from this machine. Its query is pinned to a fixed chokepoint and date window
 * (`chokepoint1`, August 2026, days 1-7) so re-fetching returns the same rows and
 * the fixture stays reproducible rather than drifting with the calendar.
 */

interface Attributes {
  date: string;
  year: number;
  month: number;
  day: number;
  portid: string;
  portname: string;
  n_container: number;
  n_dry_bulk: number;
  n_general_cargo: number;
  n_roro: number;
  n_tanker: number;
  n_cargo: number;
  n_total: number;
  capacity_container: number;
  capacity_dry_bulk: number;
  capacity_general_cargo: number;
  capacity_roro: number;
  capacity_tanker: number;
  capacity_cargo: number;
  capacity: number;
}

const features = (fixture as { features: Array<{ attributes: Attributes }> }).features;
const fields = (fixture as { fields: Array<{ name: string; type: string; alias?: string; description?: string | null }> })
  .fields;
const rows = features.map((feature) => feature.attributes);

const COUNT_FIELDS = ['n_container', 'n_dry_bulk', 'n_general_cargo', 'n_roro', 'n_tanker', 'n_cargo', 'n_total'] as const;
const CAPACITY_FIELDS = [
  'capacity_container',
  'capacity_dry_bulk',
  'capacity_general_cargo',
  'capacity_roro',
  'capacity_tanker',
  'capacity_cargo',
  'capacity',
] as const;

describe('PortWatch chokepoints — contract', () => {
  it('returned rows at all, so everything below measures something', () => {
    // Rule 16: an empty response would make every assertion below vacuously true.
    assert.ok(rows.length > 0, 'fixture has no features');
    assert.ok(fields.length > 0, 'fixture has no field metadata');
  });

  it('every documented field is present with the documented type', () => {
    const byName = new Map(fields.map((field) => [field.name, field.type]));
    for (const name of [...COUNT_FIELDS, ...CAPACITY_FIELDS]) {
      assert.equal(byName.get(name), 'esriFieldTypeInteger', `${name} is not an integer field`);
    }
    assert.equal(byName.get('portid'), 'esriFieldTypeString');
    assert.equal(byName.get('portname'), 'esriFieldTypeString');
    assert.ok(byName.has('date'), 'date field missing');
  });

  it('counts and capacities are non-negative and finite', () => {
    for (const row of rows) {
      for (const name of COUNT_FIELDS) {
        assert.ok(Number.isInteger(row[name]) && row[name] >= 0, `${name} out of range: ${row[name]}`);
      }
      for (const name of CAPACITY_FIELDS) {
        assert.ok(Number.isFinite(row[name]) && row[name] >= 0, `${name} out of range: ${row[name]}`);
      }
    }
  });

  it('dates parse and agree with their own year/month/day parts', () => {
    for (const row of rows) {
      const parsed = new Date(`${row.date}T00:00:00Z`);
      assert.ok(!Number.isNaN(parsed.getTime()), `unparseable date: ${row.date}`);
      assert.equal(parsed.getUTCFullYear(), row.year);
      assert.equal(parsed.getUTCMonth() + 1, row.month);
      assert.equal(parsed.getUTCDate(), row.day);
    }
  });

  /**
   * The source documents these as sums, so they are invariants rather than
   * incidental properties of this week's data (rule 25).
   */
  it('ship counts sum exactly, as the source defines them', () => {
    for (const row of rows) {
      const cargo = row.n_container + row.n_dry_bulk + row.n_general_cargo + row.n_roro;
      assert.equal(row.n_cargo, cargo, `n_cargo != sum of cargo categories on ${row.date}`);
      assert.equal(row.n_total, cargo + row.n_tanker, `n_total != n_cargo + n_tanker on ${row.date}`);
    }
  });

  it('capacities sum to within rounding, NOT exactly', () => {
    /**
     * THE TOLERANCE'S BASIS IS ROUNDING OF INDEPENDENTLY-ESTIMATED TONNAGES,
     * and it is not a general fudge factor.
     *
     * Measured, not assumed: on 2026-08-01 the four cargo capacities sum to
     * 499,606 against a published `capacity_cargo` of 499,607 — a residual of
     * one ton on a 500,000-ton total. Each component is an estimated payload
     * rounded to whole tons independently, so a residual on the order of one
     * ton per summand is the arithmetic working correctly. Asserting exact
     * equality would encode an incidental property of one response rather than
     * the invariant that components account for the total (rule 25).
     *
     * **A residual beyond this class is a finding, not a tolerance to widen.**
     * Rounding of four and five summands cannot produce tens of tons; that
     * would mean a category dropped, a field re-pointed, or a unit changed. The
     * next session to see this fail should investigate the cause, because a
     * tolerance widened to absorb a failure is a loosened assertion wearing a
     * justification.
     */
    for (const row of rows) {
      const cargo = row.capacity_container + row.capacity_dry_bulk + row.capacity_general_cargo + row.capacity_roro;
      const cargoResidual = Math.abs(row.capacity_cargo - cargo);
      assert.ok(
        cargoResidual <= 4,
        `capacity_cargo ${row.capacity_cargo} vs summed ${cargo} on ${row.date}: residual ${cargoResidual}t ` +
          'exceeds rounding of 4 independently-rounded tonnage estimates — investigate a dropped category, ' +
          'a re-pointed field or a unit change; do NOT widen this tolerance',
      );

      const totalResidual = Math.abs(row.capacity - (cargo + row.capacity_tanker));
      assert.ok(
        totalResidual <= 5,
        `capacity ${row.capacity} vs summed ${cargo + row.capacity_tanker} on ${row.date}: residual ` +
          `${totalResidual}t exceeds rounding of 5 independently-rounded tonnage estimates — ` +
          'investigate rather than widen',
      );
    }
  });

  /**
   * Rule 22's authority problem, asserted rather than trusted.
   *
   * "Metric tons" comes from the catalogue item description. The service's own
   * field metadata carries empty descriptions and aliases that merely echo the
   * field names, so there is nothing at the API level saying what a capacity is
   * measured in. That is a disagreement waiting to happen: if the IMF ever
   * populates field metadata with a different unit, the app would keep rendering
   * the description's unit and be silently wrong.
   *
   * So this asserts the two do not contradict each other, and fails loudly if
   * the service ever starts claiming a unit that is not metric tons — rather
   * than preferring either source by default.
   */
  it('field metadata does not contradict the catalogue unit of metric tons', () => {
    const UNIT_WORD = /\b(ton|tonne|tonnes|tons|kg|kilogram|teu|dwt|deadweight|barrel|cubic)\b/i;
    for (const field of fields) {
      if (!field.name.startsWith('capacity')) continue;
      const claims = `${field.alias ?? ''} ${field.description ?? ''}`.trim();
      if (!UNIT_WORD.test(claims)) continue;
      assert.match(
        claims,
        /\b(metric\s+)?(ton|tonne|tonnes|tons)\b/i,
        `${field.name} metadata now claims a unit that is not metric tons: "${claims}" — ` +
          'the catalogue description and the field metadata disagree, and neither may be preferred silently',
      );
    }
  });

  it('identifies the chokepoint it was queried for', () => {
    for (const row of rows) {
      assert.equal(row.portid, 'chokepoint1');
      assert.ok(row.portname.length > 0, 'portname is empty');
    }
  });
});
