import entities from '../../data/wikidata-entities.json';
import { ShapeError } from './adapter';
import { parse as parseSparql } from './wikidata';

const SOURCE_ID = 'wikidata-sparql';
const ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * How deep the ministerial subclass walk goes — FOUR hops, measured.
 *
 * ## Why this is bounded at all
 *
 * `wdt:P279*` is unbounded, and it was the cabinet query's entire cost: measured
 * 2026-08-15, the country-anchored UNION branch runs in 1.4s while the branch
 * carrying the closure takes 24s, and the whole query 504s for the United
 * Kingdom at 65s. Bounding the walk made Iceland 21× faster with an identical
 * row set and turned that 504 into a 200.
 *
 * ## Why FOUR and not three
 *
 * Three was the first candidate, and it looked convincing — identical rows for
 * Iceland and Tuvalu, and it rescued the United Kingdom. Then the depth was
 * measured directly:
 *
 *   country   d1  d≤2  d≤3  d≤4  d≤5
 *   ISL        9   26   26   26   26
 *   TUV       15   17   17   17   17
 *   GBR       25   88  194  195  195   ← one position at exactly four hops
 *   IND       36   55   55   55   55
 *   FRA       57   93  105  105  105
 *   USA        7   25   25   25   25
 *
 * **A three-hop bound returns 194 of the United Kingdom's 195 positions.** One
 * missing minister, no error, entirely plausible output — which is the failure
 * this whole file is careful about, arriving at subclass depth.
 *
 * ## What this bound is, honestly
 *
 * Every country measured has `d≤4 == d≤5`, so four is sufficient for all six.
 * **That is a measurement over six countries, not a proof over 190.** The bound
 * is a choice with a known blast radius, and `tests/wdqs-budget.test.ts` compares
 * four hops against five under `PROBE_LIVE` so the day a fifth hop appears it is
 * a reported failure rather than a quietly missing row.
 */
export const MINISTER_SUBCLASS_HOPS = 4;

export const MINISTER_SUBCLASS_PATH = 'wdt:P279/wdt:P279?/wdt:P279?/wdt:P279?';

interface EntityTable {
  entities: Record<string, { qid: string; expectedLabel: string; verified: boolean }>;
}
const ENTITIES = (entities as unknown as EntityTable).entities;

function qid(name: string): string {
  const entry = ENTITIES[name];
  if (!entry) throw new Error(`no entity registered under "${name}" in data/wikidata-entities.json`);
  return entry.qid;
}

function assertIso3(iso3: string): void {
  if (!/^[A-Z]{3}$/.test(iso3)) throw new Error(`expected an ISO 3166-1 alpha-3 code, got ${iso3}`);
}

