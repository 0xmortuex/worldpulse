import './styles.css';
import { countryByCode, loadCountries } from './countries';
import { mountInspector } from './facts/inspector';
import { mountGallery } from './dev/gallery';
import { CountryGlobe, type PolygonStyle } from './globe';
import { factHtml } from './facts/badge';
import { notAFact } from './facts/discipline';
import {
  clusterEvents,
  CLUSTER_RADIUS_KM,
  radiusForMagnitude,
  type EventCluster,
  type GlobeEvent,
} from './layers/events';
import { colorFor, filterEvents, loadEvents } from './layers/provider';
import { countLayers, mountLayersRail } from './ui/layers-rail';
import { buildFindings, loadFacts } from './relations/facts';
import { pairKey, score } from './relations/score';
import type { RelationResult } from './relations/types';
import { Store } from './state';
import { BASE_STROKE, SELECTION_COLOR, SELECTION_STROKE, TIER_COLORS, TIER_COLORS_LOW_CONFIDENCE } from './theme';
import { mountEconomyTab, setEconScenario } from './ui/economy';
import type { ScenarioName } from './fetch/scenario';
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

/** Above every polygon altitude, so markers are never buried by a selection. */
const EVENT_ALTITUDE = 0.03;

const now = new Date();
const allEvents: GlobeEvent[] = loadEvents(now);
let renderedEvents: GlobeEvent[] = [];
let renderedClusters: EventCluster[] = [];

const globeContainer = must<HTMLElement>('#globe');
const globe = new CountryGlobe(globeContainer, countries, {
  onSelect: (code, additive) => (additive ? store.toggle(code) : store.select(code)),
  onHover: (code) => store.setHovered(code),
  onEventClick: (cluster) => {
    // Fly to the marker's real coordinate, which is the strongest member's
    // position — never a cluster average.
    globe.flyTo(cluster.lat, cluster.lng, 1000);
  },
});

mountLayersRail(
  must<HTMLElement>('#layers'),
  store,
  () => countLayers(allEvents, renderedEvents, renderedClusters),
  () => allEvents,
);
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

  renderedEvents = filterEvents(allEvents, { enabled: state.layers, includeStale: state.includeStale });
  renderedClusters = clusterEvents(renderedEvents);
  globe.setEvents(renderedClusters, (cluster) => ({
    radius: radiusForMagnitude(cluster.representative.magnitude),
    color: colorFor(cluster.representative.layer),
    // Must clear the TALLEST polygon altitude (a selected country sits at
    // 0.018). Below that, the selected country's own raised polygon intercepts
    // the ray and every event inside it becomes unclickable — visible, and
    // unopenable, which is the worst combination.
    altitude: EVENT_ALTITUDE,
    label: eventTooltip(cluster),
  }));

  renderModeIndicator(state.selected.length);
});

/**
 * Marker tooltip.
 *
 * Carries the event id so a browser check can pick a point and read back WHICH
 * event it hit, rather than merely that something was hit. Every cluster member
 * is listed, so clustering never makes an event unreachable.
 */
