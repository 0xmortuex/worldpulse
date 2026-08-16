import type { EventCluster } from '../layers/events';
import { colorFor } from '../layers/provider';
import { notAFact as n } from '../facts/discipline';
import { escapeHtml, factHtml } from '../facts/badge';

/**
 * The keyboard-reachable route to every event on the globe — L9's mitigation.
 *
 * ## Why this is load-bearing and not an accessibility nicety
 *
 * L9 was recorded as a ~20% flake, measured under SwiftShader at 1.3fps. Under
 * a renderer that actually engages the GPU, the same machine runs at 59.9fps
 * and **every marker click fails — 100%, deterministically.**
 *
 * Most users' machines are 60fps machines. So clicking a marker on the globe
 * does not work at all for real visitors, and has not, while our own
 * measurements called it intermittent — because they ran on a software
 * rasteriser that made the failure rare and the guard vacuous.
 *
 * That makes this list **the only working route to event detail on the
 * hardware people own**, which is what L10 meant by "load-bearing, not an
 * accessibility nicety" before anyone had the number that proved it.
 *
 * ## What "equivalent" has to mean
 *
 * S3 closes L9 as MITIGATED when *every marker-reachable event is reachable
 * without a click*. That is a set equality, not a vibe, so this module exports
 * the list it builds and a test asserts it against the clusters the globe was
 * handed. A list that showed most events would close the ticket and leave the
 * defect.
 *
 * ## What it does NOT do
 *
 * It does not fix L9. The raycast mechanism is still globe.gl's and still
 * unexplained, and per rule 21a the ticket stays open with its first-attempt
 * assertion retained as a canary. This is a route around a dependency defect,
 * with the route asserted — which S3 says is what closure looks like when the
 * explanation may never come.
 */

export interface EventListCallbacks {
  /** Same handler the marker click uses. Not a copy of it — the same one. */
  onActivate(cluster: EventCluster): void;
}

/**
 * Build the list's markup from exactly the clusters the globe rendered.
 *
 * Exported for rule 32 and for the equivalence test: the assertion that matters
 * is that this function is handed the same array `pointsData` was, and drops
 * nothing from it.
 */
export function eventListHtml(clusters: readonly EventCluster[]): string {
  if (clusters.length === 0) {
    return `<section class="rail-section event-list">
      <h2>Events</h2>
      <p class="event-list-empty">No events are on the globe with the current layers and
      filters. That is a statement about the filters, not about the world.</p>
    </section>`;
  }

  const rows = clusters
    .map((cluster, index) => {
      /**
       * The cluster's OWN representative, not `members[0]`.
       *
       * `representative` is the member the marker's position and size come
       * from. Picking the first member instead would make a list entry describe
       * a different event from the marker it claims to duplicate — which is
       * precisely the equivalence this list exists to provide.
       */
      const shown = cluster.representative;

      /**
       * The count is rendered when a marker stands for several events, because
       * the marker itself does not say so — and a reader picking from this list
       * is choosing where to fly, which is a different decision when one point
       * is six overlapping ones. This is also L9's neighbouring cause: the
       * pick that lands on the wrong marker is a clustering problem too.
       */
      const extra =
        cluster.members.length > 1
          ? `<span class="event-count">+${n(cluster.members.length - 1, 'other events sharing this marker, a property of this app\'s clustering rather than a figure from any source')}</span>`
          : '';

      const stale =
        shown.stale && shown.staleDays !== undefined
          ? `<span class="event-stale">${n(shown.staleDays, 'days since this event was reported, computed by this app from the report date it carries')}d old</span>`
          : '';

      /**
       * The position goes through `factHtml`, not through `formatPosition`.
       *
       * The fact-discipline guard caught the first draft doing the latter, and
       * it was right to: a coordinate here IS a fact. `positionFact` carries
       * the tier and, more importantly, the measured-versus-derived-centroid
       * distinction — a country-level event has no real coordinate, and its
       * marker sits on a centroid this app computed. Rendering the bare string
       * would strip exactly the badge that says so.
       */
      return `<li>
        <button type="button" class="event-entry"
          data-event-index="${n(index, 'position of this entry in the rendered list, a DOM addressing detail used to resolve the click back to its cluster')}">
          <span class="event-swatch" style="background:${colorFor(shown.layer)}"></span>
          <span class="event-title">${escapeHtml(shown.title)}</span>
          <span class="event-where">${factHtml(shown.positionFact, { hideAsOf: true })}</span>
          ${extra}
          ${stale}
        </button>
      </li>`;
    })
    .join('');

  return `<section class="rail-section event-list">
    <h2>Events</h2>
    <p class="event-list-note">Every marker on the globe is listed here. Use this rather than
    clicking the globe if a marker does not respond.</p>
    <ul class="event-entries">${rows}</ul>
  </section>`;
}

/**
 * Wire the list to the same action a marker click performs.
 *
 * The index is carried in a data attribute and resolved against the SAME array
 * that produced the markup, so an entry cannot drift onto a different event
 * between render and click.
 */
export function mountEventList(
  root: HTMLElement,
  clusters: () => readonly EventCluster[],
  callbacks: EventListCallbacks,
): void {
  root.addEventListener('click', (event) => {
    const entry = (event.target as HTMLElement).closest<HTMLElement>('[data-event-index]');
    if (!entry) return;
    const index = Number(entry.dataset['eventIndex']);
    const cluster = clusters()[index];
    /**
     * A missing cluster is a bug, not a user action, and doing nothing quietly
     * is how a broken list looks identical to an empty one. It throws so the
     * page error surfaces in the suite's "no uncaught page errors" check.
     */
    if (!cluster) throw new Error(`event list: no cluster at index ${index}`);
    callbacks.onActivate(cluster);
  });
}
