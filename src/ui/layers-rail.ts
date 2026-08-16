import { BAND_ENCODING } from '../coverage';
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
    }
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
      </section>`;

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
