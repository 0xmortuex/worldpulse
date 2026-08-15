import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { envTemplateProblems, templateNames } from '../scripts/env-template.mjs';
import registry from '../data/sources.json';

/**
 * Planted cases first (rule 27), then the real files.
 *
 * A guard that has only ever seen a consistent registry is a guard nobody has
 * watched work — and this one was written because a real drift went unnoticed:
 * `EMBER_API_KEY` was registered and missing from `.env.example` while every
 * check reported clean.
 */
describe('.env.example keeps up with the registry', () => {
  it('reads names out of a template, never values', () => {
    const names = templateNames(
      '# a comment\nFOO=\nBAR=filled-in\n\n  BAZ = spaced \n#COMMENTED=x\nnot-an-assignment\n',
    );
    assert.deepEqual([...names].sort(), ['BAR', 'BAZ', 'FOO']);
    // The point of the assertion: a value never leaves this function. `BAR` is
    // present because it is declared, not because of what it holds.
    assert.equal(names.has('COMMENTED'), false, 'a commented line does not declare a variable');
  });

  it('catches a registered key the template never mentions', () => {
    const problems = envTemplateProblems(
      { sources: [{ id: 'ember', keyRequired: true, keyEnv: 'EMBER_API_KEY' }] },
      new Set(['COMTRADE_KEY']),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] as string, /EMBER_API_KEY/);
    assert.match(problems[0] as string, /does not mention it/);
  });

  it('accepts a registered key the template declares', () => {
    assert.deepEqual(
      envTemplateProblems(
        { sources: [{ id: 'ember', keyRequired: true, keyEnv: 'EMBER_API_KEY' }] },
        new Set(['EMBER_API_KEY']),
      ),
      [],
    );
  });

  /**
   * THE ACLED CASE — the widening, planted.
   *
   * `keyRequired: true` with no `keyEnv` cannot be satisfied by any environment
   * file: there is no variable name to fill. The template check alone would skip
   * it, having no name to look for, and the source would stay blocked forever
   * while everything reported clean.
   */
  it('catches a source that needs a key but names no variable', () => {
    const problems = envTemplateProblems(
      { sources: [{ id: 'acled', keyRequired: true, keyEnv: null }] },
      new Set(),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] as string, /no environment variable can satisfy it/);
  });

  it('leaves that case alone while the source is parked, and fires when it is not', () => {
    const parked = { id: 'acled', keyRequired: true, keyEnv: null, excluded: true };
    assert.deepEqual(
      envTemplateProblems({ sources: [parked] }, new Set()),
      [],
      'an excluded source is not claiming to work',
    );

    const revived = { ...parked, excluded: false };
    assert.equal(
      envTemplateProblems({ sources: [revived] }, new Set()).length,
      1,
      'un-excluding it is the moment the contradiction starts costing something',
    );
  });

  it('does not demand template entries for parked sources', () => {
    assert.deepEqual(
      envTemplateProblems(
        { sources: [{ id: 'parked', keyRequired: true, keyEnv: 'PARKED_KEY', excluded: true }] },
        new Set(),
      ),
      [],
    );
  });

  it('ignores sources that need no key at all', () => {
    assert.deepEqual(
      envTemplateProblems({ sources: [{ id: 'usgs', keyRequired: false, keyEnv: null }] }, new Set()),
      [],
    );
  });

  /** The real files. This is the assertion the guard exists for. */
  it('the shipped registry and the shipped template agree', () => {
    const names = templateNames(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
    const problems = envTemplateProblems(registry, names);
    assert.deepEqual(problems, [], problems.join('\n'));
  });
});
