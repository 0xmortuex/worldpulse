import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  COARSEST_DECIMALS,
  FORBIDDEN_TERMS,
  KEY_PLACEHOLDER,
  LABEL,
  bindPrecision,
  buildAreaUrl,
  decimalsForFootprint,
  detectionCountFact,
  parse,
  readAcquiredAt,
  readConfidence,
} from '../src/sources/firms';
import { ShapeError, type FetchContext } from '../src/sources/adapter';

const CSV = readFileSync(new URL('./fixtures/layers/firms-med.csv', import.meta.url), 'utf8');
const LIVE = parse(CSV);

const CTX: FetchContext = {
  requestUrl: buildAreaUrl({ source: 'VIIRS_NOAA20_NRT', bbox: [-10, 30, 40, 46], dayRange: 1 }),
  httpStatus: 200,
  fetchedAt: '2026-08-15T15:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

describe('FIRMS — the URL the app builds', () => {
  it('emits the placeholder and never a key', () => {
    const url = buildAreaUrl({ source: 'VIIRS_NOAA20_NRT', bbox: [-10, 30, 40, 46], dayRange: 1 });
    assert.ok(url.includes(KEY_PLACEHOLDER), 'the builder lost its placeholder');
    // The recorded URL is this one. A path key would be structurally inseparable
    // from it, which is why the substitution happens only at fetch time.
    assert.equal(/[0-9a-f]{32}/i.test(url), false, 'something key-shaped is in the URL');
  });

  it('refuses a dayRange outside the documented range rather than sending it', () => {
    for (const bad of [0, 11, 1.5, -1]) {
      assert.throws(
        () => buildAreaUrl({ source: 'VIIRS_NOAA20_NRT', bbox: [0, 0, 1, 1], dayRange: bad }),
        ShapeError,
      );
    }
  });
});

describe('FIRMS — precision is bound to the sensor footprint (B4)', () => {
  /**
   * THE ACCEPTANCE CRITERION, as arithmetic rather than as a note.
   *
   * FIRMS publishes coordinates to five decimals — about 1.1 m — for pixels that
   * measured 380–750 m across. For this source, false precision does not merely
   * look overconfident: a point plotted to the metre reads as a strike location,
   * which is the one reading the standing prohibition forbids.
   */
  it('never renders a coordinate finer than the pixel it came from', () => {
    for (const detection of LIVE) {
      const decimals = (String(detection.latitude).split('.')[1] ?? '').length;
      const allowed = decimalsForFootprint(detection.footprintKm);
      assert.ok(
        decimals <= allowed,
        `${detection.latitude} has ${decimals} decimals for a ${detection.footprintKm} km pixel (max ${allowed})`,
      );
    }
  });

  it('the published coordinates really were finer, so the binding is doing work', () => {
    // A guard that changes nothing is a guard nobody has watched work.
    const published = CSV.trim().split(/\r?\n/).slice(1, 40).map((line) => line.split(',')[0] ?? '');
    const fine = published.filter((lat) => (lat.split('.')[1] ?? '').length >= 4);
    assert.ok(fine.length > 0, 'the source no longer publishes fine coordinates; this test is now vacuous');
  });

  it('a coarser pixel earns fewer decimals, monotonically', () => {
    assert.ok(decimalsForFootprint(0.375) >= decimalsForFootprint(1));
    assert.ok(decimalsForFootprint(1) >= decimalsForFootprint(5));
    assert.equal(bindPrecision(43.43968, 0.375), 43.44);
  });

  it('an unusable footprint falls back to the coarsest, never the finest', () => {
    // Rule 29's polarity: undeclared must fail closed.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(decimalsForFootprint(bad), COARSEST_DECIMALS);
    }
  });
});

