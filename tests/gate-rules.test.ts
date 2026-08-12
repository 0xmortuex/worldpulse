import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verdictFor } from '../scripts/deploy-gate-rules.mjs';
import { parseRegistry } from '../src/facts/registry';
import registry from '../data/sources.json';

/**
 * Planted-violation cases for the deploy gate and the registry validator.
 *
 * Both had been verified once by hand and never again — rule 27's whole point.
 * Neither could be pointed at a synthetic input while its logic lived inside the
 * loop that used it, so both were extracted first: testability is a property of
 * how a guard is factored, not an afterthought.
 */
const clean = {
  fixtureIds: new Set(['covered']),
  contractIds: new Set(['covered']),
  bundledEvidence: { bundled: 'tests/geometry.test.ts' },
  evidenceExists: (path: string): boolean => path === 'tests/geometry.test.ts',
};

describe('deploy gate rule', () => {
  it('passes a live source with a fixture and a contract test', () => {
    const verdict = verdictFor({ id: 'covered', verifiedAgainst: 'live' }, clean);
    assert.equal(verdict.problem, null);
    assert.match(verdict.detail, /fixture and contract test registered/);
  });

  it('catches a planted live source with no fixture and no contract test', () => {
    const verdict = verdictFor({ id: 'naked', verifiedAgainst: 'live' }, clean);
    assert.ok(verdict.problem, 'a live source with no coverage was allowed through');
    assert.match(verdict.problem, /no fixture registered/);
    assert.match(verdict.problem, /no contract test names it/);
  });

  it('catches a planted live source with a fixture but no contract test', () => {
    const world = { ...clean, contractIds: new Set<string>() };
    const verdict = verdictFor({ id: 'covered', verifiedAgainst: 'live' }, world);
    assert.ok(verdict.problem);
    assert.match(verdict.problem, /no contract test names it/);
    assert.doesNotMatch(verdict.problem, /no fixture registered/);
  });

  it('blocks a documentation-only source', () => {
    const verdict = verdictFor({ id: 'unverified', verifiedAgainst: 'documentation' }, clean);
    assert.ok(verdict.problem);
    assert.match(verdict.problem, /never confirmed against a live response/);
  });

  it('catches a planted bundled source with no registered evidence', () => {
    const verdict = verdictFor({ id: 'unregistered', verifiedAgainst: 'bundled' }, clean);
    assert.ok(verdict.problem, 'bundled was accepted as an unaudited exemption');
    assert.match(verdict.problem, /no byte-level shape assertion is registered/);
  });

  it('catches a planted bundled source whose evidence file has gone', () => {
    const world = { ...clean, evidenceExists: (): boolean => false };
    const verdict = verdictFor({ id: 'bundled', verifiedAgainst: 'bundled' }, world);
    assert.ok(verdict.problem);
    assert.match(verdict.problem, /evidence file .* is missing/);
  });

  it('catches a planted unknown status rather than treating it as passing', () => {
    const verdict = verdictFor({ id: 'weird', verifiedAgainst: 'probably-fine' }, clean);
    assert.ok(verdict.problem, 'an unrecognised status was allowed through');
    assert.match(verdict.problem, /unknown verifiedAgainst value/);
  });

  it('defaults a source with no status to documentation rather than to passing', () => {
    const verdict = verdictFor({ id: 'silent' }, clean);
    assert.ok(verdict.problem, 'a source with no verifiedAgainst was allowed through');
  });
});

describe('sources.json registry validator', () => {
  it('accepts the real registry', () => {
    assert.ok(parseRegistry(registry).sources.length > 0);
  });

  it('catches a planted verifiedAgainst value', () => {
    const doctored = {
      ...registry,
      sources: registry.sources.map((source, index) =>
        index === 0 ? { ...source, verifiedAgainst: 'probably-fine' } : source,
      ),
    };
    assert.throws(
      () => parseRegistry(doctored as typeof registry),
      /verifiedAgainst is "probably-fine"/,
      'an unknown verifiedAgainst value was accepted',
    );
  });

  it('catches a planted licenseClass value', () => {
    const doctored = {
      ...registry,
      sources: registry.sources.map((source, index) =>
        index === 0 ? { ...source, licenseClass: 'whatever' } : source,
      ),
    };
    assert.throws(() => parseRegistry(doctored as typeof registry), /licenseClass is "whatever"/);
  });

  it('catches a planted tier value', () => {
    const doctored = {
      ...registry,
      sources: registry.sources.map((source, index) =>
        index === 0 ? { ...source, tier: 'PROBABLY' } : source,
      ),
    };
    assert.throws(() => parseRegistry(doctored as typeof registry), /tier is "PROBABLY"/);
  });

  it('catches a verifiedAgainstValues entry going missing', () => {
    const { bundled: _dropped, ...rest } = registry.verifiedAgainstValues;
    const doctored = { ...registry, verifiedAgainstValues: rest };
    assert.throws(
      () => parseRegistry(doctored as typeof registry),
      /missing an entry for "bundled"/,
      'a documented status with no description was accepted',
    );
  });
});
