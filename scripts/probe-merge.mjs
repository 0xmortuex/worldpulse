/**
 * Merge a fresh probe row over the previous one, honouring a carry-forward.
 *
 * ## Why a carry-forward exists at all
 *
 * A verdict is a measurement, and a measurement carries the configuration that
 * produced it — rule 20a applied to probes. `riksdagen` answered 200 with a
 * usable ACAO from one network and resets at the TCP layer from another. The
 * second network is not measuring the source; it is measuring itself. Recording
 * UNREACHABLE there and letting the transport gate strip a working source would
 * be the `frankfurter` mistake pointed the other way: a local artifact promoted
 * to a fact about the world.
 *
 * ## Why it is never automatic
 *
 * The probe cannot distinguish "the host is down" from "this network cannot
 * reach it". `riksdagen` (reset) and `smartraveller` (timeout) arrive at the
 * same `got.error` branch. Carrying forward on any network failure would keep a
 * genuinely dead source reporting its last good verdict indefinitely — failing
 * toward optimism.
 *
 * So a carry is an **explicit annotation a human writes**, with its provenance,
 * and this module only decides what happens to it on the next run:
 *
 *   - a fresh network failure does NOT clobber it — that is the exact event the
 *     carry was created to survive; `thisRun` records what was seen
 *   - a fresh CONCLUSIVE verdict DOES replace it — a measurement always beats an
 *     annotation, and this is how the carry expires the first time a capable
 *     network produces a real answer
 *
 * Pure, per rule 32: no I/O, so every state below is reachable from a planted
 * case without a network.
 */
import { CONCLUSIVE } from './probe-verdict.mjs';

/**
 * @typedef {object} CarriedForward
 * @property {string} measuredFrom  the network/environment that produced the verdict
 * @property {string} measuredAt    when it was produced
 * @property {string} [thisRun]     what the current run saw instead
 * @property {string} [reason]      why this network cannot measure the source
 */

/**
 * Is this row a human-annotated carry-forward rather than a live measurement?
 *
 * @param {object | undefined} row
 * @returns {boolean}
 */
export function isCarried(row) {
  return Boolean(row && row.carriedForward && row.carriedForward.measuredFrom);
}

/**
 * @param {object | undefined} previous  the row already in the results file
 * @param {object | undefined} fresh     the row this run measured, if any
 * @returns {object | undefined}
 */
export function mergeRow(previous, fresh) {
  if (fresh === undefined) return previous;
  if (previous === undefined) return fresh;

  // An ordinary row is replaced by whatever the latest run saw. Only an
  // annotated carry gets to argue with a fresh result.
  if (!isCarried(previous)) return fresh;

  if (CONCLUSIVE.has(fresh.verdict)) {
    // The carry has expired: a capable network answered. The annotation is
    // dropped entirely rather than kept alongside, because keeping it would
    // leave two provenances on one row and no rule for which is true.
    return fresh;
  }

  // The carry survives the thing it was created to survive. `thisRun` is what
  // makes that visible rather than silent: a reader can see the source was
  // attempted and what happened, without the attempt overwriting the verdict.
  return {
    ...previous,
    carriedForward: {
      ...previous.carriedForward,
      thisRun: fresh.verdict,
      thisRunReason: fresh.reason ?? null,
      thisRunAt: fresh.probedAt ?? null,
    },
  };
}

/**
 * Merge whole result sets, preserving the registry's ordering.
 *
 * @param {Array<object>} previous
 * @param {Array<object>} fresh
 * @param {Array<string>} order  source ids, in registry order
 * @returns {Array<object>}
 */
export function mergeResults(previous, fresh, order) {
  const before = new Map(previous.map((row) => [row.id, row]));
  const now = new Map(fresh.map((row) => [row.id, row]));
  const merged = new Map();

  for (const id of new Set([...before.keys(), ...now.keys()])) {
    const row = mergeRow(before.get(id), now.get(id));
    if (row !== undefined) merged.set(id, row);
  }

  return order.map((id) => merged.get(id)).filter((row) => row !== undefined);
}

/**
 * Ids whose verdict this run actually measured.
 *
 * A carried row is NOT refreshed even when the run attempted it, because the
 * verdict on display did not come from this run. Reporting it as refreshed is
 * the same overstatement as a merged table with no per-row dating.
 *
 * @param {Array<object>} results  merged rows
 * @param {Array<string>} attempted  ids this run issued a request for
 * @returns {string[]}
 */
export function refreshedIds(results, attempted) {
  const carried = new Set(results.filter(isCarried).map((row) => row.id));
  return attempted.filter((id) => !carried.has(id));
}
