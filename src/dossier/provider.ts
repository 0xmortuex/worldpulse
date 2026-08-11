import presidential from '../../tests/fixtures/leaders/presidential.json';
import parliamentaryMonarch from '../../tests/fixtures/leaders/parliamentary-monarch.json';
import parliamentaryRepublic from '../../tests/fixtures/leaders/parliamentary-republic.json';
import deFactoAuthority from '../../tests/fixtures/leaders/de-facto-authority.json';
import executiveMonarchy from '../../tests/fixtures/leaders/executive-monarchy.json';
import transitional from '../../tests/fixtures/leaders/transitional.json';
import missingImage from '../../tests/fixtures/leaders/missing-image.json';
import wikipediaSummary from '../../tests/fixtures/leaders/wikipedia-summary.json';
import commonsImageinfo from '../../tests/fixtures/leaders/commons-imageinfo.json';
import { parseCountryDossier, type CountryDossierRecord } from '../sources/wikidata-dossier';
import { parseCommonsAttribution, type PortraitAttribution } from './portrait';
import type { FetchContext } from '../sources/adapter';

/**
 * Where dossier data comes from.
 *
 * Today: hand-authored fixtures, because the build environment's egress policy
 * blocks query.wikidata.org. This module is the seam — when egress opens, the
 * fixture lookup is replaced by a cached fetch of `buildCountryQueryUrl(iso3)`
 * and nothing downstream changes.
 *
 * Countries without a fixture return null, which renders as "no data". That is
 * the correct behaviour and it keeps the fixture set from masquerading as
 * coverage.
 */

const FIXTURES: Record<string, unknown> = {
  USA: presidential,
  GBR: parliamentaryMonarch,
  DEU: parliamentaryRepublic,
  IRN: deFactoAuthority,
  SAU: executiveMonarchy,
  MLI: transitional,
  // Deliberately the no-P18 variant, so the placeholder path is reachable in
  // the running app rather than only in tests.
  CAN: missingImage,
};

export const FIXTURE_COUNTRIES = Object.keys(FIXTURES);

function fixtureContext(iso3: string): FetchContext {
  return {
    requestUrl: `https://query.wikidata.org/sparql?format=json&query=<dossier query for ${iso3}>`,
    httpStatus: 200,
    fetchedAt: '1970-01-01T00:00:00.000Z',
    cache: 'miss',
    fromFixture: true,
  };
}

export interface DossierSource {
  record: CountryDossierRecord;
  ctx: FetchContext;
}

export function loadDossier(iso3: string): DossierSource | null {
  const raw = FIXTURES[iso3];
  if (!raw) return null;
  return { record: parseCountryDossier(raw), ctx: fixtureContext(iso3) };
}

/** Wikipedia lead paragraph. Only the fixture person has one. */
export function loadBio(personName: string): { extract: string; url: string; ctx: FetchContext } | null {
  const summary = wikipediaSummary as { title: string; extract: string; content_urls: { desktop: { page: string } } };
  if (personName !== summary.title) return null;
  return {
    extract: summary.extract,
    url: summary.content_urls.desktop.page,
    ctx: {
      requestUrl: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(personName)}`,
      httpStatus: 200,
      fetchedAt: '1970-01-01T00:00:00.000Z',
      cache: 'miss',
      fromFixture: true,
    },
  };
}

/** Commons licence and photographer credit for a portrait file. */
export function loadAttribution(fileTitle: string | null): PortraitAttribution | null {
  if (!fileTitle) return null;
  const info = commonsImageinfo as { query: { pages: Record<string, { title: string }> } };
  const known = Object.values(info.query.pages)[0]?.title;
  if (fileTitle !== known) return null;
  return parseCommonsAttribution(commonsImageinfo);
}
