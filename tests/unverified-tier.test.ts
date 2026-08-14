import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { TIER_EXPLANATIONS, type Tier } from '../src/facts/types';
import { factHtml } from '../src/facts/badge';

/**
 * Planted cases for the fourth confidence tier (B3, rule 27).
 *
 * `UNVERIFIED` sits below `ESTIMATE` and is NOT a failure state. The two errors
 * worth preventing are opposite: rendering it as though someone stands behind
 * the number, and rendering it as though the app is broken. It is neither — it
 * is an honest statement that nothing corroborates the value.
 */
const ALL_TIERS: Tier[] = ['OFFICIAL', 'ESTIMATE', 'DERIVED', 'UNVERIFIED'];

const fact = (tier: Tier) => ({
  value: 42,
  asOf: '2026-01-01',
  tier,
  provenance: {
    kind: 'fetch' as const,
    sourceId: 'worldbank',
    requestUrl: 'https://example.test/x',
    httpStatus: 200,
    fetchedAt: '2026-01-01T00:00:00Z',
    cache: 'miss' as const,
    raw: '42',
    extractedBy: 'test',
  },
});

describe('UNVERIFIED tier', () => {
  it('every tier has an explanation, including the new one', () => {
    for (const tier of ALL_TIERS) {
      assert.ok((TIER_EXPLANATIONS[tier] ?? '').trim().length > 0, `${tier} has no explanation`);
    }
  });

  it('its explanation says it is weaker than an estimate, not that it is broken', () => {
    const text = TIER_EXPLANATIONS.UNVERIFIED.toLowerCase();
    assert.match(text, /not corroborated|no second source/, 'must say what is missing');
    assert.match(text, /estimate/, 'must position itself against ESTIMATE, which it sits below');
    assert.doesNotMatch(text, /error|broken|failed|bug/, 'it is not a failure state');
  });

  it('no two tiers share an explanation', () => {
    const texts = ALL_TIERS.map((tier) => TIER_EXPLANATIONS[tier]);
    assert.equal(new Set(texts).size, ALL_TIERS.length, 'two tiers explain themselves identically');
  });

  it('renders a badge distinct from every other tier', () => {
    const rendered = ALL_TIERS.map((tier) => factHtml(fact(tier)));
    assert.equal(new Set(rendered).size, ALL_TIERS.length, 'two tiers render identical markup');
    assert.match(factHtml(fact('UNVERIFIED')), /badge--unverified/);
  });

  it('is not styled as the broken state, which is our defect rather than the world’s', () => {
    // The confusion this prevents: UNTRACEABLE means a value reached the UI with
    // no provenance and is a bug in this app. UNVERIFIED means the evidence is
    // thin, which is a fact about the world. Sharing a treatment would tell the
    // reader we had failed when we had merely reported honestly.
    const unverified = factHtml(fact('UNVERIFIED'));
    assert.doesNotMatch(unverified, /badge--broken/);
    assert.doesNotMatch(unverified, /UNTRACEABLE/);
  });

  it('carries a non-colour channel, so the tier survives colour-blindness', () => {
    /**
     * B1's requirement arriving early, because a tier added without one would
     * have to be retrofitted. Three channels distinguish it: glyph, border style
     * and hue. This asserts the two that do not depend on seeing colour.
     */
    assert.match(factHtml(fact('UNVERIFIED')), /\?/, 'no distinguishing glyph');

    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('.badge--unverified'), css.indexOf('.badge--unconfigured'));
    assert.match(block, /border:[^;]*double/, 'no distinguishing border style');
    for (const taken of ['solid', 'dashed', 'dotted']) {
      assert.doesNotMatch(block, new RegExp(`border:[^;]*\\b${taken}\\b`), `border style ${taken} is already in use`);
    }
  });

  it('no adapter emits it yet, so this commit changes no behaviour', () => {
    /**
     * Commit 2 of the migration is additive by design, and this is what makes
     * that claim checkable rather than asserted in a commit message.
     *
     * It is also the P12 tripwire. The day a source starts emitting UNVERIFIED,
     * this fails — and whoever did it owes the tier a browser assertion, because
     * at that moment it becomes user-visible behaviour for the first time.
     */
    const roots = ['sources', 'relations', 'dossier', 'economy', 'layers', 'ui'];
    const emitting: string[] = [];

    for (const root of roots) {
      const dir = new URL(`../src/${root}/`, import.meta.url);
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.ts')) continue;
        const source = readFileSync(new URL(entry, dir), 'utf8');
        if (/tier:\s*['"]UNVERIFIED['"]/.test(source)) emitting.push(`src/${root}/${entry}`);
      }
    }

    assert.deepEqual(
      emitting,
      [],
      'a source now emits UNVERIFIED — it needs a browser assertion before it ships (P12)',
    );
  });
});
