import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { parse as parseQuakes, toGlobeEvents } from '../src/sources/usgs';
import { parseEvents as parseEonet } from '../src/sources/eonet';
import {
  CLUSTER_RADIUS_KM,
  clusterEvents,
  distanceKm,
  magnitudeLegend,
  normaliseLongitude,
  QUAKE_SCALE,
  radiusForMagnitude,
  ringCentroid,
  STALE_AFTER_DAYS,
} from '../src/layers/events';

const NOW = new Date('2026-08-11T00:00:00Z');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/layers', `${name}.json`), 'utf8'));
}

function quakeEvents(name: string) {
  return toGlobeEvents(parseQuakes(fixture(name)), NOW);
}

describe('hard case — antimeridian and poles', () => {
  it('keeps longitudes near the antimeridian on their own side', () => {
    const events = quakeEvents('quakes-edges');
    const east = events.find((event) => event.id === 'edge-east');
    const west = events.find((event) => event.id === 'edge-west');
    assert.ok(east && west);
    assert.ok(east.lng > 179, `expected ~179.94, got ${east.lng}`);
    assert.ok(west.lng < -179, `expected ~-179.96, got ${west.lng}`);
    // They are ~10km apart in reality; a naive wrap would put them a world away.
    assert.ok(distanceKm(east, west) < 50, `wrapped apart: ${distanceKm(east, west)}km`);
  });

  it('normalises exactly-180 to a single canonical meridian', () => {
    assert.equal(normaliseLongitude(180), 180);
    assert.equal(normaliseLongitude(-180), 180);
    assert.equal(normaliseLongitude(200), -160);
    assert.equal(normaliseLongitude(-200), 160);
    assert.equal(normaliseLongitude(0), 0);
  });

  it('keeps polar events at their real latitude', () => {
    const events = quakeEvents('quakes-edges');
    assert.equal(events.find((event) => event.id === 'pole-north')?.lat, 89.6);
    assert.equal(events.find((event) => event.id === 'pole-south')?.lat, -89.4);
  });

  it('does not treat 0,0 as a missing coordinate', () => {
    // Null island is a real place and a real fixture value; dropping it would
    // silently lose any event whose coordinates happen to be zero.
    const zero = quakeEvents('quakes-edges').find((event) => event.id === 'equator-zero');
    assert.ok(zero);
    assert.equal(zero.lat, 0);
    assert.equal(zero.lng, 0);
  });
});

describe('hard case — coincident events', () => {
  it('clusters an aftershock sequence rather than stacking it', () => {
    // Stacked markers leave only the topmost pickable: the globe's version of a
    // UI element that resolves to the wrong record.
    const events = quakeEvents('quakes-aftershocks');
    assert.equal(events.length, 7);
    const clusters = clusterEvents(events);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.members.length, 7);
  });

  it('puts the marker on the strongest member, never on an average', () => {
    // An averaged position is a place where nothing happened.
    const events = quakeEvents('quakes-aftershocks');
    const cluster = clusterEvents(events)[0];
    assert.ok(cluster);
    const strongest = [...events].sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))[0];
    assert.ok(strongest);
    assert.equal(cluster.id, strongest.id);
    assert.equal(cluster.lat, strongest.lat);
    assert.equal(cluster.lng, strongest.lng);
  });

  it('keeps every member reachable through the cluster', () => {
    const events = quakeEvents('quakes-aftershocks');
    const reachable = new Set(clusterEvents(events).flatMap((cluster) => cluster.members.map((m) => m.id)));
    assert.equal(reachable.size, events.length);
  });

  it('does not merge events that are genuinely apart', () => {
    const events = quakeEvents('quakes-spread');
    const clusters = clusterEvents(events);
    assert.equal(clusters.length, events.length);
  });

  it('clusters strictly by the stated radius', () => {
    const near = { lat: 0, lng: 0 };
    const far = { lat: 0, lng: 1 }; // ~111km
    assert.ok(distanceKm(near, far) > CLUSTER_RADIUS_KM);
  });
});

