import seed from '../../data/legislature-seed.json';
import legislatureBicameral from '../../tests/fixtures/government/legislature-bicameral.json';
import legislaturePartial from '../../tests/fixtures/government/legislature-partial-parties.json';
import type { FetchContext } from '../sources/adapter';
import { parseLegislature, type Chamber } from '../sources/wikidata-government';
import type { ChamberSelection, LegislatureProfile, LegislatureStatus } from './legislature';

function ctxFor(iso3: string): FetchContext {
  return {
    requestUrl: `https://query.wikidata.org/sparql?format=json&query=<legislature query for ${iso3}>`,
    httpStatus: 200,
    fetchedAt: '1970-01-01T00:00:00.000Z',
    cache: 'miss',
    fromFixture: true,
  };
}

/**
 * Legislature profiles for step 9.
 *
 * ## Two sources, deliberately, because they answer different questions
 *
 * **Chambers and seats** come from the Wikidata capture, parsed by the same
 * `parseLegislature` the live path uses — so the panel is exercised against the
 * shape a real response has, per 20b.
 *
 * **Status** comes from `data/legislature-seed.json`, because no query in this
 * app can answer whether a legislature is sitting, dissolved, suspended or
 * contested. Seeding it is not a placeholder for a query we have not written;
 * it is a fact of a different kind, and step 10 will need a different source
 * for it than the one that yields seat counts.
 *
 * ## Countries with no entry
 *
 * They get `unrecorded` and an empty chamber list, which the panel renders as a
 * stated gap. **Not as "no legislature"** — the distinction the whole model
 * exists to keep.
 */

const CHAMBER_CAPTURES: Record<string, unknown> = {
  GBR: legislatureBicameral,
  ISL: legislaturePartial,
};

interface SeedProfile {
  status: string;
  source: string;
  asOf: string;
  upperChamberSelection: string | null;
  note: string;
}

const STATUSES: readonly LegislatureStatus[] = [
  'sitting',
  'dissolved',
  'suspended',
  'contested',
  'appointed-consultative',
  'no-elected-legislature',
  'unrecorded',
];

const SELECTIONS: readonly ChamberSelection[] = ['elected', 'appointed', 'mixed'];

/**
 * Exported for rule 32: a guard that cannot be called directly has not been
 * tested. This one rejects a status string the model does not know, and the
 * failure it prevents is silent — an unknown value falls through
 * `statusSentence`'s switch to `null`, so a suspended legislature would render
 * exactly like a sitting one.
 */
export function readStatus(raw: string, iso3: string): LegislatureStatus {
  const match = STATUSES.find((status) => status === raw);
  if (!match) {
    // An unknown status string would otherwise fall through to whatever the
    // switch in `statusSentence` does with it, which is silence — a country
    // whose legislature is suspended rendering as though it were sitting.
    throw new Error(`legislature-seed.json: ${iso3} has unknown status "${raw}"`);
  }
  return match;
}

function readSelection(raw: string | null, iso3: string): ChamberSelection | null {
  if (raw === null) return null;
  const match = SELECTIONS.find((selection) => selection === raw);
  if (!match) throw new Error(`legislature-seed.json: ${iso3} has unknown upperChamberSelection "${raw}"`);
  return match;
}

export function legislatureFor(iso3: string): LegislatureProfile {
  const profiles = seed.profiles as Record<string, SeedProfile>;
  const entry = profiles[iso3];
  const capture = CHAMBER_CAPTURES[iso3];

  const chambers: Chamber[] = capture ? parseLegislature(capture) : [];

  if (!entry) {
    return {
      status: 'unrecorded',
      statusSource: null,
      statusAsOf: null,
      statusNote: null,
      upperChamberSelection: null,
      chambers,
      chambersCtx: capture ? ctxFor(iso3) : null,
      truncated: false,
    };
  }

  const sources = seed.sources as Record<string, { name: string; url: string }>;
  const source = sources[entry.source];
  if (!source) {
    throw new Error(`legislature-seed.json: ${iso3} cites unknown source "${entry.source}"`);
  }

  return {
    status: readStatus(entry.status, iso3),
    statusSource: source,
    statusAsOf: entry.asOf,
    statusNote: entry.note,
    upperChamberSelection: readSelection(entry.upperChamberSelection, iso3),
    chambers,
    chambersCtx: capture ? ctxFor(iso3) : null,
    /**
     * Always false against captures: the fixtures are small by construction.
     *
     * It is threaded through anyway rather than omitted, because the field is
     * the one the live path sets and a field that only exists on one path is a
     * field the other path's rendering has never been checked against. The
     * contract test plants the true case.
     */
    truncated: false,
  };
}
