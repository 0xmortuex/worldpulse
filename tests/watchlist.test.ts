import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import data from '../data/watchlist.json';
import { renderWatchlist, verdictsIn } from '../src/ui/watchlist';

/**
 * Step 13's watchlist surface.
 *
 * `WATCHLIST.md` was written before any live response was seen, so its
 * predictions could be wrong. That is the whole value, and it is destroyed by
 * reporting the results selectively — **a watchlist that shows only its hits is
 * an advertisement.**
 *
 * So these tests are mostly about the failure case being renderable and
 * prominent, even though today there are no failures to render.
 */

interface Prediction {
  subject: string;
  predicted: string;
  observed: string;
  ruleFired: string;
  verdict: string;
  note: string | null;
}

const PREDICTIONS = (data as { predictions: Prediction[] }).predictions;

describe('the watchlist reports outcomes, not achievements', () => {
  it('renders every prediction, whatever its verdict', () => {
    const html = renderWatchlist();
    for (const prediction of PREDICTIONS) {
      assert.ok(html.includes(prediction.subject), `${prediction.subject} is not rendered`);
    }
  });

  it('A REFUTED PREDICTION WOULD RENDER WITH THE SAME WEIGHT', () => {
    /**
     * PLANTED, because today's data cannot exercise it: six of six held.
     *
     * A surface that has never rendered a failure is a surface nobody knows can
     * render one, and "all confirmed" is exactly what a filtered list looks
     * like. This drives the same counting function the view uses.
     */
    const withFailure = [
      ...PREDICTIONS,
      {
        subject: 'Testland',
        predicted: 'rule 3 fires',
        observed: 'nothing matched',
        ruleFired: 'none',
        verdict: 'REFUTED',
        note: null,
      },
    ];
    const counts = verdictsIn(withFailure);
    assert.equal(counts.REFUTED, 1);
    assert.equal(counts.CONFIRMED, PREDICTIONS.length);
  });

  it('names the zero rather than leaving it to be inferred', () => {
    /**
     * Six of six holding is a genuine result about the resolution rules. It is
     * also indistinguishable at a glance from a list with its failures removed,
     * so the surface says so outright.
     */
    const counts = verdictsIn(PREDICTIONS);
    const html = renderWatchlist();
    if (counts.REFUTED === 0) {
      assert.match(html, /not a filtered list/i, 'an all-confirmed list does not disclaim being filtered');
    } else {
      assert.match(html, /were refuted/i);
    }
  });

  it('reports both counts, not just the flattering one', () => {
    const html = renderWatchlist();
    assert.match(html, /confirmed/i);
    assert.match(html, /refuted/i);
  });

  it('says when it was measured, so a stale result is visible as one', () => {
    assert.match(renderWatchlist(), /2026-08-12/);
  });

  it('every prediction records what was predicted AND what was observed', () => {
    // A prediction without its observation is a claim; with it, it is evidence.
    for (const prediction of PREDICTIONS) {
      assert.ok(prediction.predicted.trim().length > 0, `${prediction.subject} has no prediction`);
      assert.ok(prediction.observed.trim().length > 0, `${prediction.subject} has no observation`);
      assert.ok(['CONFIRMED', 'REFUTED', 'INCONCLUSIVE'].includes(prediction.verdict),
        `${prediction.subject} has an unrecognised verdict "${prediction.verdict}"`);
    }
  });

  it('the transient 502 is recorded as transport, not as a refutation', () => {
    /**
     * Saudi Arabia's first attempt returned HTTP 502. Reading that as "the
     * prediction failed" would be the transport-versus-data confusion this
     * project keeps having to unpick — so the note says which it was.
     */
    const saudi = PREDICTIONS.find((prediction) => prediction.subject === 'Saudi Arabia');
    assert.ok(saudi);
    assert.equal(saudi.verdict, 'CONFIRMED');
    assert.match(saudi.note ?? '', /transient, not a refutation/i);
  });
});
