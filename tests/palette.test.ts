import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allCommands, renderPalette, search, tourSurfacesReachable } from '../src/ui/palette';

/**
 * Phase C.6 — the command palette.
 *
 * The design claim is that its commands are GENERATED from the same
 * declarations the surfaces are, so it cannot silently omit something. That is
 * what these tests check — the same reasoning as the tour's selectors and the
 * freshness monitor's rows.
 */

describe('the commands come from the app, not from a hand-written list', () => {
  it('includes every country the app renders', () => {
    const commands = allCommands();
    const countries = commands.filter((command) => command.kind === 'country');
    assert.ok(countries.length > 100, `only ${countries.length} countries — not generated from the list`);
  });

  it('every surface the tour introduces is reachable', () => {
    /**
     * The tour is this app's own account of what it has. A palette that cannot
     * reach something the tour introduces is a navigation surface with a hole
     * in it, and the hole would be invisible to everyone except a new user.
     */
    assert.deepEqual(tourSurfacesReachable(), []);
  });

  it('covers every list view', () => {
    const lists = allCommands().filter((command) => command.kind === 'list');
    assert.equal(lists.length, 4, `${lists.length} list commands — the registry has four`);
  });
});

describe('ranking is blunt on purpose', () => {
  it('a prefix finds the obvious thing first', () => {
    /**
     * A reader typing "fra" expects France, not "Toggle the flat map" because
     * it scored higher on a cleverer metric. A ranking nobody can predict is
     * worse than one that is merely simple.
     */
    const results = search('fra');
    assert.equal(results[0]?.label, 'France', `got "${results[0]?.label}"`);
  });

  it('word-start beats mid-word substring', () => {
    const results = search('gov');
    assert.match(results[0]?.label ?? '', /government/i);
  });

  it('an empty query returns nothing rather than everything', () => {
    // Showing all 177 countries for an empty box is noise, not helpfulness.
    assert.deepEqual(search(''), []);
    assert.deepEqual(search('   '), []);
  });

  it('a query matching nothing returns nothing, and the UI says why', () => {
    assert.deepEqual(search('zzzzzznotathing'), []);
    const html = renderPalette('zzzzzznotathing');
    assert.match(html, /fact about the search, not about the app/i);
  });

  it('results are capped, so the list stays scannable', () => {
    // "a" matches most countries; a palette that renders 150 rows is a list
    // view wearing the wrong clothes.
    assert.ok(search('a').length <= 12, `${search('a').length} results`);
  });
});

describe('the rendered palette', () => {
  it('is a labelled dialog with a labelled input', () => {
    const html = renderPalette('fra');
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-label="Command palette"/);
    assert.match(html, /aria-label="Search commands"/);
  });

  it('marks the first result as selected, so Enter is predictable', () => {
    const html = renderPalette('fra');
    assert.match(html, /aria-selected="true"/);
    assert.match(html, /palette-item--first/);
  });

  it('every result says what KIND of thing it is', () => {
    // "France" and "Open the government tab" do different things; the kind
    // label is what stops Enter being a guess.
    const html = renderPalette('fra');
    assert.match(html, /palette-kind/);
  });
});
