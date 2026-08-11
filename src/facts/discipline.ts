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
export function notAFact(value: number | string, reason: string): string {
  if (reason.trim().length < 12) {
    throw new Error(
      `notAFact() needs a real reason, got ${JSON.stringify(reason)}. ` +
        'If the number came from a data source it is a fact — render it with factHtml().',
    );
  }
  return String(value);
}
