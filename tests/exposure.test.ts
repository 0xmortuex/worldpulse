import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GlobeEvent } from '../src/layers/events';
import { decompose, exposureFor, footprintKm } from '../src/layers/exposure';

/**
 * Phase C.2 — population-exposed significance.
 *
 * The DATA is blocked: WorldPop sends no CORS header, its stats service timed
 * out at 30s, and its licence page 404s while HDX records the dataset as
 * `isopen: false`. A licence this project cannot read is not ingested
 * (OPEN-QUESTIONS 32).
 *
 * The MECHANISM is built and tested anyway, because it is pure geometry — and
 * because the most important behaviour is what it does when the source is
 * missing, which is exactly the state it is in.
 */

function quake(over: Partial<GlobeEvent> = {}): GlobeEvent {
  return {
    id: 'q1',
    layer: 'usgs:earthquakes',
    title: 'Test quake',
    lat: 0,
    lng: 0,
    time: '2026-08-16T00:00:00.000Z',
    magnitude: 6,
    positionFact: { value: '0, 0', asOf: '2026', tier: 'OFFICIAL', provenance: null },
    positionKind: 'measured',
    tier: 'OFFICIAL',
    sourceId: 'usgs',
    stale: false,
    ...over,
  } as GlobeEvent;
}

describe('a missing population source is NOT zero exposure', () => {
  it('returns null with a reason, never 0', () => {
    /**
     * The distinction the whole feature turns on. Zero would be a claim that
     * nobody lives near the event; null is a statement about this app. Question
     * 13's rule, applied before the data exists rather than retrofitted after.
     */
    const result = exposureFor(quake(), null, null);
    assert.equal(result.exposed, null);
    assert.notEqual(result.exposed, 0);
    assert.match(result.unavailableReason ?? '', /gap in this app/i);
    assert.match(result.unavailableReason ?? '', /not a finding that nobody lives there/i);
  });

  it('an EMPTY grid is zero, because a source answered', () => {
    // The other side. An empty array means a source was consulted and found
    // nobody in range — a fact about the place, not about us.
    const result = exposureFor(quake(), [], null);
    assert.equal(result.exposed, 0);
    assert.equal(result.unavailableReason, null);
  });

  it('the two cases are distinguishable by a caller', () => {
    const missing = exposureFor(quake(), null, null);
    const empty = exposureFor(quake(), [], null);
    assert.notEqual(missing.exposed, empty.exposed);
  });
});

describe('the footprint is a stated convention, not a physical claim', () => {
  it('grows with magnitude and stays bounded', () => {
    assert.ok(footprintKm(quake({ magnitude: 7 })) > footprintKm(quake({ magnitude: 4 })));
    assert.ok(footprintKm(quake({ magnitude: 9.5 })) <= 500, 'a footprint went effectively global');
    assert.ok(footprintKm(quake({ magnitude: 1 })) >= 10, 'a small event lost its footprint entirely');
  });

  it('an event with no magnitude still has a footprint', () => {
    // Layers without a magnitude concept must not produce NaN radii.
    const radius = footprintKm(quake({ magnitude: null }));
    assert.ok(Number.isFinite(radius) && radius > 0);
  });
});

describe('exposure sums only what is inside the footprint', () => {
  it('includes near cells and excludes far ones', () => {
    const near = { lat: 0.05, lng: 0.05, people: 1000 };
    const far = { lat: 40, lng: 40, people: 9_000_000 };
    const result = exposureFor(quake({ magnitude: 5 }), [near, far], null);

    assert.equal(result.exposed, 1000, 'a distant cell was counted');
    assert.equal(result.contributing.length, 1);
  });

  it('IS DECOMPOSABLE — the inspector can show the cells', () => {
    /**
     * Rule 22 and the no-composite-scores prohibition. An exposure figure is a
     * sum over cells, and a reader must be able to take it apart. A number that
     * cannot be decomposed is a number nobody can check.
     */
    const cells = [
      { lat: 0.01, lng: 0.01, people: 500 },
      { lat: 0.02, lng: 0.02, people: 1500 },
    ];
    const result = exposureFor(quake({ magnitude: 5 }), cells, null);
    const parts = decompose(result);

    assert.equal(parts.length, 2);
    assert.equal(parts.reduce((sum, part) => sum + part.people, 0), result.exposed);
    assert.match(parts[0]?.label ?? '', /km away/, 'the decomposition does not say how far each cell is');
  });

  it('a missing source decomposes to nothing rather than to a fake breakdown', () => {
    assert.deepEqual(decompose(exposureFor(quake(), null, null)), []);
  });
});