describe('FIRMS — the two hazards a shared field name hides', () => {
  /**
   * `confidence` is a CATEGORY for VIIRS and a 0–100 NUMBER for MODIS, under one
   * column name. Comparing them is rule 22's aggregation across kinds, and it is
   * invisible: both are "confidence", both sort, both render.
   */
  it('reads confidence on the scale the instrument actually uses', () => {
    assert.equal(readConfidence('n', 'VIIRS'), 'nominal');
    assert.equal(readConfidence('l', 'VIIRS'), 'low');
    assert.equal(readConfidence('h', 'VIIRS'), 'high');

    assert.equal(readConfidence('20', 'MODIS'), 'low');
    assert.equal(readConfidence('50', 'MODIS'), 'nominal');
    assert.equal(readConfidence('95', 'MODIS'), 'high');

    // The trap: a MODIS number read on the VIIRS scale, and vice versa.
    assert.equal(readConfidence('80', 'VIIRS'), 'unknown', 'a number is not a VIIRS category');
    assert.equal(readConfidence('n', 'MODIS'), 'unknown', 'a category is not a MODIS percentage');
  });

  /**
   * `acq_time` is HHMM as an integer WITHOUT leading zeros. `35` is 00:35.
   * Parsed naively, every detection before 10:00 UTC gets the wrong time — and
   * that is where the data is densest, because overnight passes have the best
   * thermal contrast.
   */
  it('reads acq_time as HHMM, not as minutes', () => {
    assert.equal(readAcquiredAt('2026-08-15', '35'), '2026-08-15T00:35:00Z');
    assert.equal(readAcquiredAt('2026-08-15', '135'), '2026-08-15T01:35:00Z');
    assert.equal(readAcquiredAt('2026-08-15', '1015'), '2026-08-15T10:15:00Z');
    assert.equal(readAcquiredAt('2026-08-15', '0'), '2026-08-15T00:00:00Z');
  });

  it('the live capture actually contains pre-10:00 times, so that case is exercised', () => {
    const early = LIVE.filter((d) => d.acquiredAt.slice(11, 16) < '10:00');
    assert.ok(early.length > 0, 'no pre-10:00 detections in this capture — the trap is untested here');
  });

  it('refuses a malformed time rather than guessing', () => {
    assert.throws(() => readAcquiredAt('2026-08-15', '2500'), ShapeError);
    assert.throws(() => readAcquiredAt('2026-08-15', '1275'), ShapeError);
    assert.throws(() => readAcquiredAt('2026-08-15', 'noon'), ShapeError);
    assert.throws(() => readAcquiredAt('15/08/2026', '1015'), ShapeError);
  });
});

describe('FIRMS — the labelling rule, asserted rather than remembered', () => {
  /**
   * A standing prohibition that lives only in a comment is one refactor away
   * from gone. This is the assertion that makes it survive one.
   */
  it('calls the data thermal anomalies', () => {
    assert.equal(LABEL, 'thermal anomalies');
  });

  it('never describes detections as strikes, shelling or combat', () => {
    const rendered = detectionCountFact(LIVE, CTX, 'the last 24 hours');
    const text = `${LABEL} ${rendered.note ?? ''}`.toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      assert.equal(text.includes(term), false, `the rendered note used "${term}"`);
    }
  });

  it('says a row is a detection rather than a fire, and counts as DERIVED', () => {
    /**
     * Rule 38 asked for the aggregate discriminator. FIRMS has none, because the
     * rows are not aggregates — which is exactly why counting them as fires
     * OVER-counts: one fire across two satellites and three days is many rows.
     */
    const fact = detectionCountFact(LIVE, CTX, 'the last 24 hours');
    assert.equal(fact.tier, 'DERIVED');
    assert.match(fact.note ?? '', /not one fire/i);
    assert.match(fact.note ?? '', /gas flares|agricultural/i);
  });
});

describe('FIRMS — planted cases (rule 27)', () => {
  const header =
    'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

  it('an empty result is no detections, not an error', () => {
    // Rule 30: FIRMS returns a header and nothing else for a quiet bbox, which
    // is "we looked and there was nothing".
    assert.deepEqual(parse(header), []);
  });

  it('refuses a response missing a column it depends on', () => {
    assert.throws(() => parse('latitude,longitude\n1,2'), ShapeError);
    assert.throws(() => parse('latitude,longitude\n1,2'), /no "scan" column/);
  });

  it('an absent FRP is absent, never zero', () => {
    // Zero radiative power would mean a detection with no heat, which the sensor
    // cannot report.
    const row = `${header}\n43.4,4.9,303,0.63,0.72,2026-08-15,35,N20,VIIRS,n,2.0NRT,290,,N`;
    assert.equal(parse(row)[0]!.frpMw, null);
  });

  it('the coarser pixel dimension governs, not the finer', () => {
    const row = `${header}\n43.43968,4.89286,303,0.38,5.0,2026-08-15,35,N20,VIIRS,n,2.0NRT,290,1.88,N`;
    const detection = parse(row)[0]!;
    assert.equal(detection.footprintKm, 5, 'the smaller dimension was used');
    assert.equal(detection.latitude, bindPrecision(43.43968, 5));
  });

  it('refuses a non-numeric coordinate rather than plotting NaN', () => {
    const row = `${header}\nnorth,4.9,303,0.63,0.72,2026-08-15,35,N20,VIIRS,n,2.0NRT,290,1.88,N`;
    assert.throws(() => parse(row), ShapeError);
  });
});
