import cabinetNormal from '../../tests/fixtures/government/cabinet-normal.json';
import cabinetLarge from '../../tests/fixtures/government/cabinet-large.json';
import cabinetUntranslated from '../../tests/fixtures/government/cabinet-untranslated.json';
import cabinetNoHolders from '../../tests/fixtures/government/cabinet-no-holders.json';
import legislatureBicameral from '../../tests/fixtures/government/legislature-bicameral.json';
import legislaturePartial from '../../tests/fixtures/government/legislature-partial-parties.json';
import judiciaryFixture from '../../tests/fixtures/government/judiciary.json';
import timelineFixture from '../../tests/fixtures/government/timeline.json';
import personHistoryFixture from '../../tests/fixtures/government/person-history.json';
import {
  parseCabinet,
  parseJudiciary,
  parseLeadershipTimeline,
  parseLegislature,
  parsePersonHistory,
  type Cabinet,
  type Chamber,
  type HeldPosition,
  type Judiciary,
  type Term,
} from '../sources/wikidata-government';
import type { FetchContext } from '../sources/adapter';

/**
 * Fixture-backed government data, mirroring dossier/provider.ts.
 *
 * Countries are mapped to whichever fixture exercises an interesting branch, so
 * the hard cases are reachable in the running app and not only in tests:
 *
 *   GBR  ordinary cabinet, bicameral legislature with a complete party split
 *   USA  ordinary cabinet, judiciary, full leadership timeline
 *   IRN  cabinet with untranslated portfolios
 *   MLI  cabinet whose positions have no officeholders recorded
 *   DEU  large cabinet (58 posts)
 *   SAU  legislature whose party seats do not account for the chamber
 */

function ctxFor(iso3: string, what: string): FetchContext {
  return {
    requestUrl: `https://query.wikidata.org/sparql?format=json&query=<${what} query for ${iso3}>`,
    httpStatus: 200,
    fetchedAt: '1970-01-01T00:00:00.000Z',
    cache: 'miss',
    fromFixture: true,
  };
}

const CABINETS: Record<string, unknown> = {
  GBR: cabinetNormal,
  USA: cabinetNormal,
  DEU: cabinetLarge,
  IRN: cabinetUntranslated,
  MLI: cabinetNoHolders,
};

const LEGISLATURES: Record<string, unknown> = {
  GBR: legislatureBicameral,
  USA: legislatureBicameral,
  SAU: legislaturePartial,
};

const JUDICIARIES: Record<string, unknown> = {
  USA: judiciaryFixture,
  GBR: judiciaryFixture,
};

const TIMELINES: Record<string, unknown> = {
  USA: timelineFixture,
};

/** Every country this provider can serve. Used by the rule-10 reachability test. */
export const GOVERNMENT_COUNTRIES = [
  ...new Set([
    ...Object.keys(CABINETS),
    ...Object.keys(LEGISLATURES),
    ...Object.keys(JUDICIARIES),
    ...Object.keys(TIMELINES),
  ]),
];

export interface GovernmentData {
  cabinet: { value: Cabinet; ctx: FetchContext } | null;
  chambers: { value: Chamber[]; ctx: FetchContext } | null;
  judiciary: { value: Judiciary | null; ctx: FetchContext } | null;
  timeline: { value: Term[]; ctx: FetchContext } | null;
}

export function loadGovernment(iso3: string): GovernmentData {
  const cabinetRaw = CABINETS[iso3];
  const legislatureRaw = LEGISLATURES[iso3];
  const judiciaryRaw = JUDICIARIES[iso3];
  const timelineRaw = TIMELINES[iso3];

  return {
    cabinet: cabinetRaw ? { value: parseCabinet(cabinetRaw), ctx: ctxFor(iso3, 'cabinet') } : null,
    chambers: legislatureRaw
      ? { value: parseLegislature(legislatureRaw), ctx: ctxFor(iso3, 'legislature') }
      : null,
    judiciary: judiciaryRaw ? { value: parseJudiciary(judiciaryRaw), ctx: ctxFor(iso3, 'judiciary') } : null,
    timeline: timelineRaw
      ? { value: parseLeadershipTimeline(timelineRaw), ctx: ctxFor(iso3, 'leadership timeline') }
      : null,
  };
}

/** Office history for the leader detail sheet. Only the fixture person has one. */
export function loadPersonHistory(personName: string): { value: HeldPosition[]; ctx: FetchContext } | null {
  if (personName !== 'Alex Fixture') return null;
  return { value: parsePersonHistory(personHistoryFixture), ctx: ctxFor('USA', 'person history') };
}
