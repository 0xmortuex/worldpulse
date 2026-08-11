import type { CacheState, FetchProvenance } from '../facts/types';

/** What the fetch layer records about a single request. */
export interface FetchContext {
  requestUrl: string;
  httpStatus: number;
  fetchedAt: string;
  cache: CacheState;
  fromFixture?: boolean;
}

export function fetchProvenance(
  sourceId: string,
  ctx: FetchContext,
  raw: unknown,
  extractedBy: string,
): FetchProvenance {
  return {
    kind: 'fetch',
    sourceId,
    requestUrl: ctx.requestUrl,
    httpStatus: ctx.httpStatus,
    fetchedAt: ctx.fetchedAt,
    cache: ctx.cache,
    raw,
    extractedBy,
    ...(ctx.fromFixture === undefined ? {} : { fromFixture: ctx.fromFixture }),
  };
}

/**
 * Thrown when a response does not match the shape the adapter expects.
 *
 * This is the failure mode contract tests exist to surface: silent schema drift
 * is the most likely way this app starts lying, so adapters refuse to guess.
 */
export class ShapeError extends Error {
  constructor(sourceId: string, detail: string) {
    super(`${sourceId}: unexpected response shape — ${detail}`);
    this.name = 'ShapeError';
  }
}

export function expectObject(sourceId: string, value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ShapeError(sourceId, `expected an object at ${at}, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

export function expectArray(sourceId: string, value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ShapeError(sourceId, `expected an array at ${at}, got ${describe(value)}`);
  }
  return value;
}

export function expectString(sourceId: string, value: unknown, at: string): string {
  if (typeof value !== 'string') {
    throw new ShapeError(sourceId, `expected a string at ${at}, got ${describe(value)}`);
  }
  return value;
}

export function expectNumber(sourceId: string, value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ShapeError(sourceId, `expected a finite number at ${at}, got ${describe(value)}`);
  }
  return value;
}

/** Range check for values that have a physically meaningful domain. */
export function expectInRange(
  sourceId: string,
  value: number,
  min: number,
  max: number,
  at: string,
): number {
  if (value < min || value > max) {
    throw new ShapeError(sourceId, `${at} = ${value} is outside the plausible range [${min}, ${max}]`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}
