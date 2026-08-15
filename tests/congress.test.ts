import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SORT_NEWEST_FIRST,
  assertDescendingByUpdate,
  buildRecentBillsUrl,
  parse,
  totalBillsFact,
  type Bill,
} from '../src/sources/congress';
import { ShapeError, type FetchContext } from '../src/sources/adapter';
import { FIXTURES } from './fixtures';
import { factState } from '../src/facts/types';

const CTX: FetchContext = {
  requestUrl: FIXTURES['congress-gov']!.requestUrl,
  httpStatus: 200,
  fetchedAt: '2026-08-15T13:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

const LIVE = parse(FIXTURES['congress-gov']!.body);

describe('congress.gov — the URL the app builds', () => {
  it('never contains a key', () => {
    const url = buildRecentBillsUrl({ limit: 20 });
    assert.equal(url.includes('api_key'), false);
  });

  /**
   * THE ENCODING TRAP.
   *
   * The API's sort value contains a `+` meaning "space". `URLSearchParams` would
   * percent-encode it to `%2B`, at which point the sort is invalid — and this
   * API IGNORES an invalid sort rather than rejecting it, answering 200 with
   * arbitrary order. Correct encoding is indistinguishable from broken encoding
   * unless something checks the ordering.
   */
  it('sends the sort value unencoded, because %2B silently disables it', () => {
    const url = buildRecentBillsUrl({ limit: 20 });
    assert.ok(url.includes(`sort=${SORT_NEWEST_FIRST}`), url);
    assert.equal(url.includes('%2B'), false, 'the + was percent-encoded and the sort is now inert');
  });
});

describe('congress.gov — the captured response', () => {
  it('parses bills and reports the total available', () => {
    assert.ok(LIVE.bills.length > 0);
    assert.ok((LIVE.totalAvailable ?? 0) > 1000, 'pagination.count should be the full corpus');
  });

  it('the capture really is in descending update order', () => {
    // Asserted on the fixture as well as inside parse, so a future re-capture
    // that quietly violates it fails here with a clear name.
    for (let i = 1; i < LIVE.bills.length; i += 1) {
      assert.ok(
        LIVE.bills[i]!.updateDate <= LIVE.bills[i - 1]!.updateDate,
        `row ${i} (${LIVE.bills[i]!.updateDate}) is newer than row ${i - 1}`,
      );
    }
  });

  it('every bill carries the fields a listing needs', () => {
    for (const bill of LIVE.bills) {
      assert.ok(Number.isInteger(bill.congress) && bill.congress > 0);
      assert.match(bill.type, /^[A-Z]+$/);
      assert.ok(bill.number.length > 0);
      assert.ok(bill.title.length > 0);
      assert.match(bill.updateDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(bill.url, /^https:\/\//);
    }
  });

  /**
   * The count is not what a reader will assume, so the Fact says so.
   */
  it('the total is labelled as every Congress, not the current one', () => {
    const fact = totalBillsFact(LIVE, CTX);
    assert.equal(factState(fact), 'ok');
    assert.equal(fact.tier, 'OFFICIAL');
    assert.match(fact.note ?? '', /all Congresses/i);
  });
});

describe('congress.gov — planted cases (rule 27)', () => {
  const bill = (over: Partial<Record<string, unknown>> = {}) => ({
    congress: 119,
    type: 'HR',
    number: '1',
    title: 'A bill',
    originChamber: 'House',
    originChamberCode: 'H',
    updateDate: '2026-08-15',
    introducedDate: '2026-01-03',
    latestAction: { actionDate: '2026-08-14', text: 'Referred to committee.' },
    url: 'https://api.congress.gov/v3/bill/119/hr/1?format=json',
    ...over,
  });

  const payload = (bills: unknown[]) => ({ bills, pagination: { count: bills.length }, request: {} });

  /**
   * THE CASE THIS ADAPTER EXISTS FOR.
   *
   * Measured 2026-08-15: `sort=bogus` returns HTTP 200 with results in arbitrary
   * order and no error anywhere. A panel headed "latest activity" would render
   * decade-old bills and nothing would be wrong enough to notice.
   */
  it('refuses a response that is not in the order it asked for', () => {
    const unsorted = payload([
      bill({ updateDate: '2026-08-10' }),
      bill({ updateDate: '2026-08-15', number: '2' }),
    ]);
    assert.throws(() => parse(unsorted), ShapeError);
    assert.throws(() => parse(unsorted), /ignored sort=updateDate\+desc/);
  });

  it('does not re-sort the rows, because that would hide the ignored parameter', () => {
    /**
     * Sorting locally would make page 1 look right while the sequence beneath it
     * was meaningless: page 2 of an unsorted result set is not the continuation
     * of page 1.
     */
    assert.throws(
      () =>
        parse(
          payload([bill({ updateDate: '2026-01-01' }), bill({ updateDate: '2026-06-01', number: '2' })]),
        ),
      ShapeError,
    );
  });

  it('accepts equal update dates, which are ordinary rather than a violation', () => {
    const same = payload([bill({ updateDate: '2026-08-15' }), bill({ updateDate: '2026-08-15', number: '2' })]);
    assert.equal(parse(same).bills.length, 2);
  });

  it('treats an absent introducedDate or latestAction as absent, not as an error', () => {
    const sparse = payload([bill({ introducedDate: undefined, latestAction: undefined })]);
    const parsed = parse(sparse);
    assert.equal(parsed.bills[0]!.introducedDate, null);
    assert.equal(parsed.bills[0]!.latestActionDate, null);
    assert.equal(parsed.bills[0]!.latestActionText, null);
  });

  it('refuses a malformed date rather than rendering it', () => {
    assert.throws(() => parse(payload([bill({ updateDate: '15/08/2026' })])), ShapeError);
    assert.throws(() => parse(payload([bill({ updateDate: 20260815 })])), ShapeError);
  });

  it('refuses a non-integer congress number', () => {
    assert.throws(() => parse(payload([bill({ congress: '119' })])), ShapeError);
  });

  it('the ordering check is callable on its own, and passes a sorted list', () => {
    // Rule 32: the judgement is reachable without constructing a whole response.
    const sorted = [
      { updateDate: '2026-08-15' },
      { updateDate: '2026-08-15' },
      { updateDate: '2026-08-01' },
    ] as Bill[];
    assert.doesNotThrow(() => assertDescendingByUpdate(sorted));
    assert.throws(
      () => assertDescendingByUpdate([{ updateDate: '2026-01-01' }, { updateDate: '2026-09-09' }] as Bill[]),
      ShapeError,
    );
  });

  it('a missing pagination count is null, never zero', () => {
    // Rule 30: "the API did not say" is not "there are none".
    const parsed = parse({ bills: [bill()], request: {} });
    assert.equal(parsed.totalAvailable, null);
    assert.equal(totalBillsFact(parsed, CTX).value, null);
    assert.equal(factState(totalBillsFact(parsed, CTX)), 'nodata');
  });
});
