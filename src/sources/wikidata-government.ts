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

/**
 * The chamber-type walk, bounded on its own measurement.
 *
 * The legislature query carried the same unbounded `wdt:P279*` that cost the
 * cabinet query 24 of its 52 seconds. It was not failing when this was written —
 * it completed in 734–2347ms — which is exactly why it needed bounding: it
 * carried the known-expensive clause and was simply not paying for it that day.
 *
 * **This path allows ZERO hops**, unlike the ministerial one. Some chambers are
 * direct instances of a chamber type, and a bound derived from the exact-depth
 * table would have excluded them — an off-by-one that drops real chambers.
 * Verified against the unbounded form rather than derived:
 *
 *   country  unbounded  bounded 0–2  identical
 *   VAT      1          1            yes
 *   ISL      1          1            yes
 *   GBR      3          3            yes
 *   IND      3          3            yes
 *   USA      3          3            yes
 *   DEU      2          2            yes
 *
 * Six countries, every chamber accounted for, and `tests/wdqs-budget.test.ts`
 * compares this bound against one hop deeper under `PROBE_LIVE` — so a
 * seven-hop chamber somewhere is a reported failure rather than a missing house
 * of parliament.
 */
export const CHAMBER_TYPE_HOPS = 2;

export const CHAMBER_TYPE_PATH = 'wdt:P31/wdt:P279?/wdt:P279?';

/**
 * The court walk — the third `wdt:P279*`, and the one that was paying for
 * nothing.
 *
 * The judiciary query's fallback branch cited `Q1513611`, recorded in the entity
 * table with `"verified": false`. That QID is **"Supreme Court of Ghana" — a
 * specific court, not a class**, with zero instances anywhere in Wikidata. The
 * branch could never match for any country, and it carried an unbounded closure
 * to do it: 6724ms for the United Kingdom, spent on a guaranteed empty result.
 *
 * The class is now `Q190752` ("supreme court", 272 instances, used by 99
 * countries' P209 courts), and the walk is bounded on its own measurement:
 *
 *   country  unbounded  0 hops  0–1  0–2  0–3
 *   VAT      1          1       1    1    1
 *   ISL      1          1       —    1    1
 *   GBR      2          2       2    2    2
 *   IND      1          1       1    1    1
 *   USA      1          1       1    1    1
 *   FRA      3          3       3    3    3
 *
 * **Zero hops suffices** — courts are direct instances — so this allows one, as
 * margin that costs nothing measurable.
 *
 * And Vatican City now returns 1, which is the whole point: its `P209` is empty,
 * and that is precisely the case the fallback exists to cover.
 */
export const COURT_CLASS_HOPS = 1;

export const COURT_CLASS_PATH = 'wdt:P31/wdt:P279?';

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
  /**
   * The query returned exactly `LIMIT` rows, so the result is TRUNCATED and the
   * true count is unknown.
   *
   * ## Why this field exists
   *
   * Measured 2026-08-15, immediately after the timeout fix: the United Kingdom
   * returns **exactly 300 rows against `LIMIT 300`**. Its cabinet is being cut
   * off, and nothing said so — 300 ministries is a plausible number, there is no
   * error, and the true figure is simply unavailable.
   *
   * **This truncation is older than the fix and was invisible because of it.**
   * The query used to 504 for the United Kingdom, so it never returned rows to
   * be truncated. Repairing the timeout did not create this; it revealed it.
   *
   * A caller that renders a cabinet MUST say the list is incomplete when this is
   * true. Rendering 300 ministries as though they were all of them is the
   * party-bar bug: right units, plausible magnitude, silently wrong.
   */
  truncated: boolean;
}

/**
 * The row cap in `buildCabinetQuery`, exported so the parser can detect
 * saturation rather than hard-coding the number in two places that could drift.
 */
export const CABINET_ROW_LIMIT = 300;

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
    /**
     * SATURATION IS MEASURED ON RAW ROWS, NOT ON MINISTRIES.
     *
     * `ministries` is the collapsed view — one entry per position, several rows
     * per position when a position has multiple holder statements. So a
     * truncated 300-row response can collapse to far fewer ministries and look
     * unremarkable. The cap applies to rows, so the check must too.
     */
    truncated: result.rows.length >= CABINET_ROW_LIMIT,
  };
}

/* ------------------------------------------------------------- legislature */

/**
 * The types that make something a chamber — declared ONCE, because the guard
 * below needs the same list and two copies of it would drift.
 *
 * `Q35749` is "parliament", which is a whole legislature rather than a chamber
 * of one. It has to stay in the list: for a unicameral country Wikidata models
 * the body itself as the chamber, and Iceland, China, Libya and Vatican City
 * are reachable by no other route. Its presence is exactly what makes
 * `CHAMBER_PARENT_GUARD` necessary.
 */
const CHAMBER_TYPE_QIDS = ['Q35749', 'Q10553309', 'Q375928', 'Q637846'] as const;

export const CHAMBER_TYPE_VALUES = CHAMBER_TYPE_QIDS.map((qid) => `wd:${qid}`).join(' ');

