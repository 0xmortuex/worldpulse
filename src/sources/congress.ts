import type { Fact } from '../facts/types';
import {
  expectArray,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'congress-gov';

const SERVICE = 'https://api.congress.gov/v3/bill';

/**
 * Recently-updated bills before Congress.
 *
 * ## The key never appears here
 *
 * congress.gov accepts `?api_key=` and an `X-Api-Key` header (both measured, both
 * 200; unauthenticated is 403). The registry declares the query form because that
 * is what the Worker appends. This builder emits no key.
 *
 * ## THE SORT IS LOAD-BEARING AND THE API WILL NOT TELL YOU IF IT IGNORED IT
 *
 * Measured 2026-08-15:
 *
 *   (no sort)              110th Congress, bills from 2007
 *   sort=updateDate+desc   119th Congress, updated today
 *   sort=bogus             200 OK, arbitrary order, NO ERROR
 *
 * The default order is not "latest" — it returns decade-old bills out of 429,656
 * — and an invalid sort value is silently ignored rather than rejected. So a typo
 * here produces a successful response full of plausible bills in no useful order,
 * and a panel headed "latest activity" would be quietly wrong.
 *
 * `parse` therefore CHECKS THE ORDERING IT ASKED FOR rather than trusting that
 * the request was honoured. See `assertDescendingByUpdate`.
 */
export const SORT_NEWEST_FIRST = 'updateDate+desc';

export interface BillQuery {
  /** How many bills to request. The API caps this at 250. */
  limit: number;
}

export function buildRecentBillsUrl(query: BillQuery): string {
  /**
   * Built by hand rather than with URLSearchParams, because the API's sort value
   * contains a `+` that means "space" to it and would be percent-encoded to
   * `%2B` by URLSearchParams — at which point the sort is invalid, and the API
   * silently ignores it rather than complaining. Encoding correctness here is
   * indistinguishable from a working request unless the ordering is checked.
   */
  return `${SERVICE}?format=json&limit=${encodeURIComponent(String(query.limit))}&sort=${SORT_NEWEST_FIRST}`;
}

export interface Bill {
  congress: number;
  /** Bill type as the API gives it: HR, S, HCONRES, … */
  type: string;
  number: string;
  title: string;
  originChamber: string;
  /** ISO date, YYYY-MM-DD. */
  updateDate: string;
  /** Absent for some bills; the API omits the field rather than sending null. */
  introducedDate: string | null;
  latestActionDate: string | null;
  latestActionText: string | null;
  /** congress.gov's own API URL for the bill, not a human page. */
  url: string;
}

export interface BillList {
  bills: Bill[];
  /** Total matching the query, from `pagination.count` — not the number returned. */
  totalAvailable: number | null;
}

function isoDate(value: unknown, at: string): string {
  const text = expectString(SOURCE_ID, value, at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ShapeError(SOURCE_ID, `${at} is "${text}", expected YYYY-MM-DD`);
  }
  return text;
}

/** Absent and null both mean "not provided"; neither is an error. */
function optionalIsoDate(value: unknown, at: string): string | null {
  if (value === undefined || value === null) return null;
  return isoDate(value, at);
}

/**
 * The ordering check, separated so it can be called with a planted list.
 *
 * **Throws rather than re-sorting.** Sorting the rows ourselves would hide the
 * fact that the API ignored the request, and the next symptom would be a
 * pagination bug: page 2 of an unsorted result set is not the continuation of
 * page 1, so a locally-sorted page 1 would look correct while the sequence
 * underneath it was meaningless.
 */
export function assertDescendingByUpdate(bills: readonly Bill[]): void {
  for (let i = 1; i < bills.length; i += 1) {
    const previous = bills[i - 1]!;
    const current = bills[i]!;
    if (current.updateDate > previous.updateDate) {
      throw new ShapeError(
        SOURCE_ID,
        `bills are not in descending updateDate order (${previous.updateDate} then ` +
          `${current.updateDate}) — the API ignored sort=${SORT_NEWEST_FIRST} and answered 200. ` +
          'These are not the most recently updated bills',
      );
    }
  }
}

export function parse(payload: unknown): BillList {
  const root = expectObject(SOURCE_ID, payload, 'response');
  const rows = expectArray(SOURCE_ID, root['bills'], 'bills');

  const bills = rows.map((entry, index): Bill => {
    const row = expectObject(SOURCE_ID, entry, `bills[${index}]`);
    const action = row['latestAction'] === undefined
      ? null
      : expectObject(SOURCE_ID, row['latestAction'], `bills[${index}].latestAction`);

    const congress = row['congress'];
    if (typeof congress !== 'number' || !Number.isInteger(congress)) {
      throw new ShapeError(SOURCE_ID, `bills[${index}].congress is ${JSON.stringify(congress)}, expected an integer`);
    }

    return {
      congress,
      type: expectString(SOURCE_ID, row['type'], `bills[${index}].type`),
      // `number` is a STRING in this API ("12"), not a number, and bill numbers
      // are not always purely numeric across chambers. Kept as given.
      number: expectString(SOURCE_ID, row['number'], `bills[${index}].number`),
      title: expectString(SOURCE_ID, row['title'], `bills[${index}].title`),
      originChamber: expectString(SOURCE_ID, row['originChamber'], `bills[${index}].originChamber`),
      updateDate: isoDate(row['updateDate'], `bills[${index}].updateDate`),
      introducedDate: optionalIsoDate(row['introducedDate'], `bills[${index}].introducedDate`),
      latestActionDate: action ? optionalIsoDate(action['actionDate'], `bills[${index}].latestAction.actionDate`) : null,
      latestActionText: action && action['text'] !== undefined
        ? expectString(SOURCE_ID, action['text'], `bills[${index}].latestAction.text`)
        : null,
      url: expectString(SOURCE_ID, row['url'], `bills[${index}].url`),
    };
  });

  assertDescendingByUpdate(bills);

  const pagination = root['pagination'];
  const count =
    pagination && typeof pagination === 'object' && typeof (pagination as Record<string, unknown>)['count'] === 'number'
      ? ((pagination as Record<string, unknown>)['count'] as number)
      : null;

  return { bills, totalAvailable: count };
}

/**
 * How many bills are currently before Congress, as a Fact.
 *
 * ## Tier: OFFICIAL
 *
 * congress.gov is the Library of Congress's own service and the legislative
 * record's primary publisher — there is no more primary source for a US bill
 * than this. US Government work, so no licence constraint on reuse.
 *
 * ## What the number MEANS, which is not what a reader will assume
 *
 * `pagination.count` is the number of bills MATCHING THE QUERY, across every
 * Congress the API holds — 429,656 at the time of writing. It is not "bills
 * before the current Congress" and must never be labelled as such. Rendering it
 * without that qualifier would be rule 22's aggregation-across-kinds: bills from
 * 1997 counted beside bills from this week.
 */
export function totalBillsFact(list: BillList, ctx: FetchContext): Fact<number> {
  return {
    value: list.totalAvailable,
    // The API states no as-of for the count; the fetch time is the only honest
    // stamp, and it is the fetch that the number is true of.
    asOf: ctx.fetchedAt.slice(0, 10),
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, { pagination: { count: list.totalAvailable } }, 'pagination.count'),
    note: 'Every bill the API holds across all Congresses, not only the current one.',
    format: (value: number) => value.toLocaleString('en-US'),
  };
}
