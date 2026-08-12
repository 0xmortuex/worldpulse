import { expectObject, fetchProvenance, ShapeError, type FetchContext } from './adapter';
import { parse as parseSparql, type SparqlResult } from './wikidata';
import type { Fact } from '../facts/types';

const SOURCE_ID = 'wikidata-sparql';
const ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Dossier-header query.
 *
 * Statements are read through the p:/ps:/pq: path rather than wdt: so that
 * open-ended office terms can be distinguished from ended ones — `wdt:P35`
 * would happily hand back a former head of state. Every statement here is
 * filtered to those with no end date (P582).
 *
 * `optionalAuthorityOffice` supports rule 1: where a reviewed override says a
 * de facto authority sits above the formal head of state, its office Q-id is
 * injected and the holder fetched via P1308 (officeholder).
 *
 * NOT YET RUN AGAINST THE LIVE ENDPOINT. Built from the Wikidata Query Service
 * documentation; `verifiedAgainst` for this source is "documentation".
 */
export function buildCountryQuery(iso3: string, optionalAuthorityOffice?: string): string {
  if (!/^[A-Z]{3}$/.test(iso3)) throw new Error(`buildCountryQuery expects an ISO 3166-1 alpha-3 code, got ${iso3}`);

  const authorityBlock = optionalAuthorityOffice
    ? `
  OPTIONAL {
    wd:${optionalAuthorityOffice} wdt:P1308 ?authority .
    OPTIONAL { ?authority wdt:P18 ?authorityImage . }
    OPTIONAL { ?authority wdt:P569 ?authorityBirth . }
    OPTIONAL { ?authority wdt:P102 ?authorityParty . }
    BIND(wd:${optionalAuthorityOffice} AS ?authorityOffice)
  }`
    : '';

  return `SELECT ?country ?countryLabel ?officialName ?capitalLabel ?population ?flag
       ?form ?formLabel
       ?hos ?hosLabel ?hosImage ?hosBirth ?hosPartyLabel ?hosOfficeLabel ?hosSince ?hosIsHuman
       ?hog ?hogLabel ?hogImage ?hogBirth ?hogPartyLabel ?hogOfficeLabel ?hogSince
       ?authority ?authorityLabel ?authorityImage ?authorityBirth ?authorityPartyLabel ?authorityOfficeLabel
WHERE {
  ?country wdt:P298 "${iso3}" .
  OPTIONAL { ?country wdt:P1448 ?officialName . }
  OPTIONAL { ?country wdt:P36 ?capital . }
  OPTIONAL { ?country wdt:P1082 ?population . }
  OPTIONAL { ?country wdt:P41 ?flag . }
  OPTIONAL { ?country wdt:P122 ?form . }

  OPTIONAL {
    ?country p:P35 ?hosStatement .
    ?hosStatement ps:P35 ?hos .
    FILTER NOT EXISTS { ?hosStatement pq:P582 ?hosEnded . }
    OPTIONAL { ?hosStatement pq:P580 ?hosSince . }
    OPTIONAL { ?hos wdt:P18 ?hosImage . }
    OPTIONAL { ?hos wdt:P569 ?hosBirth . }
    # Is the holder a PERSON? Switzerland's P35 resolves to the Swiss Federal
    # Council itself and Haiti's to the Transitional Presidential Council, and
    # the parser cannot tell a body's name from a person's. Without this the
    # header renders an institution in a portrait frame, which is a wrong value
    # rather than a missing one.
    BIND(EXISTS { ?hos wdt:P31 wd:Q5 } AS ?hosIsHuman)
    OPTIONAL { ?hos wdt:P102 ?hosParty . }
    OPTIONAL { ?country wdt:P1906 ?hosOffice . }
  }

  OPTIONAL {
    ?country p:P6 ?hogStatement .
    ?hogStatement ps:P6 ?hog .
    FILTER NOT EXISTS { ?hogStatement pq:P582 ?hogEnded . }
    OPTIONAL { ?hogStatement pq:P580 ?hogSince . }
    OPTIONAL { ?hog wdt:P18 ?hogImage . }
    OPTIONAL { ?hog wdt:P569 ?hogBirth . }
    OPTIONAL { ?hog wdt:P102 ?hogParty . }
    OPTIONAL { ?country wdt:P1313 ?hogOffice . }
  }
${authorityBlock}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 20`;
}