function eventTooltip(cluster: EventCluster): string {
  const lead = cluster.representative;
  const derived =
    lead.positionKind === 'derived-centroid'
      ? `<div class="evt-derived"><span class="badge badge--derived">ƒ DERIVED</span>
         Marker is the centroid of a ${notAFact(
           lead.perimeterVertices ?? 0,
           "provenance metadata: how many vertices the discarded perimeter had, shown so the reader can judge how coarse this dot is. It describes the marker's position rather than being a measurement of the event",
         )}-vertex perimeter, not the
         event's location. The real extent is an area this dot does not show.</div>`
      : '';

  const stale = lead.stale
    ? `<div class="evt-stale">Still flagged open, but not updated for ${notAFact(
        lead.staleDays ?? '?',
        'age of the record, counted from the event timestamp already shown above — describes how current the fact is rather than being one',
      )} days.
       Treat as a data-quality artifact rather than a live event.</div>`
    : '';

  const others =
    cluster.members.length > 1
      ? `<div class="evt-members"><strong>${notAFact(
          cluster.members.length,
          'count of markers merged into this cluster, every one of which is listed below with its own badge',
        )} events within
         ${notAFact(
           CLUSTER_RADIUS_KM,
           "this app's clustering radius — a rendering threshold chosen here, not a property of the events",
         )} km.</strong> The marker sits on the strongest, at its real coordinate.
         <ul>${cluster.members
           .map(
             (member) =>
               `<li data-event-id="${member.id}">${magnitudeHtml(member, true)}
                · ${escapeForLabel(member.title)}</li>`,
           )
           .join('')}</ul></div>`
      : '';

  return `<div class="evt" data-event-id="${cluster.id}">
    <div class="evt-title">${escapeForLabel(lead.title)}</div>
    <div class="evt-meta">${magnitudeHtml(lead, false)}
      · ${escapeForLabel(lead.time.slice(0, 16).replace('T', ' '))}Z</div>
    <div class="evt-coords">${factHtml(lead.positionFact, { compact: true, hideAsOf: true })}</div>
    ${derived}${stale}${others}
  </div>`;
}

/**
 * The magnitude, badged.
 *
 * It used to render as `M${event.magnitude}` — a USGS measurement with its
 * confidence stripped off, so an unreviewed automatic solution and an
 * analyst-reviewed one printed identically. The badge is the whole point of the
 * app; a tooltip is not an exemption from it.
 *
 * Layers with no comparative magnitude have no `magnitudeFact`, which is a
 * different statement from a quake whose magnitude is null — that one renders
 * "no data" with its provenance intact.
 *
 * An EONET event may still carry a `measurement`: a unit-bearing figure NASA
 * publishes (burned hectares, wind knots). It renders as value + unit and never
 * as a bare number, because the unit is what makes it a measurement rather than
 * a quantity to be compared with the next one. See decision L8.
 */
function magnitudeHtml(event: GlobeEvent, compact: boolean): string {
  if (!event.magnitudeFact) {
    if (event.measurement) {
      return (
        `${factHtml(event.measurement.fact, { compact, hideAsOf: true })} ` +
        `<span class="evt-unit">${escapeForLabel(event.measurement.unit)}</span>`
      );
    }
    return `<span class="evt-nomag">no magnitude</span> · <span class="evt-tier">${escapeForLabel(event.tier)}</span>`;
  }
  // No "M" label: the fact's unit is the magnitude type USGS actually used
  // (mww, mb, ml), which says more than a generic M and is the notation
  // seismologists write.
  return factHtml(event.magnitudeFact, { compact, hideAsOf: true });
}

function escapeForLabel(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&#39;',
  );
}

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
        : `Compare mode · ${notAFact(
            count,
            'number of countries the user has selected — UI state, not data about the world',
          )} countries`;
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

/**
 * Verification surface.
 *
 * Exposed so browser checks can read back WHICH event a marker resolves to, and
 * whether the camera actually moved — rather than inferring either from the
 * renderer's own projection, which would only prove it agrees with itself.
 * Read-only: nothing here mutates state.
 */
declare global {
  interface Window {
    __worldpulse: {
      pointOfView(): { lat: number; lng: number; altitude: number };
      facesCamera(lat: number, lng: number): boolean;
      screenCoordsOf(id: string): { x: number; y: number } | null;
      focusCluster(id: string, offsetLat?: number, offsetLng?: number): boolean;
      frontFacingClusterId(): string | null;
      backFacingClusterId(): string | null;
      eventById(id: string): { lat: number; lng: number } | null;
      clusterFor(id: string): { id: string; memberCount: number } | null;
      tooltipFor(id: string): string | null;
      /** Swap the economy panel's fetch scenario without reloading the page. */
      setEconScenario(scenario: ScenarioName | null): void;
      counts(): {
        rendered: number;
        clusters: number;
        clusteredAway: number;
        staleHidden: number;
        byLayer: Record<string, number>;
      };
    };
  }
}

