import type { Fact } from '../facts/types';
import {
  expectArray,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'who-don';

const SERVICE = 'https://www.who.int/api/news/diseaseoutbreaknews';

/**
 * Only the fields we render are requested.
 *
 * The API returns the full body of each report — `Overview`, `Epidemiology`,
 * `Assessment`, `Advice` — and we render none of it. Asking for it anyway would
 * pull WHO's full text across the network to throw away, which is both wasteful
 * and the wrong posture for a CC BY-NC-SA source: the licence is satisfied by
 * headline, date, link and credit, so those are what we fetch.
 */
const FIELDS = ['Id', 'DonId', 'Title', 'PublicationDateAndTime', 'ItemDefaultUrl'] as const;

export interface OutbreakReport {
  id: string;
  /** WHO's own headline. Never rewritten, never summarised. */
  title: Fact<string>;
  published: Fact<string>;
  /** Absolute link back to WHO, which the licence requires. */
  url: string;
}

export interface DonQuery {
  /** How many of the most recent reports to request. */
  count: number;
}

/**
 * The app's own request construction, exported so the fixture derives its URL
 * from here rather than repeating it (rule 26).
 *
 * Ordered explicitly. The unordered default returns a page whose newest entry
 * was eighteen months old while the true newest was published that morning — an
 * ordering assumption would have shipped a "latest outbreaks" panel showing
 * nothing of the sort.
 */
export function buildDonQueryUrl(query: DonQuery): string {
  const params = new URLSearchParams({
    $orderby: 'PublicationDateAndTime desc',
    $top: String(query.count),
    $select: FIELDS.join(','),
  });

  return `${SERVICE}?${params.toString()}`;
}

/** WHO publishes DON links relative to its own root. */
function absoluteUrl(itemDefaultUrl: string): string {
  const path = itemDefaultUrl.startsWith('/') ? itemDefaultUrl : `/${itemDefaultUrl}`;
  return `https://www.who.int/emergencies/disease-outbreak-news${path}`;
}

/**
 * NO COUNTRY IS EXTRACTED FROM A DON, AND THAT IS DELIBERATE.
 *
 * The payload carries no structured country field. Titles read like
 * "Nipah virus disease - India" and "Hantavirus outbreak linked to cruise ship
 * travel, Multi-locations", so a country could only be obtained by parsing prose
 * — with separators that vary, multi-country entries, and entries that name no
 * country at all.
 *
 * Attaching a parsed country to an outbreak report and rendering it in a
 * country's dossier would assert a link WHO did not publish. That is the
 * false-fact failure this project stops for, and "Multi-locations" is the case
 * that proves parsing cannot be made safe by being careful.
 *
 * If per-country outbreak news is wanted, it needs a source that publishes the
 * association, or a derivation whose arithmetic is visible and whose confidence
 * is `DERIVED` — not a regular expression pretending to be a fact.
 */
export function parse(raw: unknown, ctx: FetchContext, sourceId = SOURCE_ID): OutbreakReport[] {
  const root = expectObject(sourceId, raw, 'root');
  const rows = expectArray(sourceId, root['value'], 'value');

  return rows.map((row, index) => {
    const at = `value[${index}]`;
    const record = expectObject(sourceId, row, at);

    const id = expectString(sourceId, record['Id'], `${at}.Id`);
    const title = expectString(sourceId, record['Title'], `${at}.Title`);
    const published = expectString(sourceId, record['PublicationDateAndTime'], `${at}.PublicationDateAndTime`);
    const itemUrl = expectString(sourceId, record['ItemDefaultUrl'], `${at}.ItemDefaultUrl`);

    if (Number.isNaN(Date.parse(published))) {
      throw new ShapeError(sourceId, `${at}.PublicationDateAndTime is not a date: ${JSON.stringify(published)}`);
    }

    /** The date the report refers to, trimmed to a day — rule 4's "as of". */
    const asOf = published.slice(0, 10);

    return {
      id,
      title: {
        value: title,
        asOf,
        tier: 'OFFICIAL',
        provenance: fetchProvenance(sourceId, ctx, raw, `${at}.Title`),
      },
      published: {
        value: published,
        asOf,
        tier: 'OFFICIAL',
        provenance: fetchProvenance(sourceId, ctx, raw, `${at}.PublicationDateAndTime`),
      },
      url: absoluteUrl(itemUrl),
    };
  });
}
