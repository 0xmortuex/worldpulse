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

const SOURCE_ID = 'portwatch-chokepoints';

const SERVICE =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';

/**
 * The limitation statement rendered beside any PortWatch figure.
 *
 * **This is OUR caveat, not the IMF's, and the wording must not imply otherwise.**
 * Whether PortWatch documents these limitations itself could not be established:
 * portwatch.imf.org is a JS-rendered ArcGIS Hub app that did not hydrate under
 * the checking browser, so the result was inconclusive rather than negative — we
 * did not see it, which is not the same as it not being there.
 *
 * Attribution is asymmetric: a caveat marked as ours can be re-attributed to the
 * IMF if their wording is later established, but our wording laundered as theirs
 * cannot be walked back once readers have seen it. So it renders as ours, with
 * its basis cited inline rather than only in the inspector — a reader who never
 * opens the inspector still learns whose claim this is and where it comes from.
 *
 * The basis is the source's own methodology: PortWatch's dataset description
 * names AIS vessel signals as its primary input and cites the paper below.
 */
export const AIS_CAVEAT =
  'Our caveat, not the IMF’s: these figures derive from AIS vessel broadcasts, which can be ' +
  'jammed or spoofed, and which a vessel can switch off. Transits by vessels not broadcasting are ' +
  'not counted. Basis: AIS-derived data per Arslanalp, Koepke & Verschuur, IMF WP/2021/225.';

/** Chokepoints PortWatch publishes, as ids. `portname` comes from the response. */
export interface ChokepointDay {
  chokepointId: string;
  chokepointName: string;
  date: string;
  /** Counted transits, by ship category. */
  transits: {
    container: Fact<number>;
    dryBulk: Fact<number>;
    generalCargo: Fact<number>;
    roro: Fact<number>;
    tanker: Fact<number>;
    cargo: Fact<number>;
    total: Fact<number>;
  };
  /** Estimated payload carried, in metric tons. */
  volume: {
    cargo: Fact<number>;
    tanker: Fact<number>;
    total: Fact<number>;
  };
}

export interface ChokepointQuery {
  chokepointId: string;
  year: number;
  month: number;
  throughDay: number;
}

/**
 * The app's own request construction, exported so the fixture derives its URL
 * from here rather than repeating it.
 *
 * Rule 26 at a new boundary: a hand-written fixture URL diverged from the app's
 * real request in three of six fixtures before this convention existed, and the
 * unexercised-path gate now refuses a `live` source whose fixture did not come
 * through this function.
 */
export function buildChokepointQueryUrl(query: ChokepointQuery): string {
  const where =
    `portid='${query.chokepointId}' AND year=${query.year} ` +
    `AND month=${query.month} AND day<=${query.throughDay}`;

  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'false',
    orderByFields: 'date ASC',
    f: 'json',
  });

  return `${SERVICE}?${params.toString()}`;
}

/**
 * TIER SPLIT — do not collapse these to one tier.
 *
 * `n_*` are COUNTED transit calls: PortWatch counts a ship crossing the
 * chokepoint boundary, once per transit, with a 48-hour threshold before the
 * same ship counts again. A count from an IGO primary source is `OFFICIAL`.
 *
 * `capacity_*` are ESTIMATED payloads. The IMF describes them as modelled: the
 * vessel's payload is estimated from its length, width, draft, capacity and
 * block coefficient, then multiplied by deadweight tonnage to give a trade
 * volume in metric tons (Arslanalp, Koepke & Verschuur, *Tracking Trade from
 * Space*, IMF WP/2021/225).
 *
 * **Rendering `capacity` as OFFICIAL would assert a measured tonnage the source
 * itself calls an estimate** — the false-confidence failure the tier system
 * exists to prevent. A future session tempted to "simplify" both families to one
 * tier is reading two different kinds of number as one.
 *
 * UNITS (rule 22): metric tons. The authority is PortWatch's catalogue item
 * description; the service's field metadata carries no unit at all. The contract
 * test asserts those two never disagree rather than silently preferring either.
 */
function countFact(value: number, date: string, raw: unknown, ctx: FetchContext, at: string): Fact<number> {
  return { value, asOf: date, tier: 'OFFICIAL', provenance: fetchProvenance(SOURCE_ID, ctx, raw, at) };
}

function volumeFact(value: number, date: string, raw: unknown, ctx: FetchContext, at: string): Fact<number> {
  return {
    value,
    unit: 'metric tons',
    asOf: date,
    tier: 'ESTIMATE',
    provenance: fetchProvenance(SOURCE_ID, ctx, raw, at),
    note: AIS_CAVEAT,
  };
}

export function parse(raw: unknown, ctx: FetchContext, sourceId = SOURCE_ID): ChokepointDay[] {
  const root = expectObject(sourceId, raw, 'root');
  const features = expectArray(sourceId, root['features'], 'features');

  return features.map((feature, index) => {
    const at = `features[${index}]`;
    const record = expectObject(sourceId, feature, at);
    const a = expectObject(sourceId, record['attributes'], `${at}.attributes`);

    const date = expectString(sourceId, a['date'], `${at}.attributes.date`);
    const count = (field: string): number =>
      expectNumber(sourceId, a[field], `${at}.attributes.${field}`);

    const container = count('n_container');
    const dryBulk = count('n_dry_bulk');
    const generalCargo = count('n_general_cargo');
    const roro = count('n_roro');
    const tanker = count('n_tanker');
    const cargo = count('n_cargo');
    const total = count('n_total');

    /**
     * The source defines `n_cargo` and `n_total` as sums, so a disagreement is
     * shape drift rather than a data quirk — a category added upstream, or a
     * field re-pointed. Rule 25: assert the invariant, not this week's numbers.
     */
    if (cargo !== container + dryBulk + generalCargo + roro) {
      throw new ShapeError(
        sourceId,
        `${at}: n_cargo ${cargo} is not the sum of its categories (${container + dryBulk + generalCargo + roro})`,
      );
    }
    if (total !== cargo + tanker) {
      throw new ShapeError(sourceId, `${at}: n_total ${total} is not n_cargo + n_tanker (${cargo + tanker})`);
    }

    const field = (name: string): string => `${at}.attributes.${name}`;

    return {
      chokepointId: expectString(sourceId, a['portid'], field('portid')),
      chokepointName: expectString(sourceId, a['portname'], field('portname')),
      date,
      transits: {
        container: countFact(container, date, raw, ctx, field('n_container')),
        dryBulk: countFact(dryBulk, date, raw, ctx, field('n_dry_bulk')),
        generalCargo: countFact(generalCargo, date, raw, ctx, field('n_general_cargo')),
        roro: countFact(roro, date, raw, ctx, field('n_roro')),
        tanker: countFact(tanker, date, raw, ctx, field('n_tanker')),
        cargo: countFact(cargo, date, raw, ctx, field('n_cargo')),
        total: countFact(total, date, raw, ctx, field('n_total')),
      },
      volume: {
        cargo: volumeFact(count('capacity_cargo'), date, raw, ctx, field('capacity_cargo')),
        tanker: volumeFact(count('capacity_tanker'), date, raw, ctx, field('capacity_tanker')),
        total: volumeFact(count('capacity'), date, raw, ctx, field('capacity')),
      },
    };
  });
}
