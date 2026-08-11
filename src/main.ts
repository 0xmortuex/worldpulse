import './styles.css';
import { countryByCode, loadCountries } from './countries';
import { mountInspector } from './facts/inspector';
import { mountGallery } from './dev/gallery';
import { CountryGlobe, type PolygonStyle } from './globe';
import { buildFindings, loadFacts } from './relations/facts';
import { pairKey, score } from './relations/score';
import type { RelationResult } from './relations/types';
import { Store } from './state';
import { BASE_STROKE, SELECTION_COLOR, SELECTION_STROKE, TIER_COLORS, TIER_COLORS_LOW_CONFIDENCE } from './theme';
import { mountEconomyTab } from './ui/economy';
import { mountGovernmentTab } from './ui/government';
import { mountNewsTab } from './ui/news';
import { mountDossierHeader } from './ui/header';
import { mountLeaderSheet } from './ui/leader-sheet';
import { mountPanel } from './ui/panel';
import { plainPopover, relationPopover } from './ui/popover';
import { mountRail } from './ui/rail';
import { mountSearch } from './ui/search';

const countries = loadCountries();
const byCode = countryByCode(countries);
const facts = loadFacts();
const findings = buildFindings(facts);

// Injected rather than read inside the engine so the time scrub in step 13 can
// score a pair as of a past date without touching the scoring module.
const currentYear = new Date().getFullYear();

const store = new Store();

mountInspector(document.body);

const globeContainer = must<HTMLElement>('#globe');
const globe = new CountryGlobe(globeContainer, countries, {
  onSelect: (code, additive) => (additive ? store.toggle(code) : store.select(code)),
  onHover: (code) => store.setHovered(code),
});

mountSearch(must<HTMLElement>('#search'), store, countries);
mountRail(must<HTMLElement>('#rail'), store);
const panelRoot = must<HTMLElement>('#panel');
const openLeaderSheet = mountLeaderSheet(
  document.body,
  countries.map((country) => country.code),
  (code) => byCode.get(code)?.name ?? code,
);
mountDossierHeader(panelRoot, openLeaderSheet);
mountGovernmentTab(panelRoot);
// Re-render through the store so the economy toggle takes the same path as
// every other state change rather than mutating the DOM behind the panel.
mountEconomyTab(panelRoot, () => store.refresh());
mountNewsTab(panelRoot, () => store.refresh());
mountPanel(panelRoot, store, {
  byCode,
  findings,
  currentYear,
  compiledAt: facts.compiledAt,
  today: new Date(),
});
mountGallery(must<HTMLElement>('#gallery'), store);
mountSeedBanner(must<HTMLElement>('#seed-banner'), facts);

store.subscribe((state) => {
  const styles = new Map<string, PolygonStyle>();
  const selected = new Set(state.selected);

  // Relations mode is single-selection only: "ally of these three countries"
  // has no agreed meaning, and inventing one would be exactly the kind of
  // confident guess this app is built to avoid.
  const subjectCode = state.selected.length === 1 ? state.selected[0] : undefined;
  const subject = subjectCode ? byCode.get(subjectCode) : undefined;

  for (const country of countries) {
    const isSelected = selected.has(country.code);
    const isHovered = state.hovered === country.code;

    let cap = TIER_COLORS.nodata;
    let label = plainPopover(country);

    if (subject && country.code !== subject.code) {
      const result: RelationResult = score(
        subject.code,
        country.code,
        findings.get(pairKey(subject.code, country.code)),
        state.weights,
        state.thresholds,
        currentYear,
      );
      const palette = result.lowConfidence ? TIER_COLORS_LOW_CONFIDENCE : TIER_COLORS;
      cap = palette[result.tier];
      label = relationPopover(country, subject, result, facts.compiledAt);
    } else if (!subject) {
      cap = TIER_COLORS.neutral;
    }

    if (isSelected) cap = SELECTION_COLOR;

    styles.set(country.code, {
      cap,
      side: isSelected ? SELECTION_COLOR : '#0f1216',
      stroke: isSelected ? SELECTION_STROKE : isHovered ? '#8b949e' : BASE_STROKE,
      // Kept low deliberately: polygons are extruded radially, so a tall
      // altitude makes small territories near the limb (the Aleutians, for one)
      // project past the globe's silhouette and read as rendering artifacts.
      altitude: isSelected ? 0.018 : isHovered ? 0.012 : 0.006,
      label,
    });
  }

  globe.setStyles(styles);
  renderModeIndicator(state.selected.length);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) store.clear();
});

function renderModeIndicator(count: number): void {
  const node = must<HTMLElement>('#mode');
  node.textContent =
    count === 0
      ? 'No selection'
      : count === 1
        ? 'Relations mode'
        : `Compare mode · ${count} countries`;
  node.dataset['mode'] = count === 1 ? 'relations' : count > 1 ? 'compare' : 'none';
}

function mountSeedBanner(root: HTMLElement, factSet: ReturnType<typeof loadFacts>): void {
  if (!factSet.seed) {
    root.hidden = true;
    return;
  }
  root.innerHTML = `
    <strong>SEED DATA</strong>
    <span>Relations are computed from a small hand-checked fact table compiled
    ${factSet.compiledAt}, not from live sources. It exists so the interaction is
    provable before the pipeline lands in step 10. Coverage is deliberately partial —
    most countries will read as <em>no data</em>.</span>
    <details>
      <summary>What is not seeded</summary>
      <ul>${factSet.notSeeded.map((line) => `<li>${line}</li>`).join('')}</ul>
    </details>`;
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing required element: ${selector}`);
  return node;
}

// Open on the default selection so the app never renders an empty first frame.
globe.flyTo(38, -97, 0);
