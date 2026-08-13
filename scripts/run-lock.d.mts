export interface LockRecord {
  pid: number;
  kind: string;
  startedAt: string;
  commit?: string;
}

export type LockDecision =
  | { proceed: true; replacing: LockRecord | null }
  | { proceed: false; reason: string };

export function lockDecision(input: {
  existing: LockRecord | null;
  now: number;
  isAlive: (pid: number) => boolean;
  kind: string;
}): LockDecision;

export function readLock(path?: string): LockRecord | null;
export function processIsAlive(pid: number): boolean;
export interface AcquireOptions {
  /** false when the caller has its own async teardown and owns the exit. */
  exitOnSignal?: boolean;
}

export function acquireRunLock(
  kind: string,
  commit: string | undefined,
  path?: string,
  options?: AcquireOptions,
): () => void;
export const LOCK_PATH: string;
