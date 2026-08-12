import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { buildCountryQueryUrl, parseCountryDossier } from '../src/sources/wikidata-dossier';
import {
  buildCabinetQuery,
  buildJudiciaryQuery,
  buildLeadershipTimelineQuery,
  buildPersonHistoryQuery,
  parseCabinet,
  parseJudiciary,
  parseLeadershipTimeline,
  parsePersonHistory,
} from '../src/sources/wikidata-government';

/**
 * Contract tests for the query builders behind the dossier header and the
 * government tab.
 *
 * These modules build six SPARQL queries and had NO contract test between them
 * and the live source — the `wikidata-sparql` contract covered only generic
 * binding flattening, not the queries these construct. That is the same shape as
 * the three shipped-but-unvalidated sources: shipped code whose real request had
 * never been checked against a real response.
 *
 * Every fixture here is a LIVE CAPTURE from a real country, never a hand-edited
 * copy of another capture. A hand-edited fixture is a prediction about what
 * Wikidata returns when a binding is absent, and this project's predictions about
 * response shape have been wrong about half the time.
 */
function capture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/wikidata', `${name}.json`), 'utf8'));
}

/** Rows and distinct entities are different numbers whenever a query has OPTIONALs (rule 28). */
function rowsAndDistinct(raw: unknown, variable: string): { rows: number; distinct: number } {
  const bindings = (raw as { results: { bindings: Array<Record<string, { value?: string }>> } }).results.bindings;
  return {
    rows: bindings.length,
    distinct: new Set(bindings.map((row) => row[variable]?.value).filter(Boolean)).size,
  };
}

describe('query 1 — country dossier', () => {
  it('builds a URL that invokes the label service', () => {
    // The body carries *Label bindings, which Wikidata only populates when the
    // label service is invoked. A query without it cannot produce this response.
    assert.match(decodeURIComponent(buildCountryQueryUrl('FRA')), /SERVICE\s+wikibase:label/i);
  });

  it('parses an ordinary country', () => {
    const record = parseCountryDossier(capture('dossier-fra'));
    assert.equal(record.headOfStateIsPerson, true);
    assert.equal(record.headOfStateHolderCount, 1);
    assert.equal(record.countryQids.length, 1);
    assert.ok(record.headOfState);
    assert.ok(record.formLabels.length >= 1);
  });

  it('cross-products its optionals, so rows exceed distinct entities', () => {
    const { rows, distinct } = rowsAndDistinct(capture('dossier-fra'), 'hos');
    assert.ok(rows > distinct, `rows ${rows} should exceed distinct holders ${distinct}`);
    assert.equal(distinct, 1, 'France has one head of state');
  });

  /** Palestine: P298 "PSE" binds two Wikidata items. Captured, not imagined. */
  it('reports every country entity an ISO code matched', () => {
    const record = parseCountryDossier(capture('dossier-pse'));
    assert.ok(record.countryQids.length > 1, 'PSE is expected to match more than one entity');
    assert.ok(record.formLabels.length > 1, 'PSE is expected to carry several forms of government');
  });
});

describe('query 2 — cabinet', () => {
  it('names the country it was built for', () => {
    assert.match(buildCabinetQuery('ISL'), /"ISL"/);
  });

  it('parses a cabinet and counts positions, not rows', () => {
    const raw = capture('cabinet-isl');
    const { rows, distinct } = rowsAndDistinct(raw, 'position');
    // 33 rows, 31 positions in the live capture: a minister with two parties or
    // two images yields two rows, and counting rows would invent ministries.
    assert.ok(rows > distinct, `rows ${rows} should exceed distinct positions ${distinct}`);
    const cabinet = parseCabinet(raw);
    assert.equal(cabinet.ministries.length, distinct, 'the parser counted rows rather than positions');
  });

  it('parses a small cabinet without collapsing it', () => {
    const raw = capture('cabinet-tuv');
    const { distinct } = rowsAndDistinct(raw, 'position');
    assert.equal(parseCabinet(raw).ministries.length, distinct);
  });

  it('reports vacancies as a property of the parsed set', () => {
    const cabinet = parseCabinet(capture('cabinet-isl'));
    assert.equal(cabinet.vacantCount, cabinet.ministries.filter((m) => m.holder === null).length);
  });
});

describe('query 4 — judiciary', () => {
  it('names the country it was built for', () => {
    assert.match(buildJudiciaryQuery('GBR'), /"GBR"/);
  });

  it('parses the apex court from the first row', () => {
    const raw = capture('judiciary-gbr');
    const { rows, distinct } = rowsAndDistinct(raw, 'court');
    assert.ok(rows >= distinct);
    const court = parseJudiciary(raw);
    assert.ok(court, 'a country with a recorded apex court parsed to null');
    assert.ok(court.label.length > 0);
    assert.ok(court.seats === null || court.seats > 0, 'a court cannot have zero or negative seats');
  });
});

describe('query 5 — leadership timeline', () => {
  it('names the country it was built for', () => {
    assert.match(buildLeadershipTimelineQuery('FRA'), /"FRA"/);
  });

  it('counts people, not rows', () => {
    const raw = capture('timeline-fra');
    const { rows, distinct } = rowsAndDistinct(raw, 'person');
    // 23 rows, 22 people live: one holder appears twice.
    assert.ok(rows > distinct, `rows ${rows} should exceed distinct people ${distinct}`);
    const terms = parseLeadershipTimeline(raw);
    assert.ok(terms.length > 0);
    assert.ok(terms.length <= rows, 'more terms than rows is impossible');
  });

  /**
   * Named after the invariant, not the input (rule 2). The first draft of this
   * test asserted ASCENDING order and failed; the parser is right and the test
   * was wrong. `wikidata-government.ts` sorts newest first deliberately, with
   * undated terms last — an undated term cannot be placed on a timeline, and
   * putting it first would date it by implication.
   */
  it('puts the most recent term first, with undated terms last', () => {
    const terms = parseLeadershipTimeline(capture('timeline-fra'));
    const dated = terms.filter((term) => term.start !== null).map((term) => term.start as string);
    assert.ok(dated.length > 1, 'need several dated terms to check ordering');
    assert.deepEqual([...dated].sort().reverse(), dated, 'dated terms are not newest-first');

    const firstUndated = terms.findIndex((term) => term.start === null);
    if (firstUndated !== -1) {
      assert.ok(
        terms.slice(firstUndated).every((term) => term.start === null),
        'a dated term appears after an undated one',
      );
    }
  });
});

describe('query 6 — person history', () => {
  it('names the person it was built for', () => {
    assert.match(buildPersonHistoryQuery('Q3052772'), /Q3052772/);
  });

  it('parses the offices a person has held', () => {
    const raw = capture('person-history');
    const { distinct } = rowsAndDistinct(raw, 'position');
    const history = parsePersonHistory(raw);
    assert.ok(history.length > 0);
    assert.ok(history.length <= distinct + 1, 'more offices than the query returned');
  });
});
