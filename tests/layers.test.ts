import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { parse as parseQuakes, toGlobeEvents } from '../src/sources/usgs';
import { parseEvents as parseEonet } from '../src/sources/eonet';
import { factState } from '../src/facts/types';
import { loadEvents } from '../src/layers/provider';
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

const CTX = {
  requestUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  httpStatus: 200,
  fetchedAt: '1970-01-01T00:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
} as const;

function quakeEvents(name: string) {
  return toGlobeEvents(parseQuakes(fixture(name)), NOW, CTX);
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
    const events = parseEonet(fixture('eonet-mixed'), NOW, CTX);
    const fire = events.find((event) => event.id === 'EONET_2');
    assert.ok(fire);
    assert.equal(fire.positionKind, 'derived-centroid');
    assert.equal(fire.tier, 'DERIVED');
    assert.equal(fire.perimeterVertices, 5);
  });

  it('leaves a point geometry measured and OFFICIAL', () => {
    const volcano = parseEonet(fixture('eonet-mixed'), NOW, CTX).find((event) => event.id === 'EONET_1');
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
    const fire = parseEonet(fixture('eonet-mixed'), NOW, CTX).find((event) => event.id === 'EONET_5');
    assert.ok(fire);
    assert.ok(Math.abs(fire.lng) > 179, `centroid landed at lng ${fire.lng}`);
    assert.ok(fire.lat > -17.1 && fire.lat < -16.5);
  });

  it('follows an event to its most recent geometry', () => {
    const storm = parseEonet(fixture('eonet-mixed'), NOW, CTX).find((event) => event.id === 'EONET_3');
    assert.ok(storm);
    assert.equal(storm.lng, -52);
    assert.equal(storm.time, '2026-08-08T00:00:00Z');
  });
});

