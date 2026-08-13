/**
 * Rule 8's judgement, separated from the DOM measurement that feeds it.
 *
 * ## Why this is a module (rule 32)
 *
 * `assertLayout` measures boxes in the browser and then decides, in Node,
 * whether they constitute a layout defect. The measuring genuinely needs a DOM;
 * the deciding never did, and while it sat inline the only way to exercise it
 * was to run the browser suite — the last entry on the §9 audit's list.
 *
 * The two self-tests do prove the predicate can fail, on every run. What they
 * cannot do is put it in a specific geometric configuration and check the
 * verdict: they break a real page one way and observe that something fires. The
 * difference matters because this predicate has already been wrong in a way a
 * self-test could not see.
 *
 * ## The margin this exists to hold
 *
 * "Collapsed" was once defined as exactly zero, and a row squashed to 2px — its
 * text clipped entirely away — passed as healthy. A mutation collapsing
 * party-legend rows survived on precisely that margin: `height: 0` plus 1px of
 * padding top and bottom is not zero. What matters is not whether the box
 * reached zero but whether its content still fits inside it.
 *
 * Every threshold below is therefore a planted case, because every threshold is
 * somewhere a real defect once hid.
 */

/**
 * @typedef {object} Box
 * @property {string} tag
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {boolean} [clipsY]  overflow-y is hidden or clip
 * @property {number} [scrollH]
 * @property {number} [clientH]
 */

/** Sub-pixel rounding tolerance. Browsers report fractional layout. */
const TOLERANCE = 1;

/**
 * @param {{ rootBox: {x:number,y:number,w:number,h:number}, kids: Box[] }} report
 * @returns {string[]} one message per problem; empty means the layout is sound
 */
export function layoutProblems({ rootBox, kids }) {
  const problems = [];

  for (const kid of kids) {
    if (kid.w <= 0 || kid.h <= 0) problems.push(`${kid.tag} collapsed to ${kid.w}x${kid.h}`);

    // The margin above: a box with non-zero height whose content does not fit
    // is invisible on screen while present in the DOM, which every presence and
    // text assertion passes.
    if (kid.clipsY && (kid.scrollH ?? 0) > (kid.clientH ?? 0) + TOLERANCE) {
      problems.push(`${kid.tag} clips its content vertically (${kid.scrollH}px of content in ${kid.clientH}px)`);
    }

    if (kid.x < rootBox.x - TOLERANCE || kid.x + kid.w > rootBox.x + rootBox.w + TOLERANCE) {
      problems.push(
        `${kid.tag} overflows horizontally (${kid.x}..${kid.x + kid.w} vs ` +
          `${Math.round(rootBox.x)}..${Math.round(rootBox.x + rootBox.w)})`,
      );
    }
  }

  for (let i = 0; i < kids.length; i += 1) {
    for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i];
      const b = kids[j];
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      // BOTH axes must overlap. Two rows stacked vertically share an x range
      // and are not overlapping; requiring only one axis would report every
      // ordinary column as a defect.
      if (overlapW > TOLERANCE && overlapH > TOLERANCE) {
        problems.push(`${a.tag} overlaps ${b.tag} by ${overlapW}x${overlapH}px`);
      }
    }
  }

  return problems;
}
