import type { Fact } from '../facts/types';
import {
  expectArray,
  expectNumber,
  expectObject,
  expectString,
  fetchProvenance,
  ShapeError,
  type FetchContext,
} from './adapter';

const SOURCE_ID = 'cisa-kev';

/**
 * The cisagov mirror, never cisa.gov directly.
 *
 * Direct fetches of the catalogue from cisa.gov have been rate-limited and
 * IP-blocked; the GitHub mirror is the registered origin and the one the probe
 * verdict describes. `develop` is the repository's default branch and the one it
 * publishes from — a pinned commit would be reproducible and permanently stale,
 * which is the wrong trade for a catalogue whose value is that it is current.
 */
const CATALOG =
  'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json';

/**
 * CISA records ransomware association as three-valued, and the third value is
 * the reason this is not a boolean.
 *
 * `"Known"` means CISA has seen it used in a ransomware campaign. `"Unknown"`
 * means **CISA does not know** — not that it is unused. 1,316 of 1,665 entries
 * are `Unknown`, so a `=== 'Known'` coercion would have the app assert that
 * 1,316 vulnerabilities are not used by ransomware, which CISA has never said.
 *
 * Rule 30, for the third time in this source family: no answer is not an answer
 * of no.
 */
export type RansomwareUse = 'known' | 'unknown';

export interface KevEntry {
  cveId: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: Fact<string>;
  dueDate: Fact<string>;
  ransomwareUse: Fact<RansomwareUse>;
}

export interface KevCatalog {
  title: string;
  /** CISA's own catalogue version, e.g. `2026.08.14`. */
  version: string;
  released: string;
  /** The count CISA publishes, which the parser checks against what it received. */
  count: Fact<number>;
  entries: KevEntry[];
}

/** Exported so the fixture derives its URL from the app's own request (rule 26). */
export function buildCatalogUrl(): string {
  return CATALOG;
}

/**
 * `"Known"` / `"Unknown"` in, a modelled three-state out.
 *
 * Anything unrecognised becomes `unknown` rather than `known`: if CISA adds a
 * value this parser has not seen, the safe reading is that we do not know, not
 * that we have evidence.
 */
export function readRansomwareUse(raw: unknown): RansomwareUse {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'known' ? 'known' : 'unknown';
}

export function parse(raw: unknown, ctx: FetchContext, sourceId = SOURCE_ID): KevCatalog {
  const root = expectObject(sourceId, raw, 'root');
  const rows = expectArray(sourceId, root['vulnerabilities'], 'vulnerabilities');

  const title = expectString(sourceId, root['title'], 'title');
  const version = expectString(sourceId, root['catalogVersion'], 'catalogVersion');
  const released = expectString(sourceId, root['dateReleased'], 'dateReleased');
  const declared = expectNumber(sourceId, root['count'], 'count');

  /**
   * The catalogue states its own size, so a mismatch is shape drift rather than
   * a judgement call — a truncated download, a paginated response nobody
   * noticed, or a field re-pointed. Checking it costs nothing and is the kind of
   * self-description most sources do not offer (rule 28).
   */
  if (declared !== rows.length) {
    throw new ShapeError(
      sourceId,
      `count says ${declared} but ${rows.length} vulnerabilities were returned`,
    );
  }

  /** The catalogue's release date is the as-of for everything in it. */
  const asOf = released.slice(0, 10);

  const entries = rows.map((row, index) => {
    const at = `vulnerabilities[${index}]`;
    const record = expectObject(sourceId, row, at);
    const dateAdded = expectString(sourceId, record['dateAdded'], `${at}.dateAdded`);

    return {
      cveId: expectString(sourceId, record['cveID'], `${at}.cveID`),
      vendorProject: expectString(sourceId, record['vendorProject'], `${at}.vendorProject`),
      product: expectString(sourceId, record['product'], `${at}.product`),
      vulnerabilityName: expectString(sourceId, record['vulnerabilityName'], `${at}.vulnerabilityName`),
      dateAdded: {
        value: dateAdded,
        asOf: dateAdded,
        tier: 'OFFICIAL' as const,
        provenance: fetchProvenance(sourceId, ctx, raw, `${at}.dateAdded`),
      },
      dueDate: {
        value: expectString(sourceId, record['dueDate'], `${at}.dueDate`),
        asOf: dateAdded,
        tier: 'OFFICIAL' as const,
        provenance: fetchProvenance(sourceId, ctx, raw, `${at}.dueDate`),
      },
      ransomwareUse: {
        value: readRansomwareUse(record['knownRansomwareCampaignUse']),
        asOf: dateAdded,
        tier: 'OFFICIAL' as const,
        provenance: fetchProvenance(sourceId, ctx, raw, `${at}.knownRansomwareCampaignUse`),
        // Rendered wherever the value is, so "unknown" never reads as "no".
        note: 'CISA records ransomware association as Known or Unknown. Unknown means CISA has no evidence either way, not that the vulnerability is unused by ransomware.',
      },
    };
  });

  return {
    title,
    version,
    released,
    count: {
      value: declared,
      asOf,
      tier: 'OFFICIAL',
      provenance: fetchProvenance(sourceId, ctx, raw, 'count'),
    },
    entries,
  };
}

/**
 * NO COUNTRY DIMENSION EXISTS IN THIS CATALOGUE, and none is inferred.
 *
 * KEV lists vulnerabilities, not victims or jurisdictions. Attributing an entry
 * to a country — by vendor headquarters, by where exploitation was observed, by
 * anything — would be this app inventing a fact CISA did not publish. The
 * catalogue is a global figure and renders as one.
 */
export function isGlobalOnly(): true {
  return true;
}