describe('hard case — stale open events', () => {
  it('flags an event open since 2019 rather than treating it as live', () => {
    const events = parseEonet(fixture('eonet-mixed'), NOW, CTX);
    const old = events.find((event) => event.id === 'EONET_4');
    assert.ok(old);
    assert.equal(old.stale, true);
    assert.ok((old.staleDays ?? 0) > STALE_AFTER_DAYS);
  });

  it('does not flag a recent open event', () => {
    const recent = parseEonet(fixture('eonet-mixed'), NOW, CTX).find((event) => event.id === 'EONET_2');
    assert.equal(recent?.stale, false);
  });

  it('keeps stale events in the data rather than deleting them', () => {
    // Deleting would hide real history. The policy is exclusion from the default
    // active view plus a label, not removal.
    const events = parseEonet(fixture('eonet-mixed'), NOW, CTX);
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

describe('magnitude provenance', () => {
  it('gives every quake event a magnitude fact that agrees with the number it was sized by', () => {
    for (const event of quakeEvents('quakes-spread')) {
      assert.ok(event.magnitudeFact, `${event.id} has no magnitude fact`);
      assert.equal(
        event.magnitudeFact.value,
        event.magnitude,
        `${event.id} renders a different magnitude than it is drawn at`,
      );
    }
  });

  it('carries a traceable provenance, not merely a tier', () => {
    const [event] = quakeEvents('quakes-spread');
    assert.ok(event?.magnitudeFact);
    assert.equal(factState(event.magnitudeFact), 'ok', 'a BROKEN fact would render as untraceable');
    const provenance = event.magnitudeFact.provenance;
    assert.equal(provenance?.kind, 'fetch');
    assert.ok(provenance.kind === 'fetch' && provenance.extractedBy.includes(event.id));
  });

  it('does not let an unreviewed solution claim OFFICIAL', () => {
    const events = quakeEvents('quakes-provisional');
    const automatic = events.find((event) => event.id === 'prov-automatic');
    assert.ok(automatic?.magnitudeFact);
    assert.equal(automatic.magnitudeFact.tier, 'ESTIMATE');
    assert.equal(automatic.tier, 'ESTIMATE', 'the event tier and its magnitude tier must not disagree');
    assert.match(automatic.magnitudeFact.note ?? '', /not yet reviewed/i);
  });

  it('renders a missing magnitude as no data, with its provenance intact', () => {
    const events = quakeEvents('quakes-provisional');
    const missing = events.find((event) => event.id === 'prov-nomag');
    assert.ok(missing?.magnitudeFact);
    assert.equal(missing.magnitude, null);
    assert.equal(missing.magnitudeFact.value, null);
    // 'nodata', not 'broken': the source was asked and had nothing, which is a
    // different statement from a value we cannot trace.
    assert.equal(factState(missing.magnitudeFact), 'nodata');
  });

  it('positive control: the provisional fixture reaches the running globe', () => {
    // Rule 10. The two branches above are only worth testing if the app renders
    // them; an unreachable fixture would make every assertion here vacuous.
    const ids = loadEvents(NOW).map((event) => event.id);
    assert.ok(ids.includes('prov-automatic'), 'automatic solution is not on the globe');
    assert.ok(ids.includes('prov-nomag'), 'magnitude-less event is not on the globe');
  });

  it('leaves layers with no magnitude concept without a fact at all', () => {
    // Distinct from a quake whose magnitude is null: EONET does not measure
    // magnitude, so claiming "no data" for one would invent a missing value.
    for (const event of parseEonet(fixture('eonet-mixed') as { events: unknown[] }, NOW, CTX)) {
      assert.equal(event.magnitudeFact, undefined, `${event.id} carries a magnitude fact it cannot have`);
      assert.equal(event.magnitude, null);
    }
  });
});

describe('position provenance', () => {
  it('badges a measured epicentre with the fetch it came from', () => {
    const [event] = quakeEvents('quakes-spread');
    assert.ok(event);
    assert.equal(event.positionFact.tier, 'OFFICIAL');
    assert.equal(event.positionFact.provenance?.kind, 'fetch');
    assert.equal(factState(event.positionFact), 'ok');
    assert.equal(event.positionFact.value, `${event.lat.toFixed(3)}, ${event.lng.toFixed(3)}`);
  });

  it('does not let an unreviewed epicentre claim OFFICIAL', () => {
    const automatic = quakeEvents('quakes-provisional').find((event) => event.id === 'prov-automatic');
    assert.equal(automatic?.positionFact.tier, 'ESTIMATE');
  });

  it('records a centroid as a derivation, not as a reported location', () => {
    const fire = parseEonet(fixture('eonet-mixed'), NOW, CTX).find((event) => event.id === 'EONET_2');
    assert.ok(fire);
    assert.equal(fire.positionFact.tier, 'DERIVED');
    const provenance = fire.positionFact.provenance;
    assert.equal(provenance?.kind, 'derived');
    assert.ok(provenance.kind === 'derived');
    // The reduction has to be named. Pointing at the fetch alone would present
    // this app's arithmetic as something NASA reported.
    assert.match(provenance.formula, /centroid of a 5-vertex polygon perimeter/);
    assert.equal(provenance.inputs.length, 1);
    assert.equal(provenance.inputs[0]?.kind, 'fetch');
  });

  it('keeps a reported EONET point measured rather than derived', () => {
    // Positive control: without it, "derived" could simply be what every EONET
    // position says, which would make the assertion above meaningless.
    const volcano = parseEonet(fixture('eonet-mixed'), NOW, CTX).find((event) => event.id === 'EONET_1');
    assert.equal(volcano?.positionFact.tier, 'OFFICIAL');
    assert.equal(volcano?.positionFact.provenance?.kind, 'fetch');
  });

  it('formats both kinds of position identically', () => {
    // The difference between a measurement and a manufactured centroid belongs
    // in the badge and the provenance. Rendering one to more decimal places
    // would encode confidence in the precision instead.
    for (const event of loadEvents(NOW)) {
      assert.match(event.positionFact.value ?? '', /^-?\d+\.\d{3}, -?\d+\.\d{3}$/, `${event.id}: ${event.positionFact.value}`);
    }
  });
});

describe('count fidelity', () => {
  it('maps every parsed quake to exactly one event', () => {
    const feed = parseQuakes(fixture('quakes-spread'));
    assert.equal(toGlobeEvents(feed, NOW, CTX).length, feed.quakes.length);
  });

  it('maps every EONET event, including the stale one', () => {
    const raw = fixture('eonet-mixed') as { events: unknown[] };
    assert.equal(parseEonet(raw, NOW, CTX).length, raw.events.length);
  });
});
