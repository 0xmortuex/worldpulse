import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clusterEvents } from '../src/layers/events';
import { filterEvents, loadEvents } from '../src/layers/provider';
import { eventListHtml } from '../src/ui/event-list';

/**
 * L9's mitigation, and the assertion S3 requires before it can close.
 *
 * S3: L9 closes as MITIGATED when *every marker-reachable event is reachable
 * without a click*. That is a **set equality**, not a feeling — a list showing
 * most events would close the ticket and leave the defect, which is the worse
 * outcome because the ticket is what would have made someone look again.
 *
 * The number behind the urgency: L9 was recorded as a ~20% flake under
 * SwiftShader at 1.3fps. Under a GPU renderer the same machine runs at 59.9fps
 * and **every marker click fails, deterministically**. On the hardware people
 * own, this list is the only working route to event detail.
 */

const NOW = new Date('2026-08-16T00:00:00.000Z');
const ALL = loadEvents(NOW);

function clustersFor(includeStale: boolean) {
  const enabled = new Set(ALL.map((event) => event.layer));
  return clusterEvents(filterEvents(ALL, { enabled, includeStale }));
}

/** Every `data-event-index` the markup offers. */
function offeredIndices(html: string): number[] {
  return [...html.matchAll(/data-event-index="(\d+)"/g)].map((match) => Number(match[1]));
}

describe('every marker on the globe is reachable without a click', () => {
  it('the fixture set actually produces markers, or this file proves nothing', () => {
    // Rule 27's shape. An empty cluster set would satisfy every equality below
    // while demonstrating none of them.
    const clusters = clustersFor(true);
    assert.ok(clusters.length > 0, 'no clusters at all — the equivalence tests would be vacuous');
    assert.ok(ALL.length > clusters.length, 'no clustering happened, so the multi-member path is unexercised');
  });

  it('the list offers exactly one entry per cluster — no more, no fewer', () => {
    /**
     * THE ASSERTION S3 ASKS FOR.
     *
     * Fewer entries than clusters means an event is on the globe and
     * unreachable by keyboard, which is the defect unmitigated. More entries
     * than clusters means the list is offering something the globe is not
     * showing, which would fly the camera somewhere nothing is rendered.
     */
    for (const includeStale of [true, false]) {
      const clusters = clustersFor(includeStale);
      const indices = offeredIndices(eventListHtml(clusters));
      assert.equal(
        indices.length,
        clusters.length,
        `includeStale=${includeStale}: ${indices.length} list entries for ${clusters.length} markers`,
      );
      assert.deepEqual(
        [...indices].sort((a, b) => a - b),
        clusters.map((_, index) => index),
        'the indices are not a dense 0..n-1 range, so an entry resolves to the wrong cluster',
      );
    }
  });

  it('reports which filter states its sample covered', () => {
    /**
     * Rule 40. `includeStale` is the filter most likely to make one of these
     * two runs trivial, so the counts are asserted to differ — otherwise both
     * iterations above tested the same set and the loop was decoration.
     */
    const withStale = clustersFor(true).length;
    const withoutStale = clustersFor(false).length;
    assert.notEqual(
      withStale,
      withoutStale,
      `both filter states produced ${withStale} clusters, so the loop above tested one case twice`,
    );
  });

  it('every entry describes the cluster it will fly to', () => {
    /**
     * The equivalence is about behaviour, not count. An entry that shows
     * members[0] while the marker shows `representative` would list the right
     * NUMBER of events and describe the wrong ones.
     */
    const clusters = clustersFor(true);
    const html = eventListHtml(clusters);
    for (const cluster of clusters) {
      assert.ok(
        html.includes(cluster.representative.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')),
        `the list does not name "${cluster.representative.title}", which its marker represents`,
      );
    }
  });

  it('a multi-member cluster says how many events share the marker', () => {
    // The marker cannot say so, and a reader choosing where to fly is making a
    // different decision when one point is several overlapping ones.
    const clusters = clustersFor(true);
    const multi = clusters.filter((cluster) => cluster.members.length > 1);
    assert.ok(multi.length > 0, 'no multi-member cluster in the fixture set — this path is untested');
    assert.match(eventListHtml(clusters), /event-count/);
  });

  it('an empty set says the filters are responsible, not the world', () => {
    // Rule 30 at the list level: "no events shown" is a fact about the filters.
    const html = eventListHtml([]);
    assert.match(html, /about the filters, not about the world/i);
    assert.equal(offeredIndices(html).length, 0);
  });
});
