import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import { authorityOfficeFor, classifyForm, overrideFor, resolveLeader } from '../src/dossier/resolve';
import {
  commonsThumbnail,
  fileTitleFromUrl,
  initialsOf,
  parseCommonsAttribution,
  resolvePortrait,
} from '../src/dossier/portrait';
import { ageFact, buildCountryQuery, parseCountryDossier } from '../src/sources/wikidata-dossier';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { factState } from '../src/facts/types';

/**
 * PERMANENT REGRESSION SUITE for leader resolution.
 *
 * These fixtures are hand-authored from the documented Wikidata schema and have
 * never touched the live endpoint. When we go live and Wikidata contradicts one
 * of them, that is a finding to investigate — NOT a fixture to quietly update.
 *
 * The invariant under test is WHICH RULE FIRES and what shape the header takes.
 * The people in the fixtures are synthetic on purpose: hand-typing a real
 * officeholder would be asserting a political fact this app has not verified,
 * and the resolution logic does not depend on names.
 */

const CTX: FetchContext = {
  requestUrl: 'https://query.wikidata.org/sparql?format=json&query=...',
  httpStatus: 200,
  fetchedAt: '1970-01-01T00:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/leaders', `${name}.json`), 'utf8'));
}

function resolveFixture(name: string, iso3: string) {
  return resolveLeader(iso3, parseCountryDossier(fixture(name)));
}

