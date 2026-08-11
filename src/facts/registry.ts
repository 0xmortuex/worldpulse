import registry from '../../data/sources.json';
import type { Tier } from './types';

export type LicenseClass = 'open' | 'nc' | 'share-alike' | 'restricted';
export type VerifiedAgainst = 'documentation' | 'live';

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

const data = registry as unknown as Registry;

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
  return sourceIds.some((id) => getSource(id)?.verifiedAgainst !== 'live');
}
