import registry from '../../data/sources.json';
import type { Tier } from './types';

/**
 * The allowed values live here as arrays rather than bare unions because the
 * registry is JSON, and a union alone cannot check JSON — it can only be
 * asserted over it. See `parseRegistry` below.
 */
const LICENSE_CLASSES = ['open', 'nc', 'share-alike', 'restricted'] as const;
const VERIFIED_AGAINST = ['documentation', 'live', 'bundled'] as const;
const TIERS = ['OFFICIAL', 'ESTIMATE', 'DERIVED'] as const;

export type LicenseClass = (typeof LICENSE_CLASSES)[number];
export type VerifiedAgainst = (typeof VERIFIED_AGAINST)[number];

export interface SourceRecord {
  id: string;
  name: string;
  panel: string;
  homepage: string;
  probeUrl: string | null;
  license: string;
  licenseClass: LicenseClass;
  attribution: string | null;
  cadence: string;
  ttlMs: number | null;
  tier: Tier;
  keyRequired: boolean;
  keyEnv: string | null;
  verifiedAgainst: VerifiedAgainst;
  excluded?: boolean;
  notes?: string;
  requiresCustomUserAgent?: boolean;
}

interface Registry {
  licenseClasses: Record<LicenseClass, string>;
  verifiedAgainstValues: Record<VerifiedAgainst, string>;
  sources: SourceRecord[];
}

/**
 * Validate the registry instead of asserting it.
 *
 * This used to read `registry as unknown as Registry`. A cast at a boundary is
 * the point where a type-driven rule stops being enforced: `verifiedAgainst`
 * gained a third value, `bundled`, in the data and in the deploy gate, and the
 * type here still said `'documentation' | 'live'` for the whole of steps 6 and
 * 7. The cast made that unobservable — every consumer type-checked against a
 * set of values the data did not use. Rule 14 in TESTING.md is the same
 * observation about `string`-returning helpers; this is its shape at a JSON
 * boundary.
 *
 * Failing loudly at module load is the point. A registry that does not match
 * its own type is a source misconfiguration, and the alternatives are to
 * silently drop the source or to render it with a value nothing understands.
 */
function oneOf<T extends string>(allowed: readonly T[], value: unknown, where: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(
      `sources.json: ${where} is ${JSON.stringify(value)}, expected one of ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

/**
 * Exported so a planted violation can be fed to it (rule 27). A validator that
 * has only ever seen valid input is a validator nobody has watched work.
 */
export function parseRegistry(raw: typeof registry): Registry {
  const sources = raw.sources.map((source): SourceRecord => {
    const record = source as SourceRecord & Record<string, unknown>;
    return {
      ...record,
      licenseClass: oneOf(LICENSE_CLASSES, record.licenseClass, `${record.id}.licenseClass`),
      verifiedAgainst: oneOf(VERIFIED_AGAINST, record.verifiedAgainst, `${record.id}.verifiedAgainst`),
      tier: oneOf(TIERS, record.tier, `${record.id}.tier`),
    };
  });

  for (const value of VERIFIED_AGAINST) {
    if (!(value in raw.verifiedAgainstValues)) {
      throw new Error(`sources.json: verifiedAgainstValues is missing an entry for "${value}"`);
    }
  }

  return {
    licenseClasses: raw.licenseClasses as Record<LicenseClass, string>,
    verifiedAgainstValues: raw.verifiedAgainstValues as Record<VerifiedAgainst, string>,
    sources,
  };
}

const data = parseRegistry(registry);

const byId = new Map<string, SourceRecord>(data.sources.map((source) => [source.id, source]));

export function getSource(id: string): SourceRecord | undefined {
  return byId.get(id);
}

export function allSources(): readonly SourceRecord[] {
  return data.sources;
}

export function licenseClassNote(licenseClass: LicenseClass): string {
  return data.licenseClasses[licenseClass];
}

export function verifiedAgainstNote(verified: VerifiedAgainst): string {
  return data.verifiedAgainstValues[verified];
}

/**
 * Licence classes that constrain what we may do with the data. Surfaced in the
 * inspector so the constraint is visible at the point of use, not buried in a
 * registry file nobody opens.
 */
export function licenseIsConstrained(licenseClass: LicenseClass): boolean {
  return licenseClass === 'nc' || licenseClass === 'share-alike' || licenseClass === 'restricted';
}

/**
 * True when any source a view depends on has not been confirmed against a live
 * response. Deployment gate: nothing ships while this is true.
 */
export function anyUnverified(sourceIds: readonly string[]): boolean {
  // `bundled` counts as verified, matching check-deploy-gate.mjs: a
  // version-pinned dataset asserted byte-level against the shipped bytes cannot
  // drift, which is the thing `live` exists to rule out. Typing the third value
  // is what made this visible — under the old cast the comparison read
  // `!== 'live'` against a union that could not express `bundled`, so a bundled
  // source counted as unverified here while passing the gate.
  return sourceIds.some((id) => {
    const verified = getSource(id)?.verifiedAgainst;
    return verified !== 'live' && verified !== 'bundled';
  });
}
