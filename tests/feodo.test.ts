import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildBlocklistUrl, online, onlineInCountryFact, parse } from '../src/sources/feodo';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { factState } from '../src/facts/types';

const BODY = JSON.parse(readFileSync(new URL('./fixtures/risk/feodo-c2.json', import.meta.url), 'utf8'));
const LIVE = parse(BODY);

const CTX: FetchContext = {
  requestUrl: buildBlocklistUrl(),
  httpStatus: 200,
  fetchedAt: '2026-08-15T16:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

describe('Feodo — online and offline are different claims', () => {
  it('the capture contains both, so the distinction is exercised', () => {
    const live = online(LIVE);
    assert.ok(live.length > 0, 'no online servers — the online path is untested here');
    assert.ok(live.length < LIVE.length, 'no offline servers — the distinction is untested here');
  });

  /**
   * An offline C2 is a record of what happened. Counting it as a present threat
   * is rule 22's aggregation across kinds: "how many are live" and "how many
   * have been seen" are different questions, and one number cannot answer both.
   */
  it('a country count never includes a server that stopped answering', () => {
    const offlineCountry = LIVE.find((s) => s.status === 'offline' && s.country !== null)?.country;
    assert.ok(offlineCountry, 'the capture should contain an offline server with a country');

    const counted = onlineInCountryFact(LIVE, offlineCountry, CTX).value ?? 0;
    const liveThere = online(LIVE).filter((s) => s.country === offlineCountry).length;
    assert.equal(counted, liveThere, 'an offline server was counted as current');
  });
});

describe('Feodo — an entry is a statement about a host', () => {
  it('the note says where the machines are, and what that does not mean', () => {
    const country = online(LIVE)[0]?.country;
    assert.ok(country);
    const fact = onlineInCountryFact(LIVE, country, CTX);

    assert.equal(fact.tier, 'OFFICIAL');
    assert.match(fact.note ?? '', /HOSTED in this country/);
    // The three unsupported readings the country column invites.
    assert.match(fact.note ?? '', /not who operates them/i);
    assert.match(fact.note ?? '', /where they are operated from/i);
    assert.match(fact.note ?? '', /compromised server/i);
  });

  it('never describes the data as attacks from a country', () => {
    const country = online(LIVE)[0]?.country;
    assert.ok(country);
    const note = (onlineInCountryFact(LIVE, country, CTX).note ?? '').toLowerCase();
    for (const forbidden of ['attack', 'perpetrat', 'launched', 'responsible']) {
      assert.equal(note.includes(forbidden), false, `the note used "${forbidden}"`);
    }
  });

  it('a country with no online servers reports zero, not no-data', () => {
    // Rule 30 the other way round: we DID look, and there were none. That is a
    // measured zero, distinct from a country we never asked about.
    const fact = onlineInCountryFact(LIVE, 'AQ', CTX);
    assert.equal(fact.value, 0);
    assert.equal(factState(fact), 'ok');
  });
});

describe('Feodo — planted cases (rule 27)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    ip_address: '203.0.113.10',
    port: 8080,
    status: 'online',
    hostname: null,
    as_number: 64496,
    as_name: 'EXAMPLE-AS',
    country: 'US',
    first_seen: '2026-01-02 03:04:05',
    last_online: '2026-08-14',
    malware: 'Emotet',
    ...over,
  });

  it('normalises both date shapes abuse.ch emits', () => {
    const parsed = parse([row()]);
    assert.equal(parsed[0]!.firstSeen, '2026-01-02T03:04:05Z');
    assert.equal(parsed[0]!.lastOnline, '2026-08-14T00:00:00Z');
  });

  it('refuses a date in neither shape rather than producing an Invalid Date', () => {
    // An unparseable date becoming NaN renders as blank, which reads as "no
    // record" instead of "we could not read the record".
    assert.throws(() => parse([row({ first_seen: 'last Tuesday' })]), ShapeError);
    assert.throws(() => parse([row({ first_seen: 1735786800 })]), ShapeError);
  });

  it('a still-online server has a null lastOnline, not a fabricated one', () => {
    const parsed = parse([row({ status: 'online', last_online: null })]);
    assert.equal(parsed[0]!.lastOnline, null);
  });

  it('refuses a third status rather than silently grouping it', () => {
    /**
     * A new status would mean current and historical records can no longer be
     * told apart — and `online()` would quietly exclude it, under-counting
     * without anything failing.
     */
    assert.throws(() => parse([row({ status: 'unknown' })]), ShapeError);
    assert.throws(() => parse([row({ status: 'unknown' })]), /told apart/);
  });

  it('refuses an out-of-range port or a malformed address', () => {
    assert.throws(() => parse([row({ port: 0 })]), ShapeError);
    assert.throws(() => parse([row({ port: 70000 })]), ShapeError);
    assert.throws(() => parse([row({ ip_address: 'not-an-address' })]), ShapeError);
  });

  it('an absent country stays absent rather than becoming a country', () => {
    const parsed = parse([row({ country: null }), row({ country: '  ' })]);
    assert.equal(parsed[0]!.country, null);
    assert.equal(parsed[1]!.country, null);
    // And such a host is not counted under any country.
    assert.equal(onlineInCountryFact(parsed, 'US', CTX).value, 0);
  });

  it('an absent AS number or hostname is null, never zero or empty string', () => {
    const parsed = parse([row({ as_number: null, as_name: '', hostname: '' })]);
    assert.equal(parsed[0]!.asNumber, null);
    assert.equal(parsed[0]!.asName, null);
    assert.equal(parsed[0]!.hostname, null);
  });

  it('refuses a missing malware family rather than rendering a blank badge', () => {
    assert.throws(() => parse([row({ malware: '' })]), ShapeError);
  });
});