describe('rule 1 — de facto authority above the formal head of state', () => {
  it('shows the supreme authority as primary and the formal head of state as secondary', () => {
    const result = resolveFixture('de-facto-authority', 'IRN');
    assert.equal(result.ruleNumber, 1);
    assert.equal(result.class, 'de-facto-authority');
    assert.equal(result.primary?.person.name, 'Morgan Fixture');
    assert.equal(result.primary?.title, 'Supreme Leader of Iran');
    assert.equal(result.secondary?.person.name, 'Casey Fixture');
    assert.equal(result.secondary?.title, 'President of Iran');
  });

  it('carries the override citation so the editorial choice is auditable', () => {
    const result = resolveFixture('de-facto-authority', 'IRN');
    assert.ok(result.override);
    assert.match(result.override.sourceUrl, /^https?:\/\//);
    assert.ok(result.override.reviewedAt.length > 0);
  });

  it('fires even though the form of government matches no classification rule', () => {
    // The Iran fixture's form is "Islamic republic", which matches nothing.
    // The override must win on its own rather than depending on the form table.
    assert.equal(classifyForm('Islamic republic'), null);
    assert.equal(resolveFixture('de-facto-authority', 'IRN').ruleNumber, 1);
  });

  it('falls back loudly when the authority office returns no holder', () => {
    const result = resolveFixture('de-facto-authority-missing-holder', 'IRN');
    assert.notEqual(result.ruleNumber, 1);
    assert.ok(
      result.warnings.some((warning) => warning.includes('understate who actually holds power')),
      'a silent fallback would show the President as though he were the top authority',
    );
  });

  it('ignores an override with no citation', () => {
    // Guards the mechanism itself: an override is a reviewed correction, not a
    // place to encode an opinion about who really runs a country.
    assert.equal(overrideFor('USA'), undefined);
    assert.equal(authorityOfficeFor('USA'), undefined);
    assert.ok(authorityOfficeFor('IRN'));
  });
});

describe('rule 2 — presidential system', () => {
  it('leads with the head of state', () => {
    const result = resolveFixture('presidential', 'USA');
    assert.equal(result.ruleNumber, 2);
    assert.equal(result.primary?.person.name, 'Alex Fixture');
    assert.equal(result.primary?.title, 'President of the United States');
    assert.equal(result.secondary, null);
  });

  it('treats a semi-presidential system as presidential', () => {
    const rule = classifyForm('semi-presidential system');
    assert.equal(rule?.class, 'presidential');
    // Ordering guard: "semi-presidential" contains "presidential", so the
    // specific rule must be tested first or the general one swallows it.
    assert.equal(classifyForm('presidential system')?.class, 'presidential');
  });
});

describe('rule 3 — parliamentary systems render two portraits', () => {
  it('puts the prime minister first and the monarch second', () => {
    const result = resolveFixture('parliamentary-monarch', 'GBR');
    assert.equal(result.ruleNumber, 3);
    assert.equal(result.class, 'parliamentary-monarch');
    assert.equal(result.primary?.person.name, 'Sam Fixture');
    assert.equal(result.primary?.role, 'Head of government');
    assert.equal(result.secondary?.person.name, 'Robin Fixture');
    assert.equal(result.secondary?.role, 'Monarch (ceremonial)');
  });

  it('puts the chancellor first and the ceremonial president second', () => {
    const result = resolveFixture('parliamentary-republic', 'DEU');
    assert.equal(result.ruleNumber, 3);
    assert.equal(result.class, 'parliamentary-republic');
    assert.equal(result.primary?.person.name, 'Chris Fixture');
    assert.equal(result.primary?.title, 'Chancellor of Germany');
    assert.equal(result.secondary?.role, 'Head of state (ceremonial)');
  });

  it('labels the ceremonial role differently for a monarch and a president', () => {
    const monarchy = resolveFixture('parliamentary-monarch', 'GBR');
    const republic = resolveFixture('parliamentary-republic', 'DEU');
    assert.notEqual(monarchy.secondary?.role, republic.secondary?.role);
  });
});

describe('rule 4 — executive monarchy', () => {
  it('leads with the monarch', () => {
    const result = resolveFixture('executive-monarchy', 'SAU');
    assert.equal(result.ruleNumber, 4);
    assert.equal(result.primary?.person.name, 'Taylor Fixture');
    assert.equal(result.primary?.role, 'Monarch');
  });

  it('does not confuse an absolute monarchy with a constitutional one', () => {
    assert.equal(classifyForm('absolute monarchy')?.class, 'executive-monarchy');
    assert.equal(classifyForm('constitutional monarchy')?.class, 'parliamentary-monarch');
    // Bare "monarchy" is tested last, so the qualified forms win.
    assert.equal(classifyForm('monarchy')?.class, 'executive-monarchy');
  });
});

describe('rule 5 — transitional and military governments', () => {
  it('keeps the literal title rather than smoothing it to a constitutional office', () => {
    const result = resolveFixture('transitional', 'MLI');
    assert.equal(result.ruleNumber, 5);
    assert.equal(result.primary?.title, 'Chairman, Transitional Military Council');
    assert.doesNotMatch(result.primary?.title ?? '', /President/);
    assert.match(result.ruleReason, /has not been normalised/);
  });

  it('recognises junta, provisional and transitional wording', () => {
    for (const label of ['military junta', 'provisional government', 'transitional government']) {
      assert.equal(classifyForm(label)?.class, 'transitional', `"${label}" should classify as transitional`);
    }
  });
});

describe('unresolvable cases are stated, not guessed', () => {
  it('reports undetermined when the form of government matches nothing', () => {
    const record = parseCountryDossier(fixture('presidential'));
    const mutated = { ...record, formLabel: 'people’s democratic something' };
    const result = resolveLeader('XXX', mutated);
    assert.equal(result.class, 'undetermined');
    assert.equal(result.ruleNumber, 0);
    assert.match(result.ruleReason, /cannot say which office leads/);
    assert.ok(result.warnings.some((warning) => warning.includes('does not match any classification rule')));
  });

  it('reports no-data when neither office is recorded', () => {
    const result = resolveFixture('no-leader', 'XXX');
    assert.equal(result.class, 'no-data');
    assert.equal(result.primary, null);
  });

  it('never invents a generic "Leader" title', () => {
    const result = resolveFixture('degraded-vitals', 'MLI');
    assert.equal(result.primary?.title, 'Chairman, Transitional Military Council');
    for (const name of ['presidential', 'transitional', 'executive-monarchy', 'degraded-vitals']) {
      const iso = name === 'presidential' ? 'USA' : name === 'executive-monarchy' ? 'SAU' : 'MLI';
      const title = resolveFixture(name, iso).primary?.title;
      assert.notEqual(title, 'Leader');
    }
  });
});

describe('portrait resolution', () => {
  it('builds a sized Commons thumbnail from P18', () => {
    const record = parseCountryDossier(fixture('presidential'));
    const person = record.headOfState;
    assert.ok(person?.imageUrl);
    const portrait = resolvePortrait(person.name, person.imageUrl, null, 192);
    assert.equal(portrait.origin, 'commons');
    assert.match(portrait.url ?? '', /width=192/);
    assert.equal(portrait.fileTitle, 'File:Alex Fixture portrait.jpg');
  });

  it('falls back to the Wikipedia thumbnail when P18 is absent', () => {
    const record = parseCountryDossier(fixture('missing-image'));
    const person = record.headOfState;
    assert.equal(person?.imageUrl, null);
    const portrait = resolvePortrait(person!.name, null, 'https://example.test/thumb.jpg');
    assert.equal(portrait.origin, 'wikipedia');
  });

  it('falls back to initials, never to another person', () => {
    const portrait = resolvePortrait('Alex Fixture', null, null);
    assert.equal(portrait.origin, 'placeholder');
    assert.equal(portrait.url, null, 'the placeholder must not carry any image URL');
    assert.equal(portrait.initials, 'AF');
  });

  it('takes first and last initials, not the first two', () => {
    assert.equal(initialsOf('Ursula von der Leyen'), 'UL');
    assert.equal(initialsOf('Prince'), 'P');
    assert.equal(initialsOf('  '), '?');
    assert.equal(initialsOf('Ólafur Ragnar Grímsson'), 'ÓG');
  });

  it('recovers the Commons file title for the attribution lookup', () => {
    assert.equal(
      fileTitleFromUrl('http://commons.wikimedia.org/wiki/Special:FilePath/Some%20Person.jpg'),
      'File:Some Person.jpg',
    );
    assert.equal(fileTitleFromUrl('https://example.test/not-commons.jpg'), null);
  });

  it('appends width correctly whether or not the URL already has a query', () => {
    assert.match(commonsThumbnail('https://x.test/a.jpg', 96), /\?width=96$/);
    assert.match(commonsThumbnail('https://x.test/a.jpg?v=2', 96), /&width=96$/);
  });
});

describe('portrait attribution', () => {
  it('extracts licence and photographer, stripping the HTML Commons returns', () => {
    const attribution = parseCommonsAttribution(fixture('commons-imageinfo'));
    assert.equal(attribution.licenseShortName, 'CC BY-SA 4.0');
    assert.equal(attribution.artist, 'Jo Photographer');
    assert.doesNotMatch(attribution.artist ?? '', /</);
    assert.equal(attribution.creditRequired, true);
  });

  it('assumes credit is required when the licence cannot be read', () => {
    // Failing open here would mean silently dropping a legally required credit.
    const attribution = parseCommonsAttribution(fixture('commons-imageinfo-missing'));
    assert.equal(attribution.licenseShortName, null);
    assert.equal(attribution.creditRequired, true);
  });

  it('does not require credit for public domain', () => {
    const pd = parseCommonsAttribution({
      query: { pages: { 1: { imageinfo: [{ extmetadata: { LicenseShortName: { value: 'Public domain' } } }] } } },
    });
    assert.equal(pd.creditRequired, false);
  });
});

describe('country record parsing', () => {
  it('reads vitals and both offices', () => {
    const record = parseCountryDossier(fixture('parliamentary-monarch'));
    assert.equal(record.name, 'United Kingdom');
    assert.equal(record.officialName, 'United Kingdom of Great Britain and Northern Ireland');
    assert.equal(record.capital, 'London');
    assert.ok((record.population ?? 0) > 1_000_000);
    assert.ok(record.headOfState && record.headOfGovernment);
  });

  it('yields nulls rather than guesses when vitals are absent', () => {
    const record = parseCountryDossier(fixture('degraded-vitals'));
    const person = record.headOfState;
    assert.ok(person);
    assert.equal(person.birthDate, null);
    assert.equal(person.party, null);
    assert.equal(person.imageUrl, null);
    assert.equal(person.officeTitle, 'Chairman, Transitional Military Council');
  });

  it('rejects an empty result rather than rendering an empty dossier', () => {
    assert.throws(() => parseCountryDossier({ head: { vars: [] }, results: { bindings: [] } }), ShapeError);
  });

  it('computes age as a DERIVED fact tracing back to the date of birth', () => {
    const record = parseCountryDossier(fixture('presidential'));
    const fact = ageFact(record.headOfState!, CTX, new Date('2026-08-11T00:00:00Z'));
    assert.equal(fact.value, 58); // born 1968-03-14
    assert.equal(fact.tier, 'DERIVED');
    assert.equal(fact.provenance?.kind, 'derived');
    assert.equal(factState(fact), 'ok');
  });

  it('reports no age rather than zero when the date of birth is missing', () => {
    const record = parseCountryDossier(fixture('degraded-vitals'));
    const fact = ageFact(record.headOfState!, CTX, new Date('2026-08-11T00:00:00Z'));
    assert.equal(fact.value, null);
    assert.equal(factState(fact), 'nodata');
  });
});

describe('SPARQL query construction', () => {
  it('filters out ended terms so a former head of state cannot be returned', () => {
    const query = buildCountryQuery('USA');
    assert.match(query, /FILTER NOT EXISTS \{ \?hosStatement pq:P582 \?hosEnded \.? \}/);
    assert.match(query, /FILTER NOT EXISTS \{ \?hogStatement pq:P582 \?hogEnded \.? \}/);
  });

  it('injects the authority office only when an override supplies one', () => {
    assert.doesNotMatch(buildCountryQuery('USA'), /P1308/);
    assert.match(buildCountryQuery('IRN', authorityOfficeFor('IRN')), /wdt:P1308 \?authority/);
  });

  it('refuses anything that is not an alpha-3 code', () => {
    assert.throws(() => buildCountryQuery('US'));
    assert.throws(() => buildCountryQuery('usa'));
    assert.throws(() => buildCountryQuery('" } INJECTED {'));
  });
});

/**
 * The rule number and the rule label are two representations of the same
 * decision, and nothing tied them together.
 *
 * A mutation that changed `ruleNumber` from 1 to 9 survived the entire browser
 * suite: the rendered text comes from `ruleLabel`, while `ruleNumber` only feeds
 * a `data-rule` styling hook, so the two could disagree with no test noticing. A
 * header reading "Rule 1" while its own data attribute says 9 is incoherent, and
 * whichever a future reader trusts, one of them is lying.
 */
describe('rule number and rule label agree', () => {
  const CASES: Array<[string, string]> = [
    ['de-facto-authority', 'IRN'],
    ['presidential', 'USA'],
    ['parliamentary-republic', 'DEU'],
    ['parliamentary-monarch', 'GBR'],
    ['executive-monarchy', 'SAU'],
    ['transitional', 'MLI'],
    ['no-leader', 'XXA'],
    ['degraded-vitals', 'XXB'],
  ];

  it('labels every numbered rule with its own number', () => {
    for (const [name, iso3] of CASES) {
      const result = resolveFixture(name, iso3);
      if (result.ruleNumber > 0) {
        assert.ok(
          result.ruleLabel.startsWith(`Rule ${result.ruleNumber} `),
          `${name}: ruleNumber ${result.ruleNumber} but label "${result.ruleLabel}"`,
        );
      } else {
        // Rule 0 is "no rule fired", and its labels are prose. A label reading
        // "Rule 0" would invent a rule that does not exist.
        assert.ok(
          !result.ruleLabel.startsWith('Rule '),
          `${name}: ruleNumber 0 must not claim to be a numbered rule, got "${result.ruleLabel}"`,
        );
      }
    }
  });

  it('positive control: the fixtures exercise every rule number', () => {
    // Rule 10. The invariant above would hold vacuously over a single branch.
    const observed = new Set(CASES.map(([name, iso3]) => resolveFixture(name, iso3).ruleNumber));
    assert.deepEqual([...observed].sort(), [0, 1, 2, 3, 4, 5]);
  });
});
