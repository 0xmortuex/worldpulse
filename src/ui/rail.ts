import { INPUT_LABELS, signedWeight } from '../relations/score';
import type { InputKind, Tier, Weights } from '../relations/types';
import type { Store } from '../state';
import { SELECTION_COLOR, TIER_COLORS, TIER_COLORS_LOW_CONFIDENCE, TIER_DESCRIPTIONS, TIER_LABELS } from '../theme';
import { escapeHtml } from './popover';

const POSITIVE_KINDS: InputKind[] = [
  'sharedDefenseBloc',
  'bilateralDefenseTreaty',
  'intelSharing',
  'historicalAlliance',
  'sharedEconomicBloc',
];

const NEGATIVE_KINDS: InputKind[] = [
  'activeConflict',
  'severedRelations',
  'mutualSanctions',
  'oneWaySanctions',
  'territorialDispute',
  'recalledAmbassador',
];

const TIER_ORDER: Tier[] = ['ally', 'adversary', 'strained', 'neutral', 'nodata'];

export function mountRail(root: HTMLElement, store: Store): void {
  // Appended rather than assigned: the rail also hosts #gallery, and assigning
  // innerHTML here would delete it.
  const host = document.createElement('div');
  // Inserted before the gallery but after the layer rail, which mounts first.
  root.appendChild(host);
  host.innerHTML = `
    <section class="rail-section">
      <h2>Relation weights</h2>
      <p class="rail-help">Who counts as an ally is contested. These are this app's
      defaults, not a fact. Move a slider and the globe recolours immediately.</p>
      <div class="weight-group" data-group="positive">
        <h3>Draws together</h3>
        ${POSITIVE_KINDS.map(sliderMarkup).join('')}
      </div>
      <div class="weight-group" data-group="negative">
        <h3>Pushes apart</h3>
        ${NEGATIVE_KINDS.map(sliderMarkup).join('')}
      </div>
      <button type="button" class="rail-reset">Reset to defaults</button>
    </section>

    <section class="rail-section">
      <h2>Legend</h2>
      <ul class="legend">
        <li>
          <span class="swatch" style="background:${SELECTION_COLOR}"></span>
          <div>
            <strong>Selected</strong>
            <span>The country everything else is scored against. Outside the
            tier palette so it cannot be mistaken for a classification.</span>
          </div>
        </li>
        ${TIER_ORDER.map(
          (tier) => `
          <li>
            <span class="swatch" style="background:${TIER_COLORS[tier]}"></span>
            <div>
              <strong>${escapeHtml(TIER_LABELS[tier])}</strong>
              <span>${escapeHtml(TIER_DESCRIPTIONS[tier])}</span>
            </div>
          </li>`,
        ).join('')}
        <li>
          <span class="swatch swatch--split"
                style="background:linear-gradient(135deg, ${TIER_COLORS_LOW_CONFIDENCE.ally} 50%, ${TIER_COLORS_LOW_CONFIDENCE.adversary} 50%)"></span>
          <div>
            <strong>Low confidence</strong>
            <span>Muted variant. More than half the evidence weight comes from
            datasets over five years old.</span>
          </div>
        </li>
      </ul>
    </section>`;

  host.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((input) => {
    input.addEventListener('input', () => {
      store.setWeight(input.name as keyof Weights, Number(input.value));
    });
  });

  host.querySelector<HTMLButtonElement>('.rail-reset')?.addEventListener('click', () => {
    store.resetWeights();
  });

  store.subscribe((state) => {
    for (const [kind, value] of Object.entries(state.weights)) {
      const input = host.querySelector<HTMLInputElement>(`input[name="${kind}"]`);
      if (input && Number(input.value) !== value) input.value = String(value);
      const readout = host.querySelector<HTMLElement>(`[data-readout="${kind}"]`);
      if (readout) readout.textContent = signedWeight(value);
    }
  });
}

function sliderMarkup(kind: InputKind): string {
  return `
    <label class="weight">
      <span class="weight-label">${escapeHtml(INPUT_LABELS[kind])}</span>
      <input type="range" name="${kind}" min="-8" max="8" step="1" />
      <output data-readout="${kind}"></output>
    </label>`;
}
