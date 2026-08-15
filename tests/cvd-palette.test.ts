import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { CVD_TYPES, deltaE, paletteProblems, parseHex, simulateCvd } from '../scripts/cvd.mjs';
import { TIER_COLORS, TIER_COLORS_LOW_CONFIDENCE, TIER_GLYPH, TIER_LABELS } from '../src/theme';
import type { Tier } from '../src/relations/types';

/**
 * Planted cases for the colourblind-safe palette (B1, rules 27 and 32).
 *
 * Roughly 1 in 12 men has a red-green deficiency. A relation tier carried by hue
 * alone is, for them, carried by nothing — and this panel's whole output is a
 * claim about how two countries stand to each other.
 */
const TIERS: Tier[] = ['ally', 'adversary', 'strained', 'neutral', 'nodata'];

/** The palette this replaced. Kept as the planted case that proves the guard fires. */
const SUPERSEDED = {
  ally: '#2f81f7',
  adversary: '#f0553d',
  strained: '#d99024',
  neutral: '#3d444d',
  nodata: '#20242a',
};

describe('colourblind-safe tier palette', () => {
  it('CATCHES the palette it replaced — the guard is not vacuous', () => {
    /**
     * Rule 6: a rule that has never failed is not a rule. The superseded palette
     * had two real collisions, and this asserts both by name so the guard cannot
     * quietly stop working.
     */
    const problems = paletteProblems(SUPERSEDED);
    assert.ok(problems.length > 0, 'the guard found nothing wrong with a palette known to be unsafe');

    const joined = problems.join('\n');
    assert.match(joined, /adversary and strained collapse under deuteranopia/);
    assert.match(joined, /neutral and nodata collapse/);
  });

  it('the shipped palette has no pair that collapses under any dichromacy', () => {
    assert.deepEqual(paletteProblems(TIER_COLORS), []);
  });

  it('separates adversary from strained, the pair a reader most needs', () => {
    // Named separately from the sweep because it is the semantically load-bearing
    // pair: mistaking "at war with" for "in dispute with" is the error that
    // matters most on this panel.
    for (const type of CVD_TYPES) {
      const distance = deltaE(simulateCvd(TIER_COLORS.adversary, type), simulateCvd(TIER_COLORS.strained, type));
      assert.ok(distance >= 20, `adversary/strained ΔE ${distance.toFixed(1)} under ${type}`);
    }
  });

  it('separates neutral from nodata, which are different claims', () => {
    /**
     * "Evidence exists and nets out" versus "there is no evidence at all" — this
     * project's central distinction, which the superseded palette rendered as two
     * near-identical dark greys for every viewer, not only colourblind ones.
     */
    for (const type of CVD_TYPES) {
      const distance = deltaE(simulateCvd(TIER_COLORS.neutral, type), simulateCvd(TIER_COLORS.nodata, type));
      assert.ok(distance >= 20, `neutral/nodata ΔE ${distance.toFixed(1)} under ${type}`);
    }
  });

  it('every tier carries a glyph and a label, so colour is never the only channel', () => {
    for (const tier of TIERS) {
      assert.ok((TIER_GLYPH[tier] ?? '').trim().length > 0, `${tier} has no glyph`);
      assert.ok((TIER_LABELS[tier] ?? '').trim().length > 0, `${tier} has no label`);
    }
    assert.equal(new Set(TIERS.map((t) => TIER_GLYPH[t])).size, TIERS.length, 'two tiers share a glyph');
    assert.equal(new Set(TIERS.map((t) => TIER_LABELS[t])).size, TIERS.length, 'two tiers share a label');
  });

  it('low-confidence variants are visibly dimmer than their base', () => {
    /**
     * This assertion replaced one that was WRONG, and the replacement is not a
     * relaxation — it is a different requirement, because the first one encoded
     * a property that is neither necessary nor achievable.
     *
     * The original asserted that a dimmed variant must sit nearer its own base
     * than any other tier's base. That is unnecessary: the tier is carried by
     * glyph and label, so the hue does not have to identify it alone. And it is
     * unsatisfiable — every darkening of yellow moves `strained` toward another
     * tier, so no palette could pass. Keeping it would have meant choosing
     * colours to satisfy an invented constraint.
     *
     * What a low-confidence colour actually owes the reader is that it reads as
     * *less*, which is a luminance claim. The distinction from other tiers is
     * carried by the `low conf.` tag and the glyph, in words and shape.
     *
     * The real constraint this uncovered — that ten colours over-subscribe the
     * CVD-safe space, so `adversary` base collides with `strained` dimmed at
     * ΔE 9.7 on the globe where colour is the only channel — is recorded in
     * FOUND.md and OPEN-QUESTIONS 12, not silently absorbed here.
     */
    for (const tier of TIERS) {
      const [br, bg, bb] = parseHex(TIER_COLORS[tier]);
      const [dr, dg, db] = parseHex(TIER_COLORS_LOW_CONFIDENCE[tier]);
      const baseLuma = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
      const dimLuma = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
      assert.ok(
        dimLuma < baseLuma * 0.8,
        `low-confidence ${tier} is not visibly dimmer (${dimLuma.toFixed(0)} vs ${baseLuma.toFixed(0)})`,
      );
    }
  });

  it('a low-confidence variant never reads as a DIFFERENT tier in the list', () => {
    // Where the app has more than one channel — the relations list — the tier is
    // unambiguous regardless of hue, because glyph and label carry it. This
    // asserts the channels exist for every tier rather than trusting the colour.
    for (const tier of TIERS) {
      assert.ok(TIER_GLYPH[tier], `${tier} would be colour-only when dimmed`);
      assert.ok(TIER_LABELS[tier], `${tier} would be colour-only when dimmed`);
    }
  });

  it('the relations list renders the tier in text, not only as a swatch', () => {
    // Guards the specific defect: before B1 the list row carried its tier ONLY
    // as a background colour on a 10px chip.
    const source = new URL('../src/ui/panel.ts', import.meta.url);
    const panel = readFileSync(source, 'utf8');
    assert.match(panel, /class="relation-tier"/, 'the tier label was removed from the relations list');
    assert.match(panel, /TIER_GLYPH\[result\.tier\]/, 'the glyph was removed from the relations row');
  });
});
