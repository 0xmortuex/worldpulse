import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { factHtml, getRegisteredFact } from '../src/facts/badge';
import { factState, type Fact } from '../src/facts/types';

function traceable(value: number | null): Fact<number> {
  return {
    value,
    asOf: '2024',
    tier: 'OFFICIAL',
    provenance: {
      kind: 'fetch',
      sourceId: 'worldbank',
      requestUrl: 'https://api.worldbank.org/v2/country/USA/indicator/X?format=json',
      httpStatus: 200,
      fetchedAt: '2026-08-11T00:00:00.000Z',
      cache: 'miss',
      raw: { ok: true },
      extractedBy: 'root[1][0].value',
    },
  };
}

/** Extract the data-fact id from rendered badge markup. */
function idOf(html: string): string {
  const match = /data-fact="([^"]+)"/.exec(html);
  assert.ok(match, 'rendered badge carries no data-fact id');
  return match[1] as string;
}

describe('fact state', () => {
  it('treats a missing provenance as broken, not as no data', () => {
    const fact: Fact<number> = { value: 42, asOf: '2024', tier: 'OFFICIAL', provenance: null };
    assert.equal(factState(fact), 'broken');
  });

  it('stays broken when the value is also missing', () => {
    // Brokenness outranks emptiness: an untraceable fact must shout even when
    // it has nothing to show, rather than passing as a legitimate "no data".
    const fact: Fact<number> = { value: null, asOf: '', tier: 'OFFICIAL', provenance: null };
    assert.equal(factState(fact), 'broken');
  });

  it('flags a fetch provenance with no URL as broken', () => {
    const fact = traceable(1);
    const provenance = fact.provenance;
    assert.ok(provenance && provenance.kind === 'fetch');
    provenance.requestUrl = '';
    assert.equal(factState(fact), 'broken', 'a value nobody can re-request is not traceable');
  });

  it('flags a derivation with no inputs as broken', () => {
    const fact: Fact<number> = {
      value: 5,
      asOf: '2026',
      tier: 'DERIVED',
      provenance: { kind: 'derived', computedBy: 'x.ts', formula: '5', computedAt: '2026', inputs: [] },
    };
    assert.equal(factState(fact), 'broken');
  });

  it('reports an asked-and-empty source as no data', () => {
    assert.equal(factState(traceable(null)), 'nodata');
  });
});

describe('badge rendering', () => {
  it('renders an untraceable value loudly', () => {
    const html = factHtml({ value: 42, asOf: '2024', tier: 'OFFICIAL', provenance: null });
    assert.match(html, /badge--broken/);
    assert.match(html, /UNTRACEABLE/);
    // The OFFICIAL tier must not survive onto an untraceable value.
    assert.doesNotMatch(html, /badge--official/);
  });

  it('escapes values rather than trusting them', () => {
    const html = factHtml({
      ...traceable(1),
      format: () => '<img src=x onerror=alert(1)>',
    });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it('never reuses a fact id', () => {
    // Regression: ids were previously reset per render pass, so DOM that
    // outlived a pass kept ids that were later reassigned to different facts.
    // Clicking such a badge opened another value's provenance.
    const first = traceable(111);
    const firstId = idOf(factHtml(first));

    const seen = new Set<string>([firstId]);
    for (let i = 0; i < 500; i += 1) {
      const id = idOf(factHtml(traceable(i)));
      assert.equal(seen.has(id), false, `id ${id} was reused`);
      seen.add(id);
    }

    // The original fact is still recoverable, and is still itself.
    assert.equal(getRegisteredFact(firstId)?.value, 111);
  });

  it('resolves an unknown id to nothing rather than to some other fact', () => {
    assert.equal(getRegisteredFact('fact-999999999'), undefined);
  });
});