describe('hard case — EONET polygon geometries', () => {
  it('marks a polygon-derived position as DERIVED, not measured', () => {
    const events = parseEonet(fixture('eonet-mixed'), NOW);
    const fire = events.find((event) => event.id === 'EONET_2');
    assert.ok(fire);
    assert.equal(fire.positionKind, 'derived-centroid');
    assert.equal(fire.tier, 'DERIVED');
    assert.equal(fire.perimeterVertices, 5);
  });

  it('leaves a point geometry measured and OFFICIAL', () => {
    const volcano = parseEonet(fixture('eonet-mixed'), NOW).find((event) => event.id === 'EONET_1');
    assert.ok(volcano);
    assert.equal(volcano.positionKind, 'measured');
    assert.equal(volcano.tier, 'OFFICIAL');
  });

  it('computes a centroid inside its ring', () => {
    const centre = ringCentroid([
      [-120.5, 38.5],
      [-120.1, 38.5],
      [-120.1, 38.9],
      [-120.5, 38.9],
      [-120.5, 38.5],
    ]);
    assert.ok(centre.lng > -120.5 && centre.lng < -120.1, `lng ${centre.lng} outside ring`);
    assert.ok(centre.lat > 38.5 && centre.lat < 38.9, `lat ${centre.lat} outside ring`);
  });

  it('does not put an antimeridian-crossing centroid on the far side of the planet', () => {
    // Averaging 179.6 and -179.7 naively gives ~0 — the Gulf of Guinea.
    const fire = parseEonet(fixture('eonet-mixed'), NOW).find((event) => event.id === 'EONET_5');
    assert.ok(fire);
    assert.ok(Math.abs(fire.lng) > 179, `centroid landed at lng ${fire.lng}`);
    assert.ok(fire.lat > -17.1 && fire.lat < -16.5);
  });

  it('follows an event to its most recent geometry', () => {
    const storm = parseEonet(fixture('eonet-mixed'), NOW).find((event) => event.id === 'EONET_3');
    assert.ok(storm);
    assert.equal(storm.lng, -52);
    assert.equal(storm.time, '2026-08-08T00:00:00Z');
  });
});

describe('hard case — stale open events', () => {
  it('flags an event open since 2019 rather than treating it as live', () => {
    const events = parseEonet(fixture('eonet-mixed'), NOW);
    const old = events.find((event) => event.id === 'EONET_4');
    assert.ok(old);
    assert.equal(old.stale, true);
    assert.ok((old.staleDays ?? 0) > STALE_AFTER_DAYS);
  });

  it('does not flag a recent open event', () => {
    const recent = parseEonet(fixture('eonet-mixed'), NOW).find((event) => event.id === 'EONET_2');
    assert.equal(recent?.stale, false);
  });

  it('keeps stale events in the data rather than deleting them', () => {
    // Deleting would hide real history. The policy is exclusion from the default
    // active view plus a label, not removal.
    const events = parseEonet(fixture('eonet-mixed'), NOW);
    assert.equal(events.length, 5);
    assert.equal(events.filter((event) => event.stale).length, 1);
  });
});

describe('magnitude scaling', () => {
  it('never lets a small event become invisible', () => {
    for (const magnitude of [-1, 0, 1, 2.5, 4]) {
      assert.ok(radiusForMagnitude(magnitude) >= QUAKE_SCALE.minRadius);
    }
  });

  it('bounds the largest event so it cannot swamp the rest', () => {
    assert.equal(radiusForMagnitude(9.9), QUAKE_SCALE.maxRadius);
    const ratio = radiusForMagnitude(8) / radiusForMagnitude(4);
    assert.ok(ratio < 3, `an M8 is ${ratio.toFixed(1)}x an M4 on screen; too dominant`);
    assert.ok(ratio > 1.4, `an M8 is only ${ratio.toFixed(1)}x an M4; not distinguishable`);
  });

  it('is monotonic, so a bigger dot always means a bigger quake', () => {
    const radii = [1, 2, 3, 4, 5, 6, 7, 8].map((m) => radiusForMagnitude(m));
    for (let i = 1; i < radii.length; i += 1) {
      assert.ok((radii[i] as number) > (radii[i - 1] as number));
    }
  });

  it('gives a missing magnitude the minimum size, not zero', () => {
    assert.equal(radiusForMagnitude(null), QUAKE_SCALE.minRadius);
  });

  it('publishes a legend so size is read from a key, not guessed', () => {
    const legend = magnitudeLegend();
    assert.equal(legend.length, 4);
    assert.deepEqual(legend.map((step) => step.magnitude), [2, 4, 6, 8]);
  });
});

describe('count fidelity', () => {
  it('maps every parsed quake to exactly one event', () => {
    const feed = parseQuakes(fixture('quakes-spread'));
    assert.equal(toGlobeEvents(feed, NOW).length, feed.quakes.length);
  });

  it('maps every EONET event, including the stale one', () => {
    const raw = fixture('eonet-mixed') as { events: unknown[] };
    assert.equal(parseEonet(raw, NOW).length, raw.events.length);
  });
});
