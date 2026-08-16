import watchlist from '../../data/watchlist.json';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * Step 13's watchlist surface.
 *
 * ## Why this renders refutations as prominently as confirmations
 *
 * `WATCHLIST.md` was written **before** any live response was seen, so its
 * predictions would be falsifiable. That is the entire value of the exercise,
 * and it is destroyed by reporting the results selectively: **a watchlist that
 * shows only its hits is an advertisement.**
 *
 * So a REFUTED entry renders with the same weight as a CONFIRMED one, and the
 * counts below the list state both. If the refuted count is ever zero, the
 * surface says so explicitly rather than letting an all-green list imply that
 * nothing was ever got wrong — six for six is a real result, and it is also
 * exactly what a hidden failure would look like.
 */

type Verdict = 'CONFIRMED' | 'REFUTED' | 'INCONCLUSIVE';

interface Prediction {
  subject: string;
  predicted: string;
  observed: string;
  ruleFired: string;
  verdict: string;
  note: string | null;
}

const PREDICTIONS = (watchlist as { predictions: Prediction[] }).predictions;
const MEASURED_ON = (watchlist as { measuredOn: string }).measuredOn;

export function verdictsIn(predictions: readonly Prediction[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { CONFIRMED: 0, REFUTED: 0, INCONCLUSIVE: 0 };
  for (const prediction of predictions) {
    if (prediction.verdict === 'CONFIRMED' || prediction.verdict === 'REFUTED' || prediction.verdict === 'INCONCLUSIVE') {
      counts[prediction.verdict] += 1;
    }
  }
  return counts;
}

export function renderWatchlist(): string {
  const counts = verdictsIn(PREDICTIONS);

  /**
   * The sentence that stops an all-green list from lying by omission.
   *
   * Six of six holding is a genuine result about the resolution rules. It is
   * also indistinguishable, at a glance, from a list with its failures removed
   * — so the surface names the zero rather than leaving it to be inferred from
   * an absence.
   */
  const refutedLine =
    counts.REFUTED === 0
      ? 'No prediction was refuted. That is the recorded outcome, not a filtered list — refuted predictions would appear here with the same weight as confirmed ones.'
      : `${counts.REFUTED} of ${PREDICTIONS.length} predictions were refuted, and they are listed above with the rest.`;

  return `<section class="gov-block watchlist">
    <h3>Watchlist</h3>
    <p class="gov-caveat">Predictions written <strong>before</strong> any live response was
    seen, so they could be wrong. Measured ${escapeHtml(MEASURED_ON)}.</p>

    <ul class="watchlist-list">
      ${PREDICTIONS.map(
        (prediction) => `<li class="watchlist-row watchlist-row--${escapeHtml(prediction.verdict.toLowerCase())}">
          <div class="watchlist-head">
            <span class="watchlist-subject">${escapeHtml(prediction.subject)}</span>
            <span class="watchlist-verdict">${escapeHtml(prediction.verdict)}</span>
          </div>
          <div class="watchlist-detail"><strong>Predicted:</strong> ${escapeHtml(prediction.predicted)}</div>
          <div class="watchlist-detail"><strong>Observed:</strong> ${escapeHtml(prediction.observed)}
            · rule ${escapeHtml(prediction.ruleFired)}</div>
          ${prediction.note ? `<p class="gov-caveat">${escapeHtml(prediction.note)}</p>` : ''}
        </li>`,
      ).join('')}
    </ul>

    <p class="gov-caveat">${n(counts.CONFIRMED, 'predictions that held when measured against live data')} confirmed,
    ${n(counts.REFUTED, 'predictions that did not hold when measured against live data')} refuted.
    ${escapeHtml(refutedLine)}</p>
  </section>`;
}
