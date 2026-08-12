/**
 * Make a union dispatch exhaustive by construction.
 *
 * ## Why this exists
 *
 * `factHtml` branched on three of the four fact states and let the rest fall
 * through to the tier badge. When a fifth state was added, the fall-through
 * rendered an **OFFICIAL badge over a value that was never received** — the
 * worst output this app can produce, asserting a confidence level for data we
 * do not have.
 *
 * It was found by reading the function. Nothing else caught it, and nothing else
 * could have: the fall-through was type-correct. That is the part that makes it
 * worth a helper rather than a note.
 *
 * ## Why the type checker did not help, and where it accidentally did
 *
 * The two unions in this project fail differently:
 *
 *   `Provenance` is a union of OBJECT types. Code that narrows away four kinds
 *   and then reads `provenance.raw` gets a compile error when a fifth kind
 *   without `raw` appears — which is exactly what happened in the inspector. But
 *   that safety is ACCIDENTAL: it depends entirely on the new variant lacking a
 *   property the tail happens to read. A new kind that carries `sourceId` slips
 *   through `sourceName` silently.
 *
 *   `FactState` is a union of STRING LITERALS. There is no property to read, so
 *   narrowing gives the compiler nothing to object to, and a fall-through is
 *   always silent. Every one of the three state dispatches was in this class.
 *
 * So a dispatch must state its exhaustiveness rather than inherit it from what
 * its tail happens to touch.
 *
 * ## Use
 *
 * ```ts
 * switch (state) {
 *   case 'ok': return …;
 *   …
 *   default: return assertNever(state, 'badgeMarkup');
 * }
 * ```
 *
 * Adding a sixth state now fails to compile at every unhandled site, which is
 * the property that was missing.
 */
export function assertNever(value: never, context: string): never {
  // Reached only if a value escapes the type system — a cast, a JSON boundary,
  // or data from outside. Throwing is right: the alternative is rendering
  // something nobody chose, which is how the OFFICIAL-badge defect looked.
  throw new Error(`${context}: unhandled variant ${JSON.stringify(value)}`);
}