export function queryUrl(query: string): string {
  return `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
}

/* ------------------------------------------------------------------ cabinet */

/**
 * Ministerial positions and their current holders.
 *
 * Two paths are UNIONed because Wikidata models cabinets inconsistently: some
 * countries link an executive body (P208) whose parts are the ministries, others
 * only mark each position with the jurisdiction it applies to (P1001). Taking
 * both costs one extra clause and avoids a country rendering an empty cabinet
 * purely because of how it happens to be modelled.
 *
 * If the `minister` Q-id is wrong the second path yields nothing, so the failure
 * is missing rows rather than another country's ministries.
 */
export function buildCabinetQuery(iso3: string): string {
  assertIso3(iso3);
  return `SELECT DISTINCT ?position ?positionLabel ?positionDescription ?holder ?holderLabel ?holderImage ?since
WHERE {
  ?country wdt:P298 "${iso3}" .
  {
    ?country wdt:P208 ?cabinet .
    ?position wdt:P361 ?cabinet .
  } UNION {
    ?position wdt:P1001 ?country .
    ?position ${MINISTER_SUBCLASS_PATH} wd:${qid('minister')} .
  }
  OPTIONAL {
    ?position p:P1308 ?statement .
    ?statement ps:P1308 ?holder .
    FILTER NOT EXISTS { ?statement pq:P582 ?ended . }
    OPTIONAL { ?statement pq:P580 ?since . }
    OPTIONAL { ?holder wdt:P18 ?holderImage . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 300`;
}

export interface Ministry {
  positionQid: string;
  /** May be a bare Q-id when no English label exists. See `untranslated`. */
  label: string;
  /** True when the label service returned the Q-id rather than a name. */
  untranslated: boolean;
  /**
   * Wikidata's own short description. This is the "plain-English line on what
   * this ministry does" — sourced, never written by this app. Null is common
   * and renders as an explicit absence.
   */
  description: string | null;
  holder: { qid: string; name: string; imageUrl: string | null; since: string | null } | null;
}

export interface Cabinet {
  ministries: Ministry[];
  /** Positions with no current officeholder recorded. */
  vacantCount: number;
  /** Positions whose label came back as a bare Q-id. */
  untranslatedCount: number;
}

const QID_ONLY = /^Q\d+$/;

function tail(uri: string | undefined): string {
  if (!uri) return '';
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? '';
}

export function parseCabinet(raw: unknown, sourceId = SOURCE_ID): Cabinet {
  const result = parseSparql(raw, sourceId);

  // One row per position per holder. Collapse by position: a position with two
  // open holder statements is a data problem, and taking the first with a
  // warning beats rendering the same ministry twice.
  const byPosition = new Map<string, Ministry>();

  for (const row of result.rows) {
    const positionUri = row['position'];
    if (!positionUri) continue;
    const positionQid = tail(positionUri);
    if (byPosition.has(positionQid) && byPosition.get(positionQid)?.holder) continue;

    const label = row['positionLabel'] ?? positionQid;
    const holderUri = row['holder'];

    byPosition.set(positionQid, {
      positionQid,
      label,
      untranslated: QID_ONLY.test(label),
      description: row['positionDescription'] ?? null,
      holder: holderUri
        ? {
            qid: tail(holderUri),
            name: row['holderLabel'] ?? tail(holderUri),
            imageUrl: row['holderImage'] ?? null,
            since: row['since'] ?? null,
          }
        : null,
    });
  }

  const ministries = [...byPosition.values()].sort((a, b) => a.label.localeCompare(b.label));

  return {
    ministries,
    vacantCount: ministries.filter((ministry) => ministry.holder === null).length,
    untranslatedCount: ministries.filter((ministry) => ministry.untranslated).length,
  };
}

/* ------------------------------------------------------------- legislature */

/**
 * ## This query used to be broken in a way that read as slowness
 *
 * It was recorded as "never completes against live WDQS" — HTTP 504 for GBR,
 * 500 after 60.6s for Iceland, 504 after 65.5s for Vatican City, a country with
 * one legislative body. The diagnosis was that it timed out. The cause was a
 * SPARQL scoping bug that ALSO produced wrong answers:
 *
 * ```
 * { BIND(?body AS ?chamber) } UNION { ?body wdt:P527 ?chamber . }
 * ```
 *
 * `BIND` in a group of its own does not see `?body` — that variable belongs to
 * the enclosing group, not to the UNION branch — so `?chamber` came out
 * **unbound** on the first branch. The `OPTIONAL { ?chamber wdt:P1342 ?seats }`
 * below it then matched **every entity in Wikidata with a seat count**. That is
 * the timeout, and it is also why a query for the United Kingdom returned Swiss
 * cantons and South Australian electoral districts.
 *
 * Two fixes, each measured:
 *
 *   `wdt:P527?` — a property path stays in one scope, so `?chamber` binds to the
 *   body itself or to its parts, which is what the UNION was reaching for.
 *   GBR: 504 → 5.6s.
 *
 *   the chamber-type constraint — the path alone still returns whatever
 *   Wikidata lists as a part, which includes the Monarch, "Member of the
 *   Althing", and the chauffeur service of the German Bundestag. Constraining to
 *   legislative types drops them. GBR: 5.6s → 4.7s, and the rows become correct.
 *
 * Measured after: GBR 4.7s (Parliament 1433, Lords 808, Commons 650), DEU 2.7s
 * (Bundestag, Bundesrat), ISL 4.3s (Althing), VAT 3.2s, TUV 4.8s. Every country
 * that previously failed now returns, and `parseLegislature` reads all of them
 * unchanged.
 *
 * Rule 31 applied before treating it as one bug: the other BIND-inside-UNION
 * site, `buildLeadershipTimelineQuery`, binds CONSTANTS in branches that bind
 * their own variables, so it is unaffected. One site, checked rather than
 * assumed.
 */
export function buildLegislatureQuery(iso3: string): string {
  assertIso3(iso3);
  return `SELECT DISTINCT ?chamber ?chamberLabel ?seats ?party ?partyLabel ?partySeats
WHERE {
  ?country wdt:P298 "${iso3}" .
  ?country wdt:P194 ?body .
  ?body wdt:P527? ?chamber .
  VALUES ?chamberType { wd:Q35749 wd:Q10553309 wd:Q375928 wd:Q637846 }
  ?chamber wdt:P31/wdt:P279* ?chamberType .
  OPTIONAL { ?chamber wdt:P1342 ?seats . }
  OPTIONAL {
    ?chamber p:P527 ?partyStatement .
    ?partyStatement ps:P527 ?party .
    OPTIONAL { ?partyStatement pq:P1410 ?partySeats . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 200`;
}

export interface PartySeats {
  name: string;
  seats: number | null;
}

export interface Chamber {
  qid: string;
  label: string;
  seats: number | null;
  parties: PartySeats[];
}

export function parseLegislature(raw: unknown, sourceId = SOURCE_ID): Chamber[] {
  const result = parseSparql(raw, sourceId);
  const byChamber = new Map<string, Chamber>();

  for (const row of result.rows) {
    const chamberUri = row['chamber'];
    if (!chamberUri) continue;
    const chamberQid = tail(chamberUri);

    let chamber = byChamber.get(chamberQid);
    if (!chamber) {
      const seatsRaw = row['seats'];
      const seats = seatsRaw === undefined ? null : Number.parseInt(seatsRaw, 10);
      if (seats !== null && !Number.isFinite(seats)) {
        throw new ShapeError(sourceId, `chamber ${chamberQid} has a non-numeric P1342 ${JSON.stringify(seatsRaw)}`);
      }
      chamber = { qid: chamberQid, label: row['chamberLabel'] ?? chamberQid, seats, parties: [] };
      byChamber.set(chamberQid, chamber);
    }

    const partyLabel = row['partyLabel'];
    if (partyLabel && !chamber.parties.some((party) => party.name === partyLabel)) {
      const raw = row['partySeats'];
      const seats = raw === undefined ? null : Number.parseInt(raw, 10);
      chamber.parties.push({ name: partyLabel, seats: seats !== null && Number.isFinite(seats) ? seats : null });
    }
  }

  // Largest party first; unknown seat counts last rather than treated as zero.
  for (const chamber of byChamber.values()) {
    chamber.parties.sort((a, b) => (b.seats ?? -1) - (a.seats ?? -1) || a.name.localeCompare(b.name));
  }

  return [...byChamber.values()];
}

/**
 * Do the recorded party seats account for the chamber?
 *
 * A stacked bar built from partial data reads as a complete picture of a
 * legislature, which is a confident falsehood in the most trusted format there
 * is. The bar is only drawn when this returns true.
 */
export function partyBreakdownIsComplete(chamber: Chamber): boolean {
  if (chamber.seats === null || chamber.parties.length === 0) return false;
  if (chamber.parties.some((party) => party.seats === null)) return false;
  const total = chamber.parties.reduce((sum, party) => sum + (party.seats ?? 0), 0);
  return total === chamber.seats;
}

/* --------------------------------------------------------------- judiciary */

export function buildJudiciaryQuery(iso3: string): string {
  assertIso3(iso3);
  return `SELECT DISTINCT ?court ?courtLabel ?seats ?justice ?justiceLabel ?since
WHERE {
  ?country wdt:P298 "${iso3}" .
  { ?country wdt:P209 ?court . }
  UNION
  { ?court wdt:P1001 ?country ; wdt:P31/wdt:P279* wd:${qid('courtOfLastResort')} . }
  OPTIONAL { ?court wdt:P1342 ?seats . }
  OPTIONAL {
    ?court p:P1308 ?statement .
    ?statement ps:P1308 ?justice .
    FILTER NOT EXISTS { ?statement pq:P582 ?ended . }
    OPTIONAL { ?statement pq:P580 ?since . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 20`;
}

export interface Judiciary {
  qid: string;
  label: string;
  seats: number | null;
  chiefJustice: { qid: string; name: string; since: string | null } | null;
}

export function parseJudiciary(raw: unknown, sourceId = SOURCE_ID): Judiciary | null {
  const result = parseSparql(raw, sourceId);
  const row = result.rows[0];
  if (!row || !row['court']) return null;

  const seatsRaw = row['seats'];
  const seats = seatsRaw === undefined ? null : Number.parseInt(seatsRaw, 10);

  return {
    qid: tail(row['court']),
    label: row['courtLabel'] ?? tail(row['court']),
    seats: seats !== null && Number.isFinite(seats) ? seats : null,
    chiefJustice: row['justice']
      ? { qid: tail(row['justice']), name: row['justiceLabel'] ?? '', since: row['since'] ?? null }
      : null,
  };
}

/* ---------------------------------------------------- leadership timeline */

/**
 * Every head-of-state and head-of-government term, including ended ones.
 *
 * Deliberately the same statement path as the dossier query WITHOUT the
 * open-term filter — the whole point here is the terms that ended.
 */
export function buildLeadershipTimelineQuery(iso3: string): string {
  assertIso3(iso3);
  return `SELECT ?office ?person ?personLabel ?start ?end
WHERE {
  ?country wdt:P298 "${iso3}" .
  {
    ?country p:P35 ?statement .
    ?statement ps:P35 ?person .
    BIND("head-of-state" AS ?office)
  } UNION {
    ?country p:P6 ?statement .
    ?statement ps:P6 ?person .
    BIND("head-of-government" AS ?office)
  }
  OPTIONAL { ?statement pq:P580 ?start . }
  OPTIONAL { ?statement pq:P582 ?end . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 200`;
}

export type OfficeKind = 'head-of-state' | 'head-of-government';

export interface Term {
  office: OfficeKind;
  personQid: string;
  personName: string;
  start: string | null;
  end: string | null;
}

export function parseLeadershipTimeline(raw: unknown, sourceId = SOURCE_ID): Term[] {
  const result = parseSparql(raw, sourceId);
  const terms: Term[] = [];

  for (const row of result.rows) {
    const personUri = row['person'];
    const office = row['office'];
    if (!personUri || (office !== 'head-of-state' && office !== 'head-of-government')) continue;
    terms.push({
      office,
      personQid: tail(personUri),
      personName: row['personLabel'] ?? tail(personUri),
      start: row['start'] ?? null,
      end: row['end'] ?? null,
    });
  }

  // Newest first. Terms with no start date sort last: an undated term cannot be
  // placed on a timeline and pretending it is the oldest would be a guess.
  return terms.sort((a, b) => {
    if (a.start === null && b.start === null) return 0;
    if (a.start === null) return 1;
    if (b.start === null) return -1;
    return b.start.localeCompare(a.start);
  });
}

/** Terms overlapping the window, for the "last 25 years" view. */
export function termsSince(terms: readonly Term[], since: Date): Term[] {
  const cutoff = since.toISOString();
  return terms.filter((term) => term.end === null || term.end >= cutoff || (term.start ?? '') >= cutoff);
}

/* ------------------------------------------------------- person office history */

export function buildPersonHistoryQuery(personQid: string): string {
  if (!/^Q\d+$/.test(personQid)) throw new Error(`expected a Wikidata Q-id, got ${personQid}`);
  return `SELECT ?position ?positionLabel ?start ?end ?replaces ?replacesLabel ?replacedBy ?replacedByLabel
WHERE {
  OPTIONAL {
    wd:${personQid} p:P39 ?statement .
    ?statement ps:P39 ?position .
    OPTIONAL { ?statement pq:P580 ?start . }
    OPTIONAL { ?statement pq:P582 ?end . }
    OPTIONAL { ?statement pq:P1365 ?replaces . }
    OPTIONAL { ?statement pq:P1366 ?replacedBy . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 100`;
}

export interface HeldPosition {
  label: string;
  start: string | null;
  end: string | null;
  replaces: string | null;
  replacedBy: string | null;
}

export function parsePersonHistory(raw: unknown, sourceId = SOURCE_ID): HeldPosition[] {
  const result = parseSparql(raw, sourceId);
  const positions: HeldPosition[] = [];

  for (const row of result.rows) {
    if (!row['position']) continue;
    positions.push({
      label: row['positionLabel'] ?? tail(row['position']),
      start: row['start'] ?? null,
      end: row['end'] ?? null,
      replaces: row['replacesLabel'] ?? null,
      replacedBy: row['replacedByLabel'] ?? null,
    });
  }

  return positions.sort((a, b) => {
    if (a.start === null && b.start === null) return 0;
    if (a.start === null) return 1;
    if (b.start === null) return -1;
    return b.start.localeCompare(a.start);
  });
}