export function buildCountryQueryUrl(iso3: string, authorityOffice?: string): string {
  return `${ENDPOINT}?format=json&query=${encodeURIComponent(buildCountryQuery(iso3, authorityOffice))}`;
}

export interface PersonRecord {
  qid: string;
  name: string;
  /** Commons file URL from P18, or null. Never substituted with anyone else's photo. */
  imageUrl: string | null;
  birthDate: string | null;
  party: string | null;
  /** Verbatim office label. Never normalised to "President" or "Leader". */
  officeTitle: string | null;
  inOfficeSince: string | null;
}

export interface CountryDossierRecord {
  qid: string;
  name: string;
  officialName: string | null;
  capital: string | null;
  population: number | null;
  flagUrl: string | null;
  formLabel: string | null;
  headOfState: PersonRecord | null;
  headOfGovernment: PersonRecord | null;
  /**
   * How many DISTINCT people the query returned as concurrent head of state, and
   * whether the holder is a person at all.
   *
   * Both are needed because holder count alone cannot distinguish a
   * constitutionally collective head of state from a stale Wikidata statement
   * nobody closed. A survey of live data found 15 countries with more than one
   * concurrent holder, of which roughly three are genuine (San Marino, Bosnia,
   * Andorra) and twelve are unclosed records — Australia, Bulgaria, Hungary and
   * Albania among them. The resolver must therefore refuse rather than pick, and
   * only a cited expected count can license a collective rendering.
   */
  headOfStateHolderCount: number;
  headOfStateIsPerson: boolean;
  /** Only populated when a reviewed override injected an authority office. */
  authority: PersonRecord | null;
}

/** Last path segment of a Wikidata entity URI. */
function qidOf(uri: string | undefined): string {
  if (!uri) return '';
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? '';
}

function person(row: Record<string, string>, prefix: string): PersonRecord | null {
  const uri = row[prefix];
  const name = row[`${prefix}Label`];
  if (!uri || !name) return null;
  return {
    qid: qidOf(uri),
    name,
    imageUrl: row[`${prefix}Image`] ?? null,
    birthDate: row[`${prefix}Birth`] ?? null,
    party: row[`${prefix}PartyLabel`] ?? null,
    officeTitle: row[`${prefix}OfficeLabel`] ?? null,
    inOfficeSince: row[`${prefix}Since`] ?? null,
  };
}

/**
 * Collapse the result rows into one record.
 *
 * SPARQL returns a cross product, so a person with two parties yields two rows.
 * Each field takes the first row that has it, and a person is built from the
 * first row that names them — mixing fields across rows could assemble a leader
 * who does not exist.
 */
