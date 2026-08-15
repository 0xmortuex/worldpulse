import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CABINET_ROW_LIMIT, parseCabinet } from '../src/sources/wikidata-government';
import { cabinetSection } from '../src/ui/government';
import type { FetchContext } from '../src/sources/adapter';

/**
 * The truncation notice, paired per rule 42.
 *
 * A disclosure ships with the case where it must appear AND the case where it
 * must not, because either alone passes on a notice that fires always or never.
 * The "must not" half is load-bearing in a specific way here: a notice shown on
 * every country would make every accurate count read as a floor.
 *
 * Asserted on the RENDERED MARKUP rather than on the parser, because the
 * parser's `truncated` flag was already correct while nothing displayed it —
 * which is exactly the gap P12 names.
 */

const CTX: FetchContext = {
  requestUrl: 'https://query.wikidata.org/sparql',
  httpStatus: 200,
  fetchedAt: '2026-08-15T20:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

function sparql(rowCount: number): unknown {
  const bindings = [];
  for (let i = 0; i < rowCount; i += 1) {
    bindings.push({
      position: { value: `http://www.wikidata.org/entity/Q${2000 + i}` },
      positionLabel: { value: `Ministry of Thing ${i}` },
      holder: { value: `http://www.wikidata.org/entity/Q${9000 + i}` },
      holderLabel: { value: `Holder ${i}` },
    });
  }
  return { head: { vars: ['position', 'positionLabel', 'holder', 'holderLabel'] }, results: { bindings } };
}

const render = (rowCount: number): string =>
  cabinetSection({ value: parseCabinet(sparql(rowCount)), ctx: CTX });

describe('a truncated cabinet says so where a reader will see it', () => {
  it('names the list incomplete when the row cap was reached', () => {
    const html = render(CABINET_ROW_LIMIT);
    assert.match(html, /INCOMPLETE/i, 'a saturated response rendered as though complete');
    assert.match(html, /true number is not\s+known/i, 'the notice does not say the total is unknown');
  });

  it('the heading count reads as a floor, not a total', () => {
    /**
     * A caveat paragraph under a bare "300 posts" is a correction someone has to
     * read in order to be corrected by. The heading is what gets skimmed.
     */
    assert.match(render(CABINET_ROW_LIMIT), /at least[\s\S]{0,200}posts/i,
      'the heading still presents a truncated count as a total');
  });

  it('warns that every count below describes the posts shown', () => {
    // The vacancy caveat's denominator is a partial list when truncated, and a
    // reader taking "3 of 47 vacant" at face value has been misled.
    assert.match(render(CABINET_ROW_LIMIT), /describes the posts shown, not the cabinet/i);
  });

  /** THE HALF THAT MAKES THE OTHER HALF MEAN SOMETHING. */
  it('an untruncated cabinet carries no incompleteness notice at all', () => {
    const html = render(CABINET_ROW_LIMIT - 1);
    assert.equal(/INCOMPLETE/i.test(html), false, 'a complete cabinet was labelled incomplete');
    assert.equal(/at least/i.test(html), false, 'a complete count was hedged as a floor');
  });

  it('an ordinary small cabinet reads as an exact count', () => {
    const html = render(12);
    assert.equal(/INCOMPLETE/i.test(html), false);
    assert.match(html, /12/, 'the exact count is not shown');
  });
});
