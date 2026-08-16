/**
 * The sanctioned escape hatch for numbers that are genuinely not facts.
 *
 * `tests/fact-discipline.test.ts` fails the build when a numeric expression is
 * interpolated into DOM-bound markup anywhere outside `src/facts/`. Some numbers
 * legitimately need to reach the DOM without a confidence badge — a slider
 * readout, a count of rows already individually badged, a loop index. Those must
 * be wrapped here, with a reason.
 *
 * The point is not to permit the number. It is to force a sentence explaining
 * why it carries no provenance, at the site where it is rendered, where a
 * reviewer will see it.
 *
 * If the reason you would write is "it comes from an API", it is a fact. Badge it.
 */
/**
 * The two helpers that may turn a number into rendered text without comment.
 *
 * `factHtml` attaches the badge and the provenance; `notAFact` demands a written
 * reason. Everything else needs an entry below.
 */
export const SANCTIONED_RENDER_HELPERS = ['factHtml', 'notAFact'] as const;

/**
 * Helpers that take a number and return a string inside DOM-bound markup.
 *
 * The fact-discipline rule is enforced through the type system: an expression
 * reaching markup must not be number-typed. That makes any `string`-returning
 * function a bypass — the rule cannot tell `notAFact(n, reason)` from a local
 * `signed(n)` that quietly calls `String(value)`. Two independent copies of
 * exactly that helper existed, both formatting slider weights.
 *
 * `tests/render-helpers.test.ts` fails on any unlisted one, and requires each
 * listed helper declared here to genuinely route through a sanctioned helper —
 * so a new function cannot take a registered name and inherit its exemption
 * without inheriting the behaviour that earned it.
 *
 * Only NUMBER-to-string calls are listed. A markup composer with no numeric
 * input cannot launder a number, and its own body is already covered by the
 * fact-discipline rule.
 */
export const REGISTERED_RENDER_HELPERS: Record<string, string> = {
  n: 'Local one-line alias for notAFact in the tab modules, so a long justification can sit beside the value it explains rather than pushing the markup off the page.',
  px: 'Portrait frame dimension in CSS pixels — a layout constant chosen by this app, not a measurement of anything in the world.',
  coord: 'SVG plot coordinate, derived from values that carry their own badge beside the chart. Geometry, not a reported figure.',
  dimension: 'SVG canvas width or height in pixels — a layout constant, not data about the world.',
  paletteIndex: 'Colour slot for a party segment, cycling through six swatches. A rendering choice, not a property of the party.',
  signedWeight: 'Relation weight set by the user with a slider — this app\'s editable opinion about what counts, not data from any source.',
  axisYear: 'Axis extent: which years a plot covers. Describes the window rather than reporting a value read from it, and every plotted observation is badged in the block above.',
  axisBound: 'Axis scale bound describing the plotted range. A property of the plot, not a figure any source publishes in this form.',
  portraitFrame: 'Composes a portrait frame around a CSS pixel size, which it renders through px(). The numeric argument is a layout dimension, never a value read from a source.',
  portraitFigure: 'Composes a portrait figure around a CSS pixel size, which reaches the DOM through px(). Every fact inside it — the name, the office, the dates — is rendered with factHtml.',
  breakingCard:
    'Composes one story card around a rank and a tie flag. The rank is a POSITION in a ranking this app computes, not a figure from any source, and it reaches the DOM through notAFact() inside. Every measured value on the card — outlet counts, days, countries — is rendered by the inspector below it, each through notAFact with its own justification, because they are counts of what OUR fifteen curated feeds carried rather than facts about the world.',
  asOfCaveat:
    'The time scrub\'s disclaimer. Every number in it describes THIS APP rather than the world: the year is the scrub control\'s position, and the counts are how many of our own findings the cutoff admits and holds in total. None is read from a source, and the sentence exists precisely to stop a reader taking the filtered view for a claim about the past.',
  describeAge:
    'Age of an entry in OUR cache, coarsened to a phrase. It describes this app\'s request history, not the country — no source publishes it and no source could. The values it dates carry their own badges, and the figure it produces is deliberately imprecise because false precision on a cache age helps nobody.',
};

export function notAFact(value: number | string, reason: string): string {
  if (reason.trim().length < 12) {
    throw new Error(
      `notAFact() needs a real reason, got ${JSON.stringify(reason)}. ` +
        'If the number came from a data source it is a fact — render it with factHtml().',
    );
  }
  return String(value);
}
