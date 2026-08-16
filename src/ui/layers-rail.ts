import { BAND_ENCODING } from '../coverage';
import { renderWatchlist } from './watchlist';

/**
 * The scrub's travel.
 *
 * `SCRUB_MAX` is the present. The floor is a round year rather than the seed's
 * earliest coverage because the seed's own floor moves whenever a finding is
 * added, and a control whose range silently changes with the data is one whose
 * shared links stop meaning the same thing.
 */
export const SCRUB_MIN = 1990;
export const SCRUB_MAX = new Date().getUTCFullYear();
import { escapeHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import { magnitudeLegend, type EventCluster, type GlobeEvent } from '../layers/events';
import { LAYERS, unregisteredLayers } from '../layers/provider';
import type { Store } from '../state';

/**
 * Layer toggles, counts and the magnitude key.
 *
 * The legend is not decoration. Marker size encodes magnitude on a bounded
 * scale — it is not proportional to energy, area or damage — and without a key
 * a reader will estimate values from dot sizes, which is a precision the
 * encoding does not carry.
 */

function n(value: number, reason: string): string {
  return notAFact(value, reason);
}

export interface LayerCounts {
  /** Events available per layer before filtering. */
  total: Map<string, number>;
  /** Events actually rendered per layer after filtering. */
  rendered: Map<string, number>;
  staleHidden: number;
  clusteredAway: number;
}

export function countLayers(
  all: readonly GlobeEvent[],
  rendered: readonly GlobeEvent[],
  clusters: readonly EventCluster[],
): LayerCounts {
  const total = new Map<string, number>();
  const renderedByLayer = new Map<string, number>();
  for (const event of all) total.set(event.layer, (total.get(event.layer) ?? 0) + 1);
  for (const event of rendered) renderedByLayer.set(event.layer, (renderedByLayer.get(event.layer) ?? 0) + 1);

  return {
    total,
    rendered: renderedByLayer,
    staleHidden: all.filter((event) => event.stale).length,
    clusteredAway: rendered.length - clusters.length,
  };
}

export function mountLayersRail(root: HTMLElement, store: Store, counts: () => LayerCounts, all: () => GlobeEvent[]): void {
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const layer = target.closest<HTMLElement>('[data-layer]')?.dataset['layer'];
    if (layer) {
      store.toggleLayer(layer);
      return;
    }
    if (target.closest('[data-stale-toggle]')) {
      store.setIncludeStale(!store.state.includeStale);
      return;
    }
    if (target.closest('[data-coverage-toggle]')) {
      store.setCoverageMode(!store.state.coverageMode);
      return;
    }
    if (target.closest('[data-scrub-reset]')) {
      store.setAsOfYear(null);
    }
  });

  /**
   * The scrub listens for `input`, not `click` or `change`.
   *
   * A range fires `input` while dragging and `change` on release. `click` would
   * move the view only where the pointer landed, which reads as broken;
   * `change` would skip every intermediate year, which is the point of a scrub.
   *
   * This only works because the rail no longer rebuilds on every commit — a
   * control that destroyed itself on its own first event could not be dragged
   * at all, which is why this shipped one commit after that fix rather than
   * beside it.
   */
  root.addEventListener('input', (event) => {
    const range = (event.target as HTMLElement).closest<HTMLInputElement>('[data-scrub]');
    if (!range) return;
    const year = Number(range.value);
    // The top of the travel IS the present, and the present is null — so
    // scrubbing back to the end clears the caveat rather than pinning it to
    // this year.
    store.setAsOfYear(year >= SCRUB_MAX ? null : year);
  });

  /**
   * ## Rebuild only when the markup actually changes
   *
   * This rail used to replace its entire `innerHTML` on EVERY store commit —
   * including hover, which fires continuously as a pointer crosses the globe.
   * The rail's content does not depend on hover or on selection, so almost
   * every one of those rebuilds produced identical markup and threw away live
   * DOM to do it.
   *
   * That is not merely wasteful, it is the cause of a class of failure:
   *
   *   - a click can land on a node that is replaced before it resolves —
   *     rule 35's replaced-DOM-node failure, which cost a day when it first
   *     appeared on the economy tab
   *   - a focused control loses focus mid-interaction
   *   - a range input cannot be dragged at all, because it is destroyed on the
   *     first `input` event it fires
   *
   * The last one is why step 13's time scrub could not ship beside this rail.
   * Comparing the markup first is the smallest fix that removes the cause
   * rather than widening a timeout around it.
   */
  let lastHtml = '';

  store.subscribe((state) => {
    const layerCounts = counts();
    const orphans = unregisteredLayers(all());

    const html = `
      <section class="rail-section">
        <h2>Globe layers</h2>
        <ul class="layer-list">
          ${LAYERS.map((layer) => {
            const on = state.layers.has(layer.id);
            const rendered = layerCounts.rendered.get(layer.id) ?? 0;
            const total = layerCounts.total.get(layer.id) ?? 0;
            return `<li>
              <button type="button" class="layer-toggle${on ? ' layer-toggle--on' : ''}"
                data-layer="${escapeHtml(layer.id)}" aria-pressed="${on}">
                <span class="layer-swatch" style="background:${layer.color}"></span>
                <span class="layer-label">${escapeHtml(layer.label)}</span>
                <span class="layer-count">${n(
                  on ? rendered : 0,
                  'count of markers this layer currently contributes to the globe',
                )}<span class="layer-count-total">/${n(
                  total,
                  'count of events available in this layer before filtering',
                )}</span></span>
              </button>
            </li>`;
          }).join('')}
        </ul>

        <button type="button" class="layer-stale${state.includeStale ? ' layer-stale--on' : ''}"
          data-stale-toggle aria-pressed="${state.includeStale}">
          ${state.includeStale ? 'Hiding nothing' : 'Hiding'} ${n(
            layerCounts.staleHidden,
            'count of events flagged stale by the staleness policy',
          )} stale event(s)
        </button>
        <p class="rail-help">An event still marked "open" but not updated for six months
        is a data-quality artifact, not something happening now. Stale events are kept and
        labelled, never deleted.</p>

        <button type="button" class="coverage-toggle${state.coverageMode ? ' coverage-toggle--on' : ''}"
          data-coverage-toggle aria-pressed="${state.coverageMode}">
          ${state.coverageMode ? 'Showing our coverage gaps' : 'Show our coverage gaps'}
        </button>
        ${
          state.coverageMode
            ? `<div class="coverage-legend">
                <p class="rail-help"><strong>[DERIVED]</strong> This colours countries by how many
                of this app's own panels have anything for them. It is a map of our gaps, not of
                the world.</p>
                <ul class="coverage-key">
                  ${(['good', 'partial', 'sparse', 'none'] as const)
                    .map(
                      (band) => `<li>
                        <span class="coverage-swatch" style="background:${BAND_ENCODING[band].fill}"></span>
                        <span class="coverage-band">${escapeHtml(BAND_ENCODING[band].label)}</span>
                        <span class="coverage-meaning">${escapeHtml(BAND_ENCODING[band].meaning)}</span>
                      </li>`,
                    )
                    .join('')}
                  <li>
                    <span class="coverage-swatch coverage-swatch--unassessed"></span>
                    <span class="coverage-band">Not assessed</span>
                    <span class="coverage-meaning">No panel was checked. Not a score of zero.</span>
                  </li>
                </ul>
              </div>`
            : ''
        }

        <div class="scrub">
          <label class="scrub-label" for="scrub-year">Score relations as of</label>
          <input type="range" id="scrub-year" class="scrub-range" data-scrub
            min="${n(SCRUB_MIN, 'earliest year this control travels to — a property of the control, not a value from any source')}"
            max="${n(SCRUB_MAX, 'the present year, this control\'s upper bound rather than a figure about the world')}"
            step="1"
            value="${n(state.asOfYear ?? SCRUB_MAX, 'current position of the scrub, which is UI state rather than a measurement')}">
          <div class="scrub-value">${
            state.asOfYear === null
              ? 'now'
              : n(state.asOfYear, 'the year relations are being scored as of — a control position, not a figure from any source')
          }</div>
          ${
            state.asOfYear === null
              ? ''
              : '<button type="button" class="scrub-reset" data-scrub-reset>Back to now</button>'
          }
          <p class="rail-help">Shows what this app's PRESENT evidence says about that year.
          Not what was known then, and not a claim about what was true.</p>
        </div>

        ${
          layerCounts.clusteredAway > 0
            ? `<p class="rail-help">${n(
                layerCounts.clusteredAway,
                'count of markers merged into clusters, each still listed in its cluster tooltip',
              )} marker(s) merged into clusters. Nothing is dropped — every member is listed
               in its cluster's tooltip.</p>`
            : ''
        }

        ${
          orphans.length > 0
            ? `<p class="rail-warn">${n(
                orphans.length,
                'count of event categories with no registered layer, which would otherwise be unrenderable and invisible',
              )} event categor(ies) have no registered layer and are not rendered:
               ${escapeHtml(orphans.join(', '))}. Surfaced rather than dropped.</p>`
            : ''
        }
      </section>

      <section class="rail-section">
        <h2>Magnitude key</h2>
        <ul class="mag-legend">
          ${magnitudeLegend()
            .map(
              (step) => `<li>
                <span class="mag-dot" style="width:${n(
                  Math.round(step.radius * 34),
                  'legend dot diameter in pixels, scaled from the marker radius purely for display',
                )}px;height:${n(
                  Math.round(step.radius * 34),
                  'legend dot diameter in pixels, scaled from the marker radius purely for display',
                )}px"></span>
                <span>M${n(step.magnitude, 'magnitude value this legend step illustrates')}</span>
              </li>`,
            )
            .join('')}
        </ul>
        <p class="rail-help">Size encodes magnitude on a bounded scale. It is not
        proportional to energy, area or damage — read values from the tooltip, not
        from the dot.</p>
      </section>

      ${renderWatchlist()}`;

    /**
     * The guard itself. Identical markup means nothing a reader can see has
     * changed, so replacing the DOM would only destroy focus, selection and
     * any interaction in flight.
     */
    if (html === lastHtml) return;
    lastHtml = html;
    root.innerHTML = html;
  });
}
