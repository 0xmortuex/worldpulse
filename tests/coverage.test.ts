import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BAND_ENCODING,
  COVERED_PANELS,
  bandFor,
  coverageFor,
  coverageSentence,
  panelsWithDataFor,
  unassessed,
  type CountryCoverage,
} from '../src/coverage';

/**
 * Step 12 — the coverage choropleth's model.
 *
 * This is the one surface where a missing value is the subject rather than an
 * embarrassment, which raises the stakes on two distinctions that are merely
 * important elsewhere:
 *
 *   - a country we never assessed vs one we assessed and found nothing for
 *   - a figure about THIS APP vs a figure about the country
 *
 * Both are asserted here, in both directions.
 */

function coverage(present: number): CountryCoverage {
  const panels = new Set(COVERED_PANELS.slice(0, present));
  return coverageFor({ iso3: 'AAA', panelsWithData: panels });
}

describe('coverage: never assessed is not assessed-and-empty', () => {
  it('a country absent from the map is unassessed, not "Nothing"', () => {
    /**
     * The distinction the whole surface depends on. Painting an unassessed
     * country in the "Nothing" band asserts a measurement nobody took — and on
     * a map, a filled polygon reads as a result.
     */
    const assessed = new Map([['FRA', coverage(3)]]);
    assert.deepEqual(unassessed(['FRA', 'TCD'], assessed), ['TCD']);
    assert.deepEqual(unassessed(['FRA'], assessed), []);
  });

  it('a country with zero panels IS assessed, and lands in the "none" band', () => {
    // The other side. This one WAS measured; the answer was zero.
    const zero = coverage(0);
    assert.equal(zero.band, 'none');
    assert.equal(zero.share, 0);
    assert.notEqual(zero.share, null, 'an assessed country must have a share, even when it is 0');
  });

  it('share is null only when nothing was checked at all', () => {
    const nothingChecked = coverageFor({ iso3: 'AAA', panelsWithData: new Set() });
    // Every panel is still CHECKED here — they just came back empty — so the
    // share is 0 rather than null. Null would mean the denominator was empty.
    assert.equal(nothingChecked.share, 0);
    assert.equal(nothingChecked.absent.length, COVERED_PANELS.length);
  });
});

describe('coverage: the sentence keeps the subject on this app', () => {
  it('never says the country has no data', () => {
    /**
     * "No data for Chad" is heard as a fact about Chad. What is true is that
     * this app has nothing, which is a fact about this app.
     */
    const text = coverageSentence(coverage(0));
    assert.match(text, /this app has nothing/i);
    assert.match(text, /not a finding about the country/i);
    assert.doesNotMatch(text, /country has no data/i);
  });

  it('a covered country reports the count against a stated denominator', () => {
    const text = coverageSentence(coverage(4));
    assert.match(text, new RegExp(`4 of ${COVERED_PANELS.length} panels`));
  });
});

describe('coverage: bands, and what they refuse to imply', () => {
  it('zero present is "none" regardless of how many were checked', () => {
    assert.equal(bandFor(0, 7), 'none');
    assert.equal(bandFor(0, 1), 'none');
  });

  it('nothing checked is "none" rather than a division by zero', () => {
    assert.equal(bandFor(0, 0), 'none');
  });

  it('the bands are monotonic in share', () => {
    // A band that went backwards would make the map's ordering a lie.
    const order = { none: 0, sparse: 1, partial: 2, good: 3 };
    let previous = -1;
    for (let present = 0; present <= 7; present += 1) {
      const rank = order[bandFor(present, 7)];
      assert.ok(rank >= previous, `band went backwards at ${present}/7`);
      previous = rank;
    }
  });

  it('every band is reachable from a real panel count', () => {
    // A band nobody can land in is a legend entry that never renders — the
    // built-tested-uncalled class, in a colour key.
    const reached = new Set<string>();
    for (let present = 0; present <= COVERED_PANELS.length; present += 1) {
      reached.add(bandFor(present, COVERED_PANELS.length));
    }
    assert.deepEqual([...reached].sort(), ['good', 'none', 'partial', 'sparse']);
  });
});

describe('coverage: dual encoding, per Phase B1', () => {
  it('every band carries a hue, a lightness AND a word', () => {
    /**
     * A choropleth encoding coverage in hue alone is unreadable to a material
     * fraction of readers, and "unreadable" on a surface whose whole job is to
     * communicate absence means it communicates nothing to them.
     */
    for (const [band, encoding] of Object.entries(BAND_ENCODING)) {
      assert.match(encoding.fill, /^#[0-9a-f]{6}$/i, `${band} has no fill`);
      assert.equal(typeof encoding.lightness, 'number', `${band} has no lightness`);
      assert.ok(encoding.label.trim().length > 0, `${band} has no label`);
      assert.ok(encoding.meaning.trim().length > 0, `${band} does not say what it means`);
    }
  });

  it('lightness alone separates the bands, so hue is never load-bearing', () => {
    /**
     * THE ASSERTION THAT MAKES THE DUAL ENCODING REAL.
     *
     * It is easy to pick four colours that look different to one reader and
     * collapse to two greys for another. This checks the lightness channel is
     * monotonic AND that adjacent bands are far enough apart to survive being
     * the only channel a reader has.
     */
    const bands = ['none', 'sparse', 'partial', 'good'] as const;
    const lightnesses = bands.map((band) => BAND_ENCODING[band].lightness);
    for (let i = 1; i < lightnesses.length; i += 1) {
      const gap = lightnesses[i]! - lightnesses[i - 1]!;
      assert.ok(gap > 0, `lightness is not monotonic between ${bands[i - 1]} and ${bands[i]}`);
      assert.ok(gap >= 0.1, `${bands[i - 1]} and ${bands[i]} differ by only ${gap.toFixed(2)} lightness`);
    }
  });

  it('the labels are distinct words, not shades of the same one', () => {
    const labels = Object.values(BAND_ENCODING).map((encoding) => encoding.label.toLowerCase());
    assert.equal(new Set(labels).size, labels.length, 'two bands share a label');
  });
});

describe('coverage: the denominator is a fact about a build', () => {
  it('panelsWithDataFor covers exactly the declared panel set', () => {
    /**
     * A hardcoded denominator is how a coverage percentage silently changes
     * meaning when a panel is added: the number moves for every country at
     * once and nothing says why. This ties the helper to the declared list.
     */
    const all = Object.fromEntries(COVERED_PANELS.map((panel) => [panel, true]));
    assert.equal(panelsWithDataFor(all as never).size, COVERED_PANELS.length);

    const none = Object.fromEntries(COVERED_PANELS.map((panel) => [panel, false]));
    assert.equal(panelsWithDataFor(none as never).size, 0);
  });

  it('the panel list is not empty, or every share is a division by zero', () => {
    assert.ok(COVERED_PANELS.length > 0);
  });
});