/**
 * getScreenCoords is relative to the globe container; a pointer needs page
 * coordinates. Converting here keeps the offset in one place.
 */
function pageCoords(lat: number, lng: number): { x: number; y: number } {
  const local = globe.screenCoords(lat, lng, EVENT_ALTITUDE);
  const rect = globeContainer.getBoundingClientRect();
  return { x: rect.left + local.x, y: rect.top + local.y };
}

function onScreen(lat: number, lng: number): boolean {
  const { x, y } = pageCoords(lat, lng);
  const margin = 24;
  return (
    x > margin && y > margin && x < window.innerWidth - margin && y < window.innerHeight - margin
  );
}

window.__worldpulse = {
  setEconScenario,
  pointOfView: () => globe.pointOfView(),
  facesCamera: (lat, lng) => globe.facesCamera(lat, lng),
  /**
   * The most central visible marker, for a browser check to aim at.
   *
   * "Front facing" alone is not enough: a marker can face the camera, project
   * inside the canvas, and still sit on the limb where it is a sliver and
   * effectively unpickable. Sorting by angular distance from the camera's
   * sub-point aims at the marker most squarely in view.
   */
  frontFacingClusterId: () => {
    const view = globe.pointOfView();
    const toRad = (deg: number): number => (deg * Math.PI) / 180;
    const centrality = (cluster: EventCluster): number =>
      Math.sin(toRad(cluster.lat)) * Math.sin(toRad(view.lat)) +
      Math.cos(toRad(cluster.lat)) * Math.cos(toRad(view.lat)) * Math.cos(toRad(cluster.lng - view.lng));

    const visible = renderedClusters
      .filter((cluster) => globe.facesCamera(cluster.lat, cluster.lng) && onScreen(cluster.lat, cluster.lng))
      .sort((a, b) => centrality(b) - centrality(a));
    return visible[0]?.id ?? null;
  },
  backFacingClusterId: () =>
    renderedClusters.find((cluster) => !globe.facesCamera(cluster.lat, cluster.lng))?.id ?? null,
  /**
   * Point the camera at a cluster so a check can aim at it squarely.
   *
   * The offsets exist for the camera-movement check: it must start from a
   * position that is NOT the target, or a flyTo that no-ops proves nothing.
   */
  focusCluster: (id, offsetLat = 0, offsetLng = 0) => {
    const cluster = renderedClusters.find((candidate) => candidate.id === id);
    if (!cluster) return false;
    globe.flyTo(cluster.lat + offsetLat, cluster.lng + offsetLng, 0);
    return true;
  },
  screenCoordsOf: (id) => {
    const cluster = renderedClusters.find((candidate) => candidate.id === id);
    return cluster ? pageCoords(cluster.lat, cluster.lng) : null;
  },
  eventById: (id) => {
    const event = allEvents.find((candidate) => candidate.id === id);
    return event ? { lat: event.lat, lng: event.lng } : null;
  },
  clusterFor: (id) => {
    const cluster = renderedClusters.find((candidate) =>
      candidate.members.some((member) => member.id === id),
    );
    return cluster ? { id: cluster.id, memberCount: cluster.members.length } : null;
  },
  tooltipFor: (id) => {
    const cluster = renderedClusters.find((candidate) => candidate.id === id);
    return cluster ? eventTooltip(cluster) : null;
  },
  counts: () => {
    const byLayer: Record<string, number> = {};
    for (const event of renderedEvents) byLayer[event.layer] = (byLayer[event.layer] ?? 0) + 1;
    return {
      rendered: renderedEvents.length,
      clusters: renderedClusters.length,
      clusteredAway: renderedEvents.length - renderedClusters.length,
      staleHidden: allEvents.filter((event) => event.stale).length,
      byLayer,
    };
  },
};

// Open on the default selection so the app never renders an empty first frame.
globe.flyTo(38, -97, 0);
