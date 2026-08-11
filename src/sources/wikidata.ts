import type { Fact } from '../facts/types';
import { expectArray, expectObject, expectString, fetchProvenance, ShapeError, type FetchContext } from './adapter';

const SOURCE_ID = 'wikidata-sparql';

export interface SparqlResult {
  vars: string[];
  /** One row per binding, variable name -> literal or URI value. */
  rows: Array<Record<string, string>>;
}

export function parse(raw: unknown, sourceId = SOURCE_ID): SparqlResult {
  const root = expectObject(sourceId, raw, 'root');
  const head = expectObject(sourceId, root['head'], 'head');
  const results = expectObject(sourceId, root['results'], 'results');

  const vars = expectArray(sourceId, head['vars'], 'head.vars').map((name, index) =>
    expectString(sourceId, name, `head.vars[${index}]`),
  );

  const bindings = expectArray(sourceId, results['bindings'], 'results.bindings');

  const rows = bindings.map((binding, index) => {
    const record = expectObject(sourceId, binding, `results.bindings[${index}]`);
    const row: Record<string, string> = {};
    for (const [key, cell] of Object.entries(record)) {
      const typed = expectObject(sourceId, cell, `results.bindings[${index}].${key}`);
      row[key] = expectString(sourceId, typed['value'], `results.bindings[${index}].${key}.value`);
    }
    return row;
  });

  return { vars, rows };
}

/**
 * Extract a single variable from the first row.
 *
 * SPARQL returning zero rows is a normal answer — the entity has no such
 * statement — so it yields a no-data fact rather than throwing. A missing
 * *variable*, by contrast, means the query and the parser disagree, which is
 * a bug worth failing on.
 */
export function singleValueFact(
  result: SparqlResult,
  variable: string,
  ctx: FetchContext,
  options: { asOf: string; note?: string },
): Fact<string> {
  if (!result.vars.includes(variable)) {
    throw new ShapeError(SOURCE_ID, `variable "${variable}" is not among head.vars [${result.vars.join(', ')}]`);
  }

  const value = result.rows[0]?.[variable] ?? null;

  return {
    value,
    asOf: options.asOf,
    tier: 'OFFICIAL',
    provenance: fetchProvenance(SOURCE_ID, ctx, result, `results.bindings[0].${variable}.value`),
    ...(options.note === undefined ? {} : { note: options.note }),
  };
}