export function parseCountryDossier(raw: unknown, sourceId = SOURCE_ID): CountryDossierRecord {
  const result: SparqlResult = parseSparql(raw, sourceId);
  if (result.rows.length === 0) throw new ShapeError(sourceId, 'query returned no rows for this country');

  const first = (variable: string): string | null => {
    for (const row of result.rows) {
      const value = row[variable];
      if (value !== undefined && value !== '') return value;
    }
    return null;
  };

  const rowNaming = (prefix: string): Record<string, string> | undefined =>
    result.rows.find((row) => row[prefix] !== undefined && row[`${prefix}Label`] !== undefined);

  const countryUri = first('country');
  if (!countryUri) throw new ShapeError(sourceId, 'no ?country binding in any row');

  const populationRaw = first('population');
  const population = populationRaw === null ? null : Number.parseFloat(populationRaw);
  if (population !== null && !Number.isFinite(population)) {
    throw new ShapeError(sourceId, `?population ${JSON.stringify(populationRaw)} is not a number`);
  }

  const hosRow = rowNaming('hos');
  const hogRow = rowNaming('hog');
  const authorityRow = rowNaming('authority');

  /**
   * Count DISTINCT people, not rows. The query cross-products optional clauses,
   * so one holder with two parties yields two rows — counting rows would report
   * a collective head of state for an ordinary country.
   */
  const hosIdentities = new Set(
    result.rows
      .map((row) => row['hos'] ?? row['hosLabel'])
      .filter((value): value is string => Boolean(value)),
  );
  // Absent means the binding never came back, which is not the same as false.
  // Only an explicit "false" says Wikidata was asked and answered no.
  const hosHumanFlags = new Set(result.rows.map((row) => row['hosIsHuman']).filter(Boolean));

  return {
    headOfStateHolderCount: hosIdentities.size,
    headOfStateIsPerson: !hosHumanFlags.has('false'),
    qid: qidOf(countryUri),
    name: first('countryLabel') ?? qidOf(countryUri),
    officialName: first('officialName'),
    capital: first('capitalLabel'),
    population,
    flagUrl: first('flag'),
    formLabel: first('formLabel'),
    headOfState: hosRow ? person(hosRow, 'hos') : null,
    headOfGovernment: hogRow ? person(hogRow, 'hog') : null,
    authority: authorityRow ? person(authorityRow, 'authority') : null,
  };
}

export function populationFact(record: CountryDossierRecord, ctx: FetchContext): Fact<number> {
  return {
    value: record.population,
    asOf: 'see Wikidata statement',
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, record, 'P1082 (population)'),
    note: 'Wikidata population statements carry their own point-in-time qualifier, which this query does not yet read.',
    format: (value: number) => value.toLocaleString('en'),
  };
}

export function capitalFact(record: CountryDossierRecord, ctx: FetchContext): Fact<string> {
  return {
    value: record.capital,
    asOf: 'current',
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, record, 'P36 (capital)'),
  };
}

export function officialNameFact(record: CountryDossierRecord, ctx: FetchContext): Fact<string> {
  return {
    value: record.officialName,
    asOf: 'current',
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, record, 'P1448 (official name)'),
  };
}

/** Age in whole years. DERIVED: computed here from the date of birth. */
export function ageFact(personRecord: PersonRecord, ctx: FetchContext, today: Date): Fact<number> {
  const birth = personRecord.birthDate;
  if (!birth) {
    return {
      value: null,
      asOf: 'unknown',
      tier: 'DERIVED',
      provenance: fetchProvenance(SOURCE_ID, ctx, personRecord, 'P569 (date of birth) — absent'),
    };
  }

  const born = new Date(birth);
  if (Number.isNaN(born.getTime())) throw new ShapeError(SOURCE_ID, `P569 ${JSON.stringify(birth)} is not a date`);

  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < born.getUTCDate())) age -= 1;

  return {
    value: age,
    unit: 'years',
    asOf: today.toISOString().slice(0, 10),
    tier: 'DERIVED',
    provenance: {
      kind: 'derived',
      computedBy: 'src/sources/wikidata-dossier.ts',
      formula: `${today.toISOString().slice(0, 10)} − ${birth.slice(0, 10)} = ${age} years`,
      computedAt: today.toISOString(),
      inputs: [fetchProvenance(SOURCE_ID, ctx, personRecord, 'P569 (date of birth)')],
    },
  };
}

/** Guard against a caller handing us something that is not a SPARQL envelope. */
export function assertSparqlEnvelope(raw: unknown, sourceId = SOURCE_ID): void {
  const root = expectObject(sourceId, raw, 'root');
  if (!('results' in root)) throw new ShapeError(sourceId, 'no results block');
}
