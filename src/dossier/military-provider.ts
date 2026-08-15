import seed from '../../data/military-seed.json';
import type { Fact, Tier } from '../facts/types';
import type { Command, Deployment, MilitaryProfile, NuclearStatus } from './military';

/**
 * Military profiles, read from `data/military-seed.json`.
 *
 * ## Why the data is in `data/` and not here
 *
 * These are seed CITATIONS — hand-checked references to FAS, UN Peacekeeping and
 * national ministries. `registry-coverage.test.ts` requires every host appearing
 * in `src/` to be a registered source, because a host typed into a module is a
 * fetch target nobody registered. A citation is not a fetch target, and the
 * guard cannot tell the difference from a string.
 *
 * The relations seed solved this the same way and for the same reason. Adding
 * four exemptions to the guard would have been the alternative, and each
 * exemption is a place the guard stops looking.
 *
 * **No live ingest yet.** Step 8 builds the panel and its hard cases; step 10
 * connects the pipeline. Every fact here carries `seed` provenance, so the
 * inspector says "typed in by hand, here is what it was checked against" rather
 * than describing a fetch that never happened.
 */

const SEED_FILE = 'data/military-seed.json';

interface SeedFigure {
  value: number;
  source: string;
  coverageEnd: number;
  tier?: string;
}

function toFact(figure: SeedFigure): Fact<number> {
  const source = (seed.sources as Record<string, { name: string; url: string }>)[figure.source];
  if (!source) {
    // A citation naming a source that does not exist is a broken citation, and
    // rendering the figure anyway would give it provenance it does not have.
    throw new Error(`${SEED_FILE}: figure cites unknown source "${figure.source}"`);
  }
  return {
    value: figure.value,
    asOf: String(figure.coverageEnd),
    // The source's own claim decides the tier: FAS publishes estimates and says
    // so, so its rows carry ESTIMATE rather than our judgement of them.
    tier: (figure.tier ?? 'OFFICIAL') as Tier,
    provenance: {
      kind: 'seed',
      file: SEED_FILE,
      source: source.name,
      sourceUrl: source.url,
      coverageEnd: figure.coverageEnd,
      compiledAt: seed.compiledAt,
    },
  };
}

function optionalFact(figure: SeedFigure | undefined): Fact<number> | null {
  return figure === undefined ? null : toFact(figure);
}

interface SeedProfile {
  iso3: string;
  hasArmedForces: boolean;
  personnel?: SeedFigure;
  expenditure?: SeedFigure;
  nuclearStatus?: string;
  warheads?: SeedFigure;
  command?: { title: string; holderName: string; ceremonial: boolean; alsoHeadOfGovernment: boolean };
  overseasPresence?: Array<{ hostIso3: string; hostName: string; kind: string; personnel: SeedFigure }>;
}

function toProfile(raw: SeedProfile): MilitaryProfile {
  const command: Command | null =
    raw.command === undefined
      ? null
      : {
          title: raw.command.title,
          holderName: raw.command.holderName,
          ceremonial: raw.command.ceremonial,
          alsoHeadOfGovernment: raw.command.alsoHeadOfGovernment,
        };

  /**
   * `undefined` and `[]` are NOT the same, and the mapping preserves it.
   *
   * A profile with no `overseasPresence` key was never consulted → `null`. One
   * with an empty array was consulted and recorded nothing → `[]`, which renders
   * "None recorded". Collapsing them here would destroy the step's acceptance
   * criterion before the panel ever sees it.
   */
  const overseasPresence: Deployment[] | null =
    raw.overseasPresence === undefined
      ? null
      : raw.overseasPresence.map((entry) => ({
          hostIso3: entry.hostIso3,
          hostName: entry.hostName,
          kind: entry.kind,
          personnel: toFact(entry.personnel),
        }));

  return {
    iso3: raw.iso3,
    hasArmedForces: raw.hasArmedForces,
    personnel: optionalFact(raw.personnel),
    expenditure: optionalFact(raw.expenditure),
    nuclearStatus: (raw.nuclearStatus ?? 'npt-non-nuclear-weapon-state') as NuclearStatus,
    warheads: optionalFact(raw.warheads),
    command,
    overseasPresence,
  };
}

const PROFILES = new Map<string, MilitaryProfile>(
  (seed.profiles as SeedProfile[]).map((raw) => [raw.iso3, toProfile(raw)]),
);

export function loadMilitary(iso3: string): MilitaryProfile | null {
  return PROFILES.get(iso3) ?? null;
}

/** Exported so a test can assert every specced hard case has a fixture. */
export function fixtureCodes(): string[] {
  return [...PROFILES.keys()];
}
