import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildCabinetQuery,
  buildJudiciaryQuery,
  buildLeadershipTimelineQuery,
  buildLegislatureQuery,
  buildPersonHistoryQuery,
  parseCabinet,
  parseJudiciary,
  parseLeadershipTimeline,
  parseLegislature,
  parsePersonHistory,
  partyBreakdownIsComplete,
  termsSince,
} from '../src/sources/wikidata-government';

/**
 * Hand-authored from the documented Wikidata schema. Never captured.
 * Same regression-suite discipline as tests/fixtures/leaders.
 */

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/government', `${name}.json`), 'utf8'));
}

describe('cabinet — the ordinary case', () => {
  it('reads positions, glosses and holders', () => {
    const cabinet = parseCabinet(fixture('cabinet-normal'));
    assert.equal(cabinet.ministries.length, 5);
    const foreign = cabinet.ministries.find((m) => m.label.includes('Foreign'));
    assert.ok(foreign);
    assert.equal(foreign.holder?.name, 'Dana Fixture');
    assert.match(foreign.description ?? '', /foreign relations/);
  });

  it('leaves a missing gloss null rather than writing one', () => {
    // The "plain-English line on what this ministry does" is Wikidata's own
    // description. Where there is none, the UI says so. Composing a plausible
    // sentence here would be inventing a fact.
    const cabinet = parseCabinet(fixture('cabinet-normal'));
    const justice = cabinet.ministries.find((m) => m.label.includes('Justice'));
    assert.equal(justice?.description, null);
  });

  it('sorts ministries by label so the order is stable across renders', () => {
    const labels = parseCabinet(fixture('cabinet-normal')).ministries.map((m) => m.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
  });
});

describe('cabinet hard case — a large cabinet', () => {
  it('parses 58 posts without collapsing or truncating them', () => {
    const cabinet = parseCabinet(fixture('cabinet-large'));
    assert.equal(cabinet.ministries.length, 58);
  });

  it('counts the vacancies rather than hiding them among the rows', () => {
    const cabinet = parseCabinet(fixture('cabinet-large'));
    assert.ok(cabinet.vacantCount > 0);
    assert.equal(cabinet.vacantCount, cabinet.ministries.filter((m) => m.holder === null).length);
  });
});

describe('cabinet hard case — portfolios with no English gloss', () => {
  it('flags a label that came back as a bare Q-id', () => {
    const cabinet = parseCabinet(fixture('cabinet-untranslated'));
    const untranslated = cabinet.ministries.filter((m) => m.untranslated);
    assert.equal(untranslated.length, 2);
    assert.equal(cabinet.untranslatedCount, 2);
  });

  it('keeps a non-English label rather than dropping the ministry', () => {
    // "Ministerio de Hacienda" is a real name, just not in English. Dropping it
    // would silently shrink the cabinet; translating it would be inventing.
    const cabinet = parseCabinet(fixture('cabinet-untranslated'));
    const spanish = cabinet.ministries.find((m) => m.label === 'Ministerio de Hacienda');
    assert.ok(spanish);
    assert.equal(spanish.untranslated, false);
  });
});

describe('cabinet hard case — no officeholders at all', () => {
  it('returns the positions with null holders rather than an empty cabinet', () => {
    // A cabinet that renders empty reads as "this country has no ministers".
    // The truth is that the posts exist and Wikidata records nobody in them.
    const cabinet = parseCabinet(fixture('cabinet-no-holders'));
    assert.equal(cabinet.ministries.length, 3);
    assert.equal(cabinet.vacantCount, 3);
    assert.ok(cabinet.ministries.every((m) => m.holder === null));
  });

  it('distinguishes that from a query that returned nothing', () => {
    const empty = parseCabinet(fixture('cabinet-empty'));
    assert.equal(empty.ministries.length, 0);
    assert.equal(empty.vacantCount, 0);
  });
});

describe('legislature', () => {
  it('reads chambers and seat totals', () => {
    const chambers = parseLegislature(fixture('legislature-bicameral'));
    assert.equal(chambers.length, 2);
    const commons = chambers.find((c) => c.label.includes('Commons'));
    assert.equal(commons?.seats, 650);
  });

  it('orders parties largest first', () => {
    const commons = parseLegislature(fixture('legislature-bicameral')).find((c) => c.label.includes('Commons'));
    const seats = commons?.parties.map((p) => p.seats ?? -1) ?? [];
    assert.deepEqual(seats, [...seats].sort((a, b) => b - a));
  });

  it('draws the breakdown only when the parties account for the whole chamber', () => {
    const chambers = parseLegislature(fixture('legislature-bicameral'));
    const commons = chambers.find((c) => c.label.includes('Commons'));
    assert.ok(commons && partyBreakdownIsComplete(commons));
  });

  it('refuses to draw a bar from partial party data', () => {
    // 150 recorded seats in a 400-seat chamber, rendered as a stacked bar, reads
    // as a complete picture of the legislature. That is a confident falsehood in
    // the most trusted format there is.
    const chamber = parseLegislature(fixture('legislature-partial-parties'))[0];
    assert.ok(chamber);
    assert.equal(partyBreakdownIsComplete(chamber), false);
  });

  it('refuses to draw a bar when a chamber has no party data', () => {
    const lords = parseLegislature(fixture('legislature-bicameral')).find((c) => c.label.includes('Lords'));
    assert.ok(lords);
    assert.equal(lords.parties.length, 0);
    assert.equal(partyBreakdownIsComplete(lords), false);
  });
});

describe('judiciary', () => {
  it('reads the court, its size and the chief justice', () => {
    const court = parseJudiciary(fixture('judiciary'));
    assert.equal(court?.label, 'Supreme Court');
    assert.equal(court?.seats, 9);
    assert.equal(court?.chiefJustice?.name, 'Justice Fixture');
  });

  it('returns null rather than an empty shell when nothing is recorded', () => {
    assert.equal(parseJudiciary(fixture('judiciary-empty')), null);
  });
});

describe('leadership timeline', () => {
  it('returns ended terms, newest first', () => {
    const terms = parseLeadershipTimeline(fixture('timeline'));
    const dated = terms.filter((t) => t.start !== null);
    const starts = dated.map((t) => t.start ?? '');
    assert.deepEqual(starts, [...starts].sort().reverse());
    assert.ok(terms.some((t) => t.end !== null), 'the point of this query is the terms that ended');
  });

  it('sorts an undated term last rather than guessing it is the oldest', () => {
    const terms = parseLeadershipTimeline(fixture('timeline'));
    assert.equal(terms[terms.length - 1]?.personName, 'Undated Fixture');
  });

  it('windows to a cutoff without dropping a term still in progress', () => {
    const terms = parseLeadershipTimeline(fixture('timeline'));
    const recent = termsSince(terms, new Date('2010-01-01T00:00:00Z'));
    assert.ok(recent.some((t) => t.end === null), 'the current term must survive the window');
    assert.ok(recent.length < terms.length, 'terms ending before the cutoff should fall outside');
    assert.ok(!recent.some((t) => t.personName === 'Casey Fixture'), 'a term ended in 2009 is outside a 2010 window');
  });

  it('keeps a term that ends just inside the window', () => {
    // A term ending 2001-01-20 overlaps a window opening 2001-01-01. Excluding
    // it would silently truncate the record at the boundary.
    const terms = parseLeadershipTimeline(fixture('timeline'));
    const recent = termsSince(terms, new Date('2001-01-01T00:00:00Z'));
    assert.ok(recent.some((t) => t.personName === 'Jordan Fixture'));
  });

  it('keeps a wholly undated term rather than assuming it is out of window', () => {
    // With neither start nor end we cannot place it, and cannot rule it out.
    // Keeping it is conservative; dropping it would hide a term on a guess.
    const terms = parseLeadershipTimeline(fixture('timeline'));
    const recent = termsSince(terms, new Date('2020-01-01T00:00:00Z'));
    assert.ok(recent.some((t) => t.personName === 'Undated Fixture'));
  });
});

describe('person office history', () => {
  it('reads positions with predecessor and successor', () => {
    const history = parsePersonHistory(fixture('person-history'));
    const president = history.find((p) => p.label.includes('President'));
    assert.equal(president?.replaces, 'Robin Fixture');
    const senator = history.find((p) => p.label === 'Senator');
    assert.equal(senator?.replacedBy, 'Kim Fixture');
    assert.equal(senator?.start, '2011-01-03T00:00:00Z');
    assert.equal(senator?.end, '2025-01-03T00:00:00Z');
  });

  it('keeps an undated position rather than discarding it', () => {
    const history = parsePersonHistory(fixture('person-history'));
    assert.ok(history.some((p) => p.label === 'Governor' && p.start === null));
  });
});

describe('query construction', () => {
  it('unions both cabinet modelling paths', () => {
    const query = buildCabinetQuery('GBR');
    assert.match(query, /wdt:P208 \?cabinet/);
    assert.match(query, /wdt:P1001 \?country/);
    assert.match(query, /UNION/);
  });

  it('excludes ended officeholder statements from current-holder queries', () => {
    assert.match(buildCabinetQuery('GBR'), /FILTER NOT EXISTS \{ \?statement pq:P582 \?ended \.? \}/);
    assert.match(buildJudiciaryQuery('GBR'), /FILTER NOT EXISTS \{ \?statement pq:P582 \?ended \.? \}/);
  });

  it('does NOT exclude ended statements from the timeline query', () => {
    // The ended terms are the entire point of the timeline.
    assert.doesNotMatch(buildLeadershipTimelineQuery('GBR'), /FILTER NOT EXISTS/);
  });

  it('validates its inputs rather than interpolating them', () => {
    assert.throws(() => buildLegislatureQuery('gb'));
    assert.throws(() => buildJudiciaryQuery('" } INJECTED {'));
    assert.throws(() => buildPersonHistoryQuery('not-a-qid'));
    assert.doesNotThrow(() => buildPersonHistoryQuery('Q42'));
  });
});
