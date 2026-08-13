import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutProblems } from '../scripts/layout-rules.mjs';

/**
 * Planted cases for rule 8's judgement — the last entry on the §9 audit.
 *
 * The two self-tests already prove the predicate can fail, on every run. What
 * they cannot do is put it in a named geometric configuration and check the
 * verdict: they break a real page one way and observe that something fires.
 * Every threshold below is somewhere a real defect once hid.
 */
const root = { x: 0, y: 0, w: 100, h: 100 };
const box = (over: Partial<Parameters<typeof layoutProblems>[0]['kids'][number]> = {}) => ({
  tag: 'LI',
  x: 0,
  y: 0,
  w: 50,
  h: 20,
  ...over,
});

describe('rule 8 — layout judgement', () => {
  it('passes a sound layout', () => {
    assert.deepEqual(layoutProblems({ rootBox: root, kids: [box(), box({ y: 25 })] }), []);
  });

  it('catches a box collapsed to zero', () => {
    const problems = layoutProblems({ rootBox: root, kids: [box({ h: 0 })] });
    assert.match(problems[0] ?? '', /collapsed to 50x0/);
  });

  it('catches a NON-ZERO box whose content is clipped away', () => {
    // The margin the party-legend mutation survived on: height:0 plus 1px of
    // padding each side is 2px, not zero. A definition of "collapsed" that
    // means exactly zero passes it as healthy.
    const problems = layoutProblems({
      rootBox: root,
      kids: [box({ h: 2, clipsY: true, scrollH: 9, clientH: 2 })],
    });
    assert.equal(problems.length, 1, `expected exactly the clipping problem, got ${problems.join('; ')}`);
    assert.match(problems[0] ?? '', /clips its content vertically \(9px of content in 2px\)/);
  });

  it('does not report clipping when the box does not clip', () => {
    // overflow visible: the content spills but is still on screen, and the
    // overlap test is what catches that instead.
    assert.deepEqual(
      layoutProblems({ rootBox: root, kids: [box({ h: 2, clipsY: false, scrollH: 9, clientH: 2 })] }),
      [],
    );
  });

  it('tolerates one pixel of sub-pixel rounding rather than reporting it', () => {
    assert.deepEqual(
      layoutProblems({ rootBox: root, kids: [box({ clipsY: true, scrollH: 21, clientH: 20 })] }),
      [],
    );
  });

  it('catches horizontal overflow past the container', () => {
    const problems = layoutProblems({ rootBox: root, kids: [box({ x: 60, w: 50 })] });
    assert.match(problems[0] ?? '', /overflows horizontally/);
  });

  it('catches two elements overlapping on both axes', () => {
    const problems = layoutProblems({ rootBox: root, kids: [box(), box({ x: 10, y: 10 })] });
    assert.match(problems[0] ?? '', /LI overlaps LI by 40x10px/);
  });

  it('does NOT report stacked rows as overlapping', () => {
    // Both axes must overlap. Requiring only one would report every ordinary
    // column of rows as a defect, which would make the check useless and then
    // ignored.
    assert.deepEqual(layoutProblems({ rootBox: root, kids: [box(), box({ y: 20 })] }), []);
  });

  it('does not report side-by-side columns as overlapping', () => {
    assert.deepEqual(layoutProblems({ rootBox: root, kids: [box({ w: 40 }), box({ x: 41, w: 40 })] }), []);
  });

  it('reports every problem, not only the first', () => {
    const problems = layoutProblems({
      rootBox: root,
      kids: [box({ h: 0 }), box({ x: 60, w: 50, y: 40 })],
    });
    assert.equal(problems.length, 2, problems.join('; '));
  });
});