/**
 * ## A parliament is not a chamber of itself
 *
 * `?body wdt:P527? ?chamber` is a ZERO-or-one hop, so `?chamber` can bind to
 * `?body`. Combined with "parliament" in the type list above, a parent body
 * satisfies the filter meant to identify its children, and comes back as their
 * peer.
 *
 * Measured before the fix:
 *
 * ```
 * GBR   House of Commons                   650
 *       House of Lords                     808
 *       Parliament of the United Kingdom  1433   <- the other two, added up
 *
 * NZL   New Zealand Parliament             120
 *       House of Representatives           120   <- the SAME 120 seats, twice
 * ```
 *
 * ### The two obvious repairs are both silently destructive
 *
 * Chambers returned per country, measured in one sitting:
 *
 * ```
 * iso   current   require a real P527 hop   drop "parliament"   THIS GUARD
 * GBR      3                2                      2                2
 * NZL      2                1                      0                1
 * DEU      2                0                      2                2
 * ISL      1                0                      0                1
 * CHN      1            inconclusive               0                1
 * LBY      1                0                      0                1
 * VAT      1                0                      0                1
 * ```
 *
 * **Germany is the case that was not on anyone's list**: its two chambers are
 * each a separate `P194` of the country rather than children of one parent, so
 * requiring a hop returns zero chambers for a G7 legislature. Dropping
 * "parliament" loses every unicameral country instead.
 *
 * So the rule is relational rather than structural: **keep a body only when no
 * child of it is itself a chamber.** A parent with chamber children is a
 * container and is dropped; a body with none IS the chamber and is kept.
 */
const CHAMBER_PARENT_GUARD = `  FILTER NOT EXISTS {
    ?chamber wdt:P527 ?child .
    ?child ${CHAMBER_TYPE_PATH} ?childType .
    FILTER(?childType IN (${CHAMBER_TYPE_QIDS.map((qid) => `wd:${qid}`).join(', ')}))
  }`;

/**
 * ## P527 is "has part(s)", and a chamber's parts are not its parties
 *
 * The party clause read P527 and called whatever came back a party. What comes
 * back, measured across eight countries:
 *
 * ```
 * GBR   Monarch of the United Kingdom · House of Lords · House of Commons
 * DEU   Member of the Bundesrat · Bundesrat Library · Enquete Commission · Q132798745
 * ISL   Member of the Althing
 * FRA   Finance Committee · European Affairs Committee · Q59709026
 * ESP   member of the Senate of Spain
 * SWE   member of the Swedish Riksdag
 * ```
 *
 * **Not one political party in any of them** — committees, libraries, offices,
 * and bare Q-ids. Constraining `?party` to actually be a political party
 * returns **zero rows for every country tried**, which is the honest answer:
 * chambers do not record their composition through P527.
 *
 * ### Why constrain rather than remove
 *
 * Zero parties renders "Wikidata records no party composition for this
 * chamber", which is true. The unconstrained clause would render the Bundesrat
 * Library as a parliamentary party the moment the panel goes live — a wrong
 * value with confident provenance, which is the failure this project exists to
 * prevent.
 *
 * A real sourcing route is a decision rather than a fix, and it is queued as
 * OPEN-QUESTIONS 30 with the two candidates measured. Until it is answered the
 * feature reports its own absence instead of inventing content.
 *
 * ### The bound here is required, and it is honestly untested
 *
 * Written first as `wdt:P31/wdt:P279*` and caught immediately by the budget
 * guard, which forbids the unbounded closure in any shipped query — the guard
 * doing exactly its job on its author, one commit after being written.
 *
 * The bounded and unbounded forms return the same thing today, because both
 * return **nothing**. So this bound has never been exercised against data that
 * reaches it, and that is stated rather than glossed: when question 30 is
 * answered and parties actually arrive, the depth needs measuring the way the
 * ministerial walk's four hops were measured, not assuming.
 */
const PARTY_TYPE_PATH = 'wdt:P31/wdt:P279?/wdt:P279?';

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
 * Measured after: GBR 4.7s, DEU 2.7s (Bundestag, Bundesrat), ISL 4.3s
 * (Althing), VAT 3.2s, TUV 4.8s. Every country that previously failed now
 * returns, and `parseLegislature` reads all of them unchanged.
 *
 * **That GBR line used to read "(Parliament 1433, Lords 808, Commons 650)" and
 * called it correct.** See `CHAMBER_PARENT_GUARD` below: 1433 is the other two
 * added together, and the parent body was being returned as a chamber of
 * itself. The timing was right and the rows were wrong, recorded as a success
 * in three places at once — this comment, the contract test's expected count,
 * and the captured fixture.
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
  VALUES ?chamberType { ${CHAMBER_TYPE_VALUES} }
  ?chamber ${CHAMBER_TYPE_PATH} ?chamberType .
${CHAMBER_PARENT_GUARD}
  OPTIONAL { ?chamber wdt:P1342 ?seats . }
  OPTIONAL {
    ?chamber p:P527 ?partyStatement .
    ?partyStatement ps:P527 ?party .
    ?party ${PARTY_TYPE_PATH} wd:${qid('politicalParty')} .
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
  { ?court wdt:P1001 ?country ; ${COURT_CLASS_PATH} wd:${qid('courtOfLastResort')} . }
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
