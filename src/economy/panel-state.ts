import { assertNever } from '../facts/exhaustive';

/**
 * What a panel as a whole is showing, computed from its rows.
 *
 * Rule 21: the marker is computed from the outcome, never set by whoever
 * happens to know. A panel that decides its own state by hand drifts from what
 * it is actually displaying, which is the failure this rule was earned from.
 *
 * `degraded` is the state most likely to be skipped and the most important one
 * present. A dossier with eight of nine sources answering must not look
 * identical to one with nine, and must not be flattened to `unavailable`
 * either — both erase the difference between partial and absent.
 */
export type PanelState = 'loading' | 'ok' | 'degraded' | 'unavailable' | 'unconfigured';

export interface RowOutcome {
  /** Still in flight. */
  loading: boolean;
  /** Produced a usable series. `nodata` from a source that answered counts. */
  answered: boolean;
  /** The request failed — a fact about us, not about the country. */
  failed: boolean;
  /** Key-gated with no key configured. */
  unconfigured: boolean;
}

export function panelStateFor(rows: readonly RowOutcome[]): PanelState {
  if (rows.length === 0) return 'unavailable';

  // Any row still in flight keeps the whole panel in `loading`. Rendering a
  // partial panel that then rearranges is a layout shift plus a moment where the
  // panel silently understates what it has.
  if (rows.some((row) => row.loading)) return 'loading';

  const answered = rows.filter((row) => row.answered).length;
  const failed = rows.filter((row) => row.failed).length;
  const unconfigured = rows.filter((row) => row.unconfigured).length;

  if (answered === rows.length) return 'ok';
  if (answered === 0 && unconfigured === rows.length) return 'unconfigured';
  if (answered === 0) return 'unavailable';

  // Some answered, some did not — whether the shortfall is a failure or a
  // missing key. Both mean the panel is showing less than it claims to cover.
  if (failed > 0 || unconfigured > 0) return 'degraded';
  return 'ok';
}

/** Sentence naming what is missing. Rendered, so it names sources rather than counting them. */
export function shortfallNote(missing: readonly string[], total: number): string | null {
  if (missing.length === 0) return null;
  // Rule 22's shape: a bare count is not a fact anyone can act on. Naming the
  // indicators is what lets a reader tell "this country has no Gini figure" from
  // "the World Bank did not answer".
  return `${missing.length} of ${total} indicators unavailable: ${missing.join(', ')}.`;
}

export function panelStateLabel(state: PanelState): string {
  switch (state) {
    case 'loading':
      return 'Loading';
    case 'ok':
      return 'Complete';
    case 'degraded':
      return 'Partial';
    case 'unavailable':
      return 'Unavailable';
    case 'unconfigured':
      return 'Not configured';
    default:
      return assertNever(state, 'panelStateLabel');
  }
}
