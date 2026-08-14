export interface CarriedForward {
  measuredFrom: string;
  measuredAt: string;
  reason?: string;
  thisRun?: string;
  thisRunReason?: string | null;
  thisRunAt?: string | null;
}

export interface ProbeRow {
  id: string;
  verdict?: string;
  reason?: string | null;
  probedAt?: string;
  carriedForward?: CarriedForward;
  [key: string]: unknown;
}

export function isCarried(row: ProbeRow | undefined): boolean;
export function mergeRow(previous: ProbeRow | undefined, fresh: ProbeRow | undefined): ProbeRow | undefined;
export function mergeResults(previous: ProbeRow[], fresh: ProbeRow[], order: string[]): ProbeRow[];
export function refreshedIds(results: ProbeRow[], attempted: string[]): string[];
