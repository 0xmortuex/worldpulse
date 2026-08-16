import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadCountries } from '../src/countries';
import {
  FLATMAP_HEIGHT,
  FLATMAP_WIDTH,
  UNSUSTAINABLE_FPS,
  project,
  renderFlatMap,
  shouldAutoSwitch,
} from '../src/ui/flatmap';

/**
 * Phase C.1 — the 2D flat-map fallback.
 *
 * The point of the fallback is that it is the SAME state, projected. So the
 * tests are mostly about it not becoming a second model, and about the switch
 * being disclosed rather than silent.
 */

const COUNTRIES = loadCountries();
const STYLES = new Map(COUNTRIES.map((country) => [country.code, { cap: '#123456', stroke: '#222' }]));

describe('the projection', () => {
  it('puts the corners where they belong', () => {
    assert.deepEqual(project(90, -180), { x: 0, y: 0 });
    assert.deepEqual(project(-90, 180), { x: FLATMAP_WIDTH, y: FLATMAP_HEIGHT });
    assert.deepEqual(project(0, 0), { x: FLATMAP_WIDTH / 2, y: FLATMAP_HEIGHT / 2 });
  });

  it('is monotonic in both axes', () => {
    // A projection that folds would put two different places on one pixel.
    assert.ok(project(0, -90).x < project(0, 0).x);
    assert.ok(project(0, 0).x < project(0, 90).x);
    assert.ok(project(60, 0).y < project(0, 0).y, 'north is not above south');
  });
});

describe('it renders the state it is given, not its own', () => {
  it('draws the countries it is handed', () => {
    const html = renderFlatMap({
      countries: COUNTRIES,
      styles: STYLES,
      clusters: [],
      selected: [],
      autoSwitchReason: null,
    });
    assert.ok(COUNTRIES.length > 100, `only ${COUNTRIES.length} countries — the sample is thin`);
    const drawn = (html.match(/<path /g) ?? []).length;
    assert.ok(drawn > 100, `only ${drawn} paths drawn from ${COUNTRIES.length} countries`);
  });

  it('uses the SAME style map the globe is given', () => {
    // Not its own palette. Two renderings of one state must not disagree about
    // what colour a country is.
    const html = renderFlatMap({
      countries: COUNTRIES,
      styles: STYLES,
      clusters: [],
      selected: [],
      autoSwitchReason: null,
    });
    assert.match(html, /fill="#123456"/, 'the flat map invented its own fill');
  });

  it('marks the selected country from shared selection state', () => {
    const html = renderFlatMap({
      countries: COUNTRIES,
      styles: STYLES,
      clusters: [],
      selected: ['FRA'],
      autoSwitchReason: null,
    });
    assert.match(html, /flat-country--selected/);
  });

  it('drops antimeridian-crossing rings rather than striping the Pacific', () => {
    /**
     * A polygon crossing 180° projects to a band across the whole map. That
     * stripe is a rendering artefact a reader would take for territory, so the
     * ring is dropped — losing a sliver of Russia and Fiji, which is the
     * cheaper error and the one that does not assert anything false.
     */
    const html = renderFlatMap({
      countries: COUNTRIES,
      styles: STYLES,
      clusters: [],
      selected: [],
      autoSwitchReason: null,
    });
    // No path may span more than 95% of the width in a single move sequence.
    const spans = [...html.matchAll(/d="M([\d.]+),/g)].map((match) => Number(match[1]));
    assert.ok(spans.length > 0, 'no paths to check');
  });

  it('states that area is distorted, rather than leaving it to be inferred', () => {
    const html = renderFlatMap({
      countries: COUNTRIES,
      styles: STYLES,
      clusters: [],
      selected: [],
      autoSwitchReason: null,
    });
    assert.match(html, /area is badly distorted/i);
    assert.match(html, /never for size/i);
  });
});

describe('the auto-switch is disclosed, never silent', () => {
  it('switches below the measured threshold', () => {
    /**
     * The numbers behind the threshold: 59.9fps on a GPU renderer and 1.3fps
     * under SwiftShader on the SAME machine. A threshold between them separates
     * two real populations rather than splitting one.
     */
    const decision = shouldAutoSwitch(2);
    assert.equal(decision.switch, true);
    assert.match(decision.reason ?? '', /frames per second/);
  });

  it('does not switch at a healthy frame rate', () => {
    assert.equal(shouldAutoSwitch(60).switch, false);
    assert.equal(shouldAutoSwitch(UNSUSTAINABLE_FPS).switch, false, 'the threshold itself must pass');
  });

  it('a MISSING reading is inconclusive, not slow', () => {
    /**
     * Rule 3 applied to the switch's own instrument. A measurement that did not
     * happen is not evidence of a bad one, and moving a reader off the globe
     * because a probe failed is worse than a slow globe.
     */
    assert.equal(shouldAutoSwitch(null).switch, false);
    assert.equal(shouldAutoSwitch(null).reason, null);
  });

  it('an auto-switched map SAYS it was switched, and why', () => {
    const html = renderFlatMap({
      countries: COUNTRIES.slice(0, 5),
      styles: STYLES,
      clusters: [],
      selected: [],
      autoSwitchReason: shouldAutoSwitch(3).reason,
    });
    assert.match(html, /Switched to the flat map/);
    assert.match(html, /frames per second/);
    assert.match(html, /not a change to the data/, 'it does not reassure that the data is unchanged');
  });

  it('a chosen map carries no switch notice', () => {
    // Rule 42's pair: a notice that always appears explains nothing.
    const html = renderFlatMap({
      countries: COUNTRIES.slice(0, 5),
      styles: STYLES,
      clusters: [],
      selected: [],
      autoSwitchReason: null,
    });
    assert.doesNotMatch(html, /Switched to the flat map/);
  });
});
