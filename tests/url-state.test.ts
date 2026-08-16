import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../src/relations/score';
import type { AppState } from '../src/state';
import { fromSearch, specifiesLayers, toSearch } from '../src/url-state';

/**
 * Step 13 / Phase B2 — view state in the URL.
 *
 * A shared link is only worth having if it opens what the sender saw. So the
 * round trip is asserted at both ends — empty and maximal — and a malformed URL
 * is asserted to degrade to defaults rather than to a confidently wrong view.
 */

function state(over: Partial<AppState> = {}): AppState {
  return {
    selected: [],
    weights: { ...DEFAULT_WEIGHTS },
    thresholds: { ...DEFAULT_THRESHOLDS },
    hovered: null,
    tab: 'government',
    layers: new Set<string>(),
    includeStale: false,
    coverageMode: false,
    asOfYear: null,
    ...over,
  };
}

describe('the round trip returns what it started with', () => {
  it('survives the empty case', () => {
    const round = fromSearch(toSearch(state()));
    assert.deepEqual(round.selected, []);
    assert.equal(round.tab, 'government');
    assert.deepEqual(round.weights, DEFAULT_WEIGHTS);
    assert.equal(round.includeStale, false);
    assert.equal(round.coverageMode, false);
  });

  it('survives the maximal case', () => {
    /**
     * Both ends, because they are the two nobody tests by hand and the two
     * where a serialiser breaks: everything set, every weight moved off its
     * default, several countries selected.
     */
    const weights = Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([key, value]) => [key, value + 1]),
    ) as typeof DEFAULT_WEIGHTS;

    const before = state({
      selected: ['USA', 'FRA', 'JPN'],
      tab: 'legislature',
      weights,
      thresholds: { ...DEFAULT_THRESHOLDS, ally: 9 },
      layers: new Set(['usgs:earthquakes', 'eonet:wildfires']),
      includeStale: true,
      coverageMode: true,
    });

    const after = fromSearch(toSearch(before));
    assert.deepEqual(after.selected, ['USA', 'FRA', 'JPN']);
    assert.equal(after.tab, 'legislature');
    assert.deepEqual(after.weights, weights);
    assert.equal(after.thresholds.ally, 9);
    assert.deepEqual(after.layers.sort(), ['eonet:wildfires', 'usgs:earthquakes']);
    assert.equal(after.includeStale, true);
    assert.equal(after.coverageMode, true);
  });

  it('preserves selection ORDER, which the compare view depends on', () => {
    // `selected` is documented as ordered so compare columns keep a stable
    // left-to-right identity. A round trip that sorted it would silently
    // reorder someone's shared comparison.
    const after = fromSearch(toSearch(state({ selected: ['ZWE', 'ALB', 'MEX'] })));
    assert.deepEqual(after.selected, ['ZWE', 'ALB', 'MEX']);
  });
});

describe('only non-default values are written', () => {
  it('a default view produces a short URL', () => {
    /**
     * Writing every weight at its default would freeze TODAY's defaults into
     * every link ever shared, so changing a default later would silently not
     * apply to anyone holding an old link. Omitting them means a link says
     * "the defaults, whatever they are now".
     */
    const search = toSearch(state());
    assert.doesNotMatch(search, /w\./, 'default weights are being written into the URL');
    assert.doesNotMatch(search, /t\./, 'default thresholds are being written into the URL');
    assert.doesNotMatch(search, /tab=/, 'the default tab is being written into the URL');
  });

  it('a moved weight IS written', () => {
    const moved = { ...DEFAULT_WEIGHTS, sharedDefenseBloc: DEFAULT_WEIGHTS.sharedDefenseBloc + 2 };
    assert.match(toSearch(state({ weights: moved })), /w\.sharedDefenseBloc=/);
  });
});

describe('a malformed URL degrades to defaults, never to NaN', () => {
  it('a non-numeric weight falls back rather than poisoning the scoring', () => {
    /**
     * `Number('banana')` is `NaN`, and `NaN` fails every comparison silently,
     * so one bad weight would reclassify every relation rather than erroring.
     * Rule 29: a guard keyed on a malformed value must not fall through to
     * using it.
     */
    const parsed = fromSearch('w.sharedDefenseBloc=banana');
    assert.equal(parsed.weights.sharedDefenseBloc, DEFAULT_WEIGHTS.sharedDefenseBloc);
    assert.ok(Number.isFinite(parsed.weights.sharedDefenseBloc));
  });

  it('rejects Infinity as well as NaN', () => {
    // `Number('Infinity')` is finite-looking to a naive check and would make
    // every pair an ally.
    assert.equal(fromSearch('w.sharedDefenseBloc=Infinity').weights.sharedDefenseBloc, DEFAULT_WEIGHTS.sharedDefenseBloc);
  });

  it('an unknown tab falls back to the default tab', () => {
    assert.equal(fromSearch('tab=nonsense').tab, 'government');
    assert.equal(fromSearch('tab=military').tab, 'military');
  });

  it('a trailing comma does not produce an empty country', () => {
    // The most common hand-edit. An empty code would look up nothing and render
    // as a blank selection rather than as no selection.
    assert.deepEqual(fromSearch('c=USA,FRA,').selected, ['USA', 'FRA']);
    assert.deepEqual(fromSearch('c=').selected, []);
  });
});

describe('the scrub position is shareable', () => {
  it('round-trips an as-of year', () => {
    assert.equal(fromSearch(toSearch(state({ asOfYear: 2015 }))).asOfYear, 2015);
  });

  it('the present is not written, so a default link carries no as-of', () => {
    assert.doesNotMatch(toSearch(state({ asOfYear: null })), /asof/);
    assert.equal(fromSearch('c=USA').asOfYear, null);
  });

  it('a malformed as-of falls back to the PRESENT, not to a nonsense year', () => {
    // ?asof=banana parsing to 1970 would be a confidently wrong historical
    // view. Falling back to now is obviously not what the link said.
    for (const bad of ['banana', '0', '99999', '2015.5', '']) {
      assert.equal(fromSearch(`asof=${bad}`).asOfYear, null, `"${bad}" was accepted`);
    }
  });
});

describe('a missing layer list is not an empty one', () => {
  it('distinguishes "never touched" from "all turned off"', () => {
    /**
     * The distinction most likely to be lost here, and it changes what a link
     * shows: missing means use the defaults, empty means the sender
     * deliberately turned everything off and wants to share that.
     */
    assert.equal(specifiesLayers('c=USA'), false);
    assert.equal(specifiesLayers('c=USA&layers='), true);
    assert.deepEqual(fromSearch('c=USA&layers=').layers, []);
  });
});
