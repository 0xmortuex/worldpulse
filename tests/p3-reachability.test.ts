import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Can the shortfall caveat actually happen?
 *
 * P3 ships two behaviours. A REQUIRED input coming back empty suppresses the
 * value; a merely CONTRIBUTING one leaves the value standing and discloses the
 * gap as a caveat. Both are implemented, both are unit-tested, and both render
 * in the gallery.
 *
 * Only the first of them can occur in the shipped app.
 *
 * `contributingShortfall` counts inputs marked `required: false` whose fact is
 * `nodata`. There is exactly one construction site in `src/` that marks an input
 * contributing, and its input values come from `ScoredInput.weight`, typed
 * `number` — so none of them can be empty, and the caveat branch in
 * `relations/provenance.ts` and the shortfall block in `inspector.ts` are
 * unreachable in production. See `OPEN-QUESTIONS.md` 13.
 *
 * ## Why this is a test rather than a note
 *
 * Twelve planted unit tests, a typecheck and a browser assertion were all green
 * while that was true, and every one of them was honest about what it covered.
 * None could see that the covered branch had no live caller: a test proves a
 * function works, and only counting the construction sites proves anything calls
 * it. That gap is what this file closes.
 *
 * The second assertion **fails when the situation improves**, which is
 * deliberate. The gallery entry demonstrating the caveat is a stand-in for a
 * live case that does not exist yet, and a stand-in that outlives its reason is
 * how a demonstration quietly becomes the only evidence. Attaching the reminder
 * to the condition that makes it actionable — rather than to a step number
 * someone has to remember — is the same discipline as re-recording the suite
 * census whenever the suites change instead of on a predicted schedule.
 */

const ROOT = resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Every site that marks a derived input as merely contributing, and whether its
 * input values can actually be empty.
 *
 * Declared with reasons rather than counted, because a bare count would go green
 * again the moment someone added a second site — and the question this file asks
 * is about each site individually.
 */
interface Site {
  canBeEmpty: boolean;
  /**
   * Is this a demonstration rather than a data path?
   *
   * A narrow carve-out with a precedent: `src/dev/gallery.ts` already renders a
   * value with no provenance at all, a state that would be a defect if it
   * occurred for real. The gallery's whole job is showing states the app must
   * handle before live data produces them. The exemption is kept honest by the
   * assertion below, which requires a demonstration site to EXIST — so this flag
   * carries an obligation rather than only an excuse.
   */
  demonstration: boolean;
  why: string;
}

const CONTRIBUTING_SITES = new Map<string, Site>([
  [
    'src/relations/provenance.ts',
    {
      canBeEmpty: false,
      demonstration: false,
      why:
        'THE BLOCKER MOVED, 2026-08-16, and this entry is the record of where it moved TO. ' +
        'It used to read: ScoredInput.weight is typed `number`, so a finding with no value is ' +
        'absent from the array rather than present-and-empty. That was OPEN-QUESTIONS 13, and ' +
        'it is now fixed — the type is `number | null`, score() retains an empty finding with a ' +
        'null weight, and contributingShortfall can therefore see one. ' +
        'What remains is DATA, not model: no production provider emits `empty: true`, because ' +
        'relations run on a hand-checked seed table where every entry has a value by ' +
        'construction. The caveat becomes reachable in production the first time a live ingest ' +
        'answers "asked, nothing there" — which is step 10\'s per-panel conversion, not another ' +
        'change to the engine. Flip this to true, with the provider named, when that lands',
    },
  ],
  [
    'src/dev/gallery.ts',
    {
      canBeEmpty: true,
      demonstration: true,
      why:
        'the component gallery, where the caveated state is rendered so it can be watched ' +
        'working before a source depends on it. Found by this guard on its first run, which is ' +
        'the guard behaving correctly — the entry IS a contributing site, and one that can be ' +
        'empty. It is exempt from the production question, not from declaration',
    },
  ],
]);

describe('P3: is the contributing-shortfall caveat reachable?', () => {
  const found = new Set<string>();
  for (const file of walk(join(ROOT, 'src'))) {
    if (!/required:\s*false/.test(readFileSync(file, 'utf8'))) continue;
    found.add(file.slice(ROOT.length + 1).replaceAll('\\', '/'));
  }

  it('examined the tree and found the sites it expected to find', () => {
    // Rule 27's shape: a scan that matched nothing would pass both assertions
    // below while proving neither.
    assert.ok(found.size > 0, 'no `required: false` site found anywhere in src/ — the scan is broken');
  });

  it('every contributing-input site is declared, with whether it can be empty', () => {
    const undeclared = [...found].filter((file) => !CONTRIBUTING_SITES.has(file));
    assert.deepEqual(
      undeclared,
      [],
      'these sites mark inputs as merely contributing but are not declared here:\n' +
        undeclared.map((file) => `  ${file}`).join('\n') +
        '\nDeclare each one with whether its input values can be empty. An undeclared site is ' +
        'a caveat that may or may not be able to fire, which is the state this file exists to ' +
        'end.',
    );

    const stale = [...CONTRIBUTING_SITES.keys()].filter((file) => !found.has(file));
    assert.deepEqual(stale, [], 'declared here but no longer a contributing site — remove the entry');
  });

  /**
   * THE ASSERTION THAT FAILS ON GOOD NEWS.
   *
   * While no contributing input can be empty, the caveat cannot fire, and the
   * gallery entry is the only place the behaviour is visible. The moment one
   * can, that entry stops being a stand-in and starts being a duplicate of
   * something real — and the live case should be asserted instead.
   */
  /**
   * The exemption above, made load-bearing.
   *
   * If the caveat cannot fire in production AND has no demonstration either,
   * then nothing anywhere renders it and the browser assertions are pointing at
   * a card that no longer exists. Asserting the demonstration exists is what
   * stops `demonstration: true` from being a way to make this file quiet.
   */
  it('the behaviour is visible somewhere, in production or in the gallery', () => {
    const visible = [...CONTRIBUTING_SITES.values()].filter((site) => site.canBeEmpty);
    assert.ok(
      visible.length > 0,
      'no site anywhere can produce a contributing shortfall, so the caveat renders nowhere — ' +
        'the gallery demonstration was removed without a live case replacing it',
    );
  });

  it('records that no production input can currently be empty — and says so when that changes', () => {
    const reachable = [...CONTRIBUTING_SITES.entries()].filter(
      ([, site]) => site.canBeEmpty && !site.demonstration,
    );

    assert.deepEqual(
      reachable.map(([file]) => file),
      [],
      'GOOD NEWS, AND THIS TEST IS THE REMINDER ATTACHED TO IT.\n' +
        'A contributing input can now be empty, so `contributingShortfall` is reachable in ' +
        'production for the first time:\n' +
        reachable.map(([file, site]) => `  ${file} — ${site.why}`).join('\n') +
        '\n\nThe gallery entry "computed from fewer inputs than were consulted" was built as a ' +
        'stand-in for a live case that did not exist. Replace the browser assertions with the ' +
        'real one, and close OPEN-QUESTIONS 13 and 14.',
    );
  });
});
