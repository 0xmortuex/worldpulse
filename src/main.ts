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
  ringCentroid,
  type EventCluster,
  type GlobeEvent,
} from './layers/events';
import { arcsFor, largestRing } from './relations/arcs';
import { fromSearch, specifiesLayers, toSearch } from './url-state';
import { colorFor, filterEvents, loadEvents } from './layers/provider';
import { countLayers, mountLayersRail } from './ui/layers-rail';
import { eventListHtml, mountEventList } from './ui/event-list';
import { BAND_ENCODING, coverageFor, panelsWithDataFor, type CountryCoverage } from './coverage';
import { FIXTURE_COUNTRIES } from './dossier/provider';
import { GOVERNMENT_COUNTRIES } from './dossier/government-provider';
import { ECONOMY_COUNTRIES } from './dossier/economy-provider';
import { NEWS_COUNTRIES } from './dossier/news-provider';
import { fixtureCodes, loadMilitary } from './dossier/military-provider';
import { legislatureFor } from './dossier/legislature-provider';
import { tvListingFor } from './dossier/tv-provider';
import { buildFindings, loadFacts } from './relations/facts';
import { pairKey, score } from './relations/score';
import type { RelationResult } from './relations/types';
import { Store } from './state';
import { BASE_STROKE, SELECTION_COLOR, SELECTION_STROKE, TIER_COLORS, TIER_COLORS_LOW_CONFIDENCE } from './theme';
import { mountEconomyTab, setEconScenario } from './ui/economy';
import type { ScenarioName } from './fetch/scenario';
import { mountGovernmentTab } from './ui/government';
import { mountNewsTab } from './ui/news';
import { mountLegislatureTab } from './ui/legislature';
import { mountTour } from './ui/tour';
import { renderFlatMap, shouldAutoSwitch } from './ui/flatmap';
import { mountPalette } from './ui/palette';
import { mountDossierHeader } from './ui/header';
import { mountLeaderSheet } from './ui/leader-sheet';
import { mountPanel } from './ui/panel';
import { coveragePopover, plainPopover, relationPopover, unassessedPopover } from './ui/popover';
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

/**
 * Step 12's coverage assessment, computed once.
 *
 * Only countries a panel provider can actually be asked about are in this map.
 * Everything else is **absent**, which the renderer treats as *unassessed* —
 * deliberately distinct from a coverage score of zero.
 */
const assessedCountries = new Set<string>([
  ...FIXTURE_COUNTRIES,
  ...GOVERNMENT_COUNTRIES,
  ...ECONOMY_COUNTRIES,
  ...NEWS_COUNTRIES,
  ...fixtureCodes(),
]);

const coverageByCountry = new Map<string, CountryCoverage>(
  countries
    .filter((country) => assessedCountries.has(country.code))
    .map((country) => [
      country.code,
      coverageFor({
        iso3: country.code,
        panelsWithData: panelsWithDataFor({
          dossier: FIXTURE_COUNTRIES.includes(country.code),
          government: GOVERNMENT_COUNTRIES.includes(country.code),
          legislature: legislatureFor(country.code).chambers.length > 0,
          military: loadMilitary(country.code) !== null,
          economy: ECONOMY_COUNTRIES.includes(country.code),
          news: NEWS_COUNTRIES.includes(country.code),
          tv: tvListingFor(country.code).channels.length > 0,
        }),
      }),
    ]),
);

/**
 * Darker than every band, deliberately.
 *
 * "Unassessed" must not read as a low score — it is not on the scale at all,
 * and a colour that sits just below "Nothing" would put it there.
 */
const UNASSESSED_FILL = '#1a1a20';

/**
 * Where a country's arc terminates, resolved from the same geometry the
 * polygons are drawn from and cached because it never changes.
 */
const centroidCache = new Map<string, { lat: number; lng: number } | null>();

function centroidOf(iso3: string): { lat: number; lng: number } | null {
  const cached = centroidCache.get(iso3);
  if (cached !== undefined) return cached;

  const country = byCode.get(iso3);
  const geometry = country?.feature.geometry;
  let result: { lat: number; lng: number } | null = null;

  if (geometry) {
    const rings =
      geometry.type === 'Polygon'
        ? (geometry.coordinates as Array<Array<[number, number]>>)
        : (geometry.coordinates as Array<Array<Array<[number, number]>>>).flat();
    const ring = largestRing(rings);
    if (ring) result = ringCentroid(ring);
  }

  centroidCache.set(iso3, result);
  return result;
}
let renderedEvents: GlobeEvent[] = [];
let renderedClusters: EventCluster[] = [];
/** See the event-list rebuild guard below — L9's keyboard route depends on it. */
let lastEventListHtml = '';
/** See the marker rebuild guard — hovering a country must not touch the points layer. */
let lastMarkerSignature = '';

/**
 * Phase C.1 flat-map state. `flatAutoReason` is non-null only when the app
 * moved the reader itself, so a chosen map carries no switch notice — rule 42's
 * pair, applied to a mode rather than a caveat.
 */
let flatMapOn = false;
let flatAutoReason: string | null = null;

/**
 * Declared here, not at the mount site.
 *
 * `store.subscribe` invokes its listener IMMEDIATELY, so the render block runs
 * before any `const` declared below it has initialised — a temporal dead zone
 * that threw on load and took `__worldpulse` with it, which is how eight
 * assertions in three earlier steps failed at once. Nullable and checked, so
 * the render is correct whether or not the mount has happened yet.
 */
let flatRoot: HTMLElement | null = null;

const globeContainer = must<HTMLElement>('#globe');

/**
 * ONE handler, reached by two routes.
 *
 * L9's mitigation is only worth anything if the keyboard list does the same
 * thing the marker does. Two functions that "do the same thing" drift; this is
 * declared once and passed to both, so equivalence is structural rather than
 * maintained by hand.
 */
const openEvent = (cluster: EventCluster): void => {
  // Fly to the marker's real coordinate, which is the representative member's
  // position — never a cluster average.
  globe.flyTo(cluster.lat, cluster.lng, 1000);
};

const globe = new CountryGlobe(globeContainer, countries, {
  onSelect: (code, additive) => (additive ? store.toggle(code) : store.select(code)),
  onHover: (code) => store.setHovered(code),
  onEventClick: openEvent,
});

mountLayersRail(
  must<HTMLElement>('#layers'),
  store,
  () => countLayers(allEvents, renderedEvents, renderedClusters),
  () => allEvents,
);
/**
 * L9's keyboard route. Native `<button>` elements, so tab order, Enter and
 * Space come from the platform rather than from key handlers we would have to
 * get right.
 */
const eventListRoot = must<HTMLElement>('#event-list');
mountEventList(eventListRoot, () => renderedClusters, { onActivate: openEvent });

mountSearch(must<HTMLElement>('#search'), store, countries);
mountRail(must<HTMLElement>('#rail'), store);
const panelRoot = must<HTMLElement>('#panel');
const openLeaderSheet = mountLeaderSheet(
  document.body,
  countries.map((country) => country.code),
  (code) => byCode.get(code)?.name ?? code,
);
mountDossierHeader(panelRoot, openLeaderSheet);
mountGovernmentTab(panelRoot, () => store.refresh());
// Re-render through the store so the economy toggle takes the same path as
// every other state change rather than mutating the DOM behind the panel.
mountEconomyTab(panelRoot, () => store.refresh());
mountNewsTab(panelRoot, () => store.refresh());
mountLegislatureTab(() => store.refresh());
/**
 * Test seam for the SEED badge's absent-when-live state.
 *
 * The badge must be asserted in BOTH states — present while seeded, absent when
 * the live provider lands — and the live provider does not exist yet. Without a
 * seam the second assertion could only be written after the fact, which is how
 * a disclosure ends up with no test that it ever goes away.
 *
 * Deliberately narrow: it flips one boolean that already exists on the fact
 * set, and nothing reads it but the badge.
 */
let relationsSeededOverride: boolean | null = null;

mountPanel(panelRoot, store, {
  byCode,
  findings,
  currentYear,
  compiledAt: facts.compiledAt,
  today: new Date(),
  get relationsSeeded(): boolean {
    return relationsSeededOverride ?? facts.seed;
  },
});
/**
 * Step 13 / Phase B2 — the URL is the view.
 *
 * Applied once on load, then written on every change. `replaceState` rather
 * than `pushState`: a weight slider fires continuously, and every drag would
 * otherwise become a history entry a reader has to press Back through dozens of
 * times to escape.
 */
{
  const initial = fromSearch(window.location.search);
  store.hydrate({
    ...(initial.selected.length > 0 ? { selected: initial.selected } : {}),
    tab: initial.tab,
    weights: initial.weights,
    thresholds: initial.thresholds,
    includeStale: initial.includeStale,
    coverageMode: initial.coverageMode,
    asOfYear: initial.asOfYear,
    // Missing vs empty: only override the defaults when the URL actually said.
    ...(specifiesLayers(window.location.search) ? { layers: new Set(initial.layers) } : {}),
  });

  /**
   * `map=` is a rendering preference, not view state, so `toSearch` knows
   * nothing about it — and would drop it from the URL on the first render.
   * A shared `?map=flat` link that loses its own parameter the moment it opens
   * is a link that only works once, so it is carried across explicitly.
   */
  const askedMap = new URLSearchParams(window.location.search).get('map');
  const keepMap = askedMap === 'globe' || askedMap === 'flat' ? `map=${askedMap}` : '';

  store.subscribe((state) => {
    const search = [toSearch(state), keepMap].filter(Boolean).join('&');
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  });
}

mountGallery(must<HTMLElement>('#gallery'), store);
mountSeedBanner(must<HTMLElement>('#seed-banner'), facts);
/**
 * MODAL SURFACES LOAD ON FIRST USE, not at boot.
 *
 * The lists, intel feed, dashboard and command palette are each behind a
 * launcher, and none of them is on screen at first paint — but every byte of
 * them, and of the captures they import, was in the initial chunk. That chunk
 * reached 564.8 KB against a 570 KB budget, which meant the next surface could
 * not land at all.
 *
 * ## Why a click replay rather than an `open()` export
 *
 * Each surface mounts by attaching its own listener to its launcher. Mounting
 * on the first click means that click has already happened by the time the
 * listener exists, so the surface would stay shut until a second click — the
 * first one silently doing nothing, which is worse than a slow open.
 *
 * Replaying the click after mount keeps ONE code path: the surface opens
 * through exactly the handler every later click uses, rather than through a
 * separate first-time route that could drift from it. The guard makes the
 * replay a no-op here, so it reaches the newly attached listener and nothing
 * else.
 *
 * The tour is deliberately NOT lazy: it opens itself on a first visit, so
 * deferring it until a click would mean it never appears for the reader it
 * exists for.
 */
function lazyOnClick(launcher: HTMLElement, load: () => Promise<unknown>): () => Promise<unknown> {
  let loading: Promise<unknown> | null = null;
  const ensure = () => {
    loading ??= load();
    return loading;
  };

  launcher.addEventListener('click', (event) => {
    if (loading !== null) return;
    event.preventDefault();
    void ensure().then(() => {
      launcher.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  });

  /**
   * Returned so a caller that needs the surface PRESENT rather than merely
   * opening can wait for it. The palette's "List: …" commands do exactly that —
   * they click the launcher and then reach inside for a row, which used to be
   * safe because the surface was always mounted. It is not safe against a
   * dynamic import, and the fix is to await rather than to sleep.
   */
  return ensure;
}

mountTour(must<HTMLElement>('#tour'), must<HTMLElement>('#tour-launch'));

const ensureLists = lazyOnClick(must<HTMLElement>('#lists-launch'), async () => {
  const { mountLists } = await import('./ui/lists');
  mountLists(must<HTMLElement>('#lists'), must<HTMLElement>('#lists-launch'), now);
});

lazyOnClick(must<HTMLElement>('#intel-launch'), async () => {
  const { mountIntel } = await import('./ui/intel');
  mountIntel(must<HTMLElement>('#intel'), must<HTMLElement>('#intel-launch'), () => now.getTime());
});

/**
 * The dashboard, with real `localStorage` injected here and nowhere deeper.
 *
 * `src/ui/dashboard.ts` takes a `Store`, so its behaviour — including a storage
 * that throws on every call, which is what a blocked origin looks like — is
 * asserted without a browser.
 */
lazyOnClick(must<HTMLElement>('#dash-launch'), async () => {
  const { mountDashboard } = await import('./ui/dashboard');
  mountDashboard(
    must<HTMLElement>('#dash'),
    must<HTMLElement>('#dash-launch'),
    window.localStorage,
    () => Date.now(),
    { selectCountry: (code) => store.select(code) },
  );
});

flatRoot = must<HTMLElement>('#flatmap');
const flatToggle = must<HTMLElement>('#flat-launch');

/**
 * Phase C.6. Every action the palette can take is expressed as a store change
 * or an existing toggle — it navigates the app rather than reaching into it, so
 * a surface added later gains a command without gaining a special case here.
 */
mountPalette(must<HTMLElement>('#palette'), {
  selectCountry: (iso3) => store.select(iso3),
  openTab: (tab) => store.setTab(tab as never),
  openList: (list) => {
    // Await the surface rather than assuming it is mounted: it now loads on
    // demand, so reaching inside it synchronously would find an empty element.
    void ensureLists().then(() => {
      must<HTMLElement>('#lists-launch').click();
      must<HTMLElement>('#lists').querySelector<HTMLElement>(`[data-list="${list}"]`)?.click();
    });
  },
  runAction: (action) => {
    if (action === 'tour') must<HTMLElement>('#tour-launch').click();
    if (action === 'intel') must<HTMLElement>('#intel-launch').click();
    if (action === 'dash') must<HTMLElement>('#dash-launch').click();
    if (action === 'flat') must<HTMLElement>('#flat-launch').click();
    if (action === 'coverage') store.setCoverageMode(!store.state.coverageMode);
  },
});

/**
 * An EXPLICIT rendering preference, from the toggle or from `?map=`.
 *
 * The globe/flat choice is deliberately not part of the shared view state the
 * URL carries — 8c's caveat calls it "a rendering choice, not a change to the
 * data", and folding it in with weights and thresholds would contradict that.
 * But it is still worth being able to ask for, so `?map=globe` and `?map=flat`
 * are read directly and mean *the reader has decided*.
 *
 * Deciding suppresses the auto-switch. The switch exists to rescue a reader
 * who is watching a slideshow and has not asked for anything; overriding
 * someone who stated a preference is not a rescue, it is a contradiction — and
 * it would arrive four seconds in, on top of whatever they were doing.
 */
let flatMapChosen = false;
{
  const asked = new URLSearchParams(window.location.search).get('map');
  if (asked === 'globe' || asked === 'flat') {
    flatMapChosen = true;
    flatMapOn = asked === 'flat';
    flatToggle.setAttribute('aria-pressed', String(flatMapOn));
  }
}

flatToggle.addEventListener('click', () => {
  flatMapOn = !flatMapOn;
  flatMapChosen = true;
  // Choosing the map clears any auto-switch notice: the reader now knows.
  flatAutoReason = null;
  flatToggle.setAttribute('aria-pressed', String(flatMapOn));
  store.refresh();
});

/**
 * The auto-switch, measured once after the globe has had time to settle.
 *
 * A single early sample would catch the first-frame cost of building the globe
 * and move everyone to the flat map, so it waits — and a reading it cannot take
 * is INCONCLUSIVE rather than slow, per rule 3.
 */
setTimeout(() => {
  const fps = measuredFps();
  const decision = shouldAutoSwitch(fps);
  if (!decision.switch || flatMapOn || flatMapChosen) return;
  flatMapOn = true;
  flatAutoReason = decision.reason;
  flatToggle.setAttribute('aria-pressed', 'true');
  store.refresh();
}, 4000);

/** Frames observed over one second, or null when the page is hidden. */
function measuredFps(): number | null {
  if (typeof document !== 'undefined' && document.hidden) return null;
  return lastFpsSample;
}

let lastFpsSample: number | null = null;
{
  let frames = 0;
  let started = performance.now();
  const tick = () => {
    frames += 1;
    const elapsed = performance.now() - started;
    if (elapsed >= 1000) {
      lastFpsSample = (frames / elapsed) * 1000;
      frames = 0;
      started = performance.now();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

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

    if (state.coverageMode) {
      /**
       * Step 12. Coverage REPLACES the relations colouring rather than layering
       * over it, because the globe has one colour channel and two meanings in
       * it is question 12's problem — a reader cannot tell which one they are
       * looking at, and the map would be confidently ambiguous.
       */
      const assessment = coverageByCountry.get(country.code);
      if (assessment) {
        cap = BAND_ENCODING[assessment.band].fill;
        label = coveragePopover(country, assessment);
      } else {
        /**
         * Unassessed, which is NOT the "none" band. Painting it as "Nothing"
         * would assert a measurement nobody took, and on a map a filled polygon
         * reads as a result.
         */
        cap = UNASSESSED_FILL;
        label = unassessedPopover(country);
      }
    } else if (subject && country.code !== subject.code) {
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

  /**
   * Phase C.1 — the flat map is a PROJECTION of the same state, rendered from
   * the same style map the globe was just handed one line above. Not a second
   * model: two models eventually disagree, and a reader switching between them
   * would get two answers to one question.
   */
  if (flatRoot === null) {
    // The first render happens during mountPanel, before the flat map is
    // mounted. Nothing to draw yet, and nothing to fail over.
  } else if (flatMapOn) {
    flatRoot.hidden = false;
    flatRoot.innerHTML = renderFlatMap({
      countries,
      styles,
      clusters: renderedClusters,
      selected: state.selected,
      autoSwitchReason: flatAutoReason,
    });
  } else {
    flatRoot.hidden = true;
    flatRoot.innerHTML = '';
  }

  /**
   * ## The marker layer is rebuilt ONLY when the marker set changes
   *
   * This used to run on every commit — including `setHovered`, which fires as
   * a pointer crosses the globe. Re-assigning `pointsData` makes globe.gl
   * rebuild every point object and restart its transition, which produced three
   * reported symptoms from one cause:
   *
   *   - markers unclickable while a country is selected (mid-replacement)
   *   - markers blinking (the transition restarting)
   *   - hovering a COUNTRY visibly resetting the markers' animation
   *
   * MEASURED with `scripts/diagnose-points.mjs`: hovering across countries cost
   * a `pointsData` re-assignment, confirming the polygon hover path was
   * rebuilding the points layer. That is the reporter's hypothesis, and it was
   * right.
   *
   * The marker set depends on exactly two things — which layers are enabled and
   * whether stale events are included. Neither is touched by hover or by
   * selection, so a signature over them is sufficient and precise. The point
   * STYLE depends only on magnitude, layer and tooltip, none of which vary with
   * selection either, so skipping the re-assignment loses nothing.
   *
   * Same shape as the rail's rebuild guard and the event list's: the fix for a
   * wholesale rebuild is not a faster rebuild, it is not rebuilding.
   */
  const markerSignature = `${[...state.layers].sort().join(',')}|${state.includeStale}`;
  if (markerSignature !== lastMarkerSignature) {
    lastMarkerSignature = markerSignature;
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
  }

  /**
   * Rendered from the SAME array the globe was handed, one line later, so the
   * two cannot diverge. `tests/event-list-equivalence.test.ts` asserts the set
   * equality that makes this L9's mitigation rather than a partial listing.
   */
  /**
   * Rebuilt only when the markup changes — for L9's sake specifically.
   *
   * This list is the only working route to event detail on hardware where the
   * marker click fails, and it is keyboard-driven. Replacing its DOM on every
   * commit means a focused entry loses focus whenever the pointer crosses the
   * globe, which is exactly the interaction a keyboard user is in the middle of.
   */
  const listHtml = eventListHtml(renderedClusters);
  if (listHtml !== lastEventListHtml) {
    lastEventListHtml = listHtml;
    eventListRoot.innerHTML = listHtml;
  }

  /**
   * Step 12's arcs, built from the SAME results the panel lists.
   *
   * Not from a second scoring pass — the arc and the relation row are one claim
   * rendered twice, and two computations of one claim eventually disagree.
   *
   * Coverage mode clears them: that mode repaints every polygon to mean
   * something else, and leaving relation arcs over it would put two unrelated
   * claims in one picture.
   */
  if (subject && !state.coverageMode) {
    const results = countries
      .filter((country) => country.code !== subject.code)
      .map((country) =>
        score(
          subject.code,
          country.code,
          findings.get(pairKey(subject.code, country.code)),
          state.weights,
          state.thresholds,
          currentYear,
        ),
      );

    globe.setArcs(
      arcsFor(results, {
        subjectName: subject.name,
        nameOf: (iso3) => byCode.get(iso3)?.name ?? iso3,
      })
        .map((arc) => {
          const from = centroidOf(arc.subject);
          const to = centroidOf(arc.other);
          // A country whose geometry we cannot resolve gets no arc rather than
          // an arc to (0,0) — the Gulf of Guinea is where bad coordinates go.
          if (!from || !to) return null;
          return {
            startLat: from.lat,
            startLng: from.lng,
            endLat: to.lat,
            endLng: to.lng,
            color: arc.color,
            stroke: arc.stroke,
            dashed: arc.dashed,
            label: arc.label,
          };
        })
        .filter((arc): arc is NonNullable<typeof arc> => arc !== null),
    );
  } else {
    globe.setArcs([]);
  }

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
      /**
       * L9's mitigation is a SET EQUALITY claim, and a unit test can only
       * compare the list function against an array it was handed itself. These
       * two expose what the globe actually received, so the browser can compare
       * the rendered DOM against it.
       */
      clusterCount(): number;
      /** How many times pointsData has been re-assigned. See globe.setEvents. */
      pointsAssignments(): number;
      firstClusterPosition(): { lat: number; lng: number } | null;
      /**
       * Park the camera somewhere known before testing that an interaction
       * moves it. Without this the keyboard-route assertion can start with the
       * camera already ON its target and read a correct fly as "did not move".
       */
      parkCamera(lat: number, lng: number): void;
      tooltipFor(id: string): string | null;
      /** Swap the economy panel's fetch scenario without reloading the page. */
      setEconScenario(scenario: ScenarioName | null): void;
      /**
       * Drive the SEED badge's both-states assertion. `null` restores the real
       * value, so a test cannot leave the page lying about its own provenance.
       */
      setRelationsSeeded(seeded: boolean | null): void;
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
  setRelationsSeeded: (seeded) => {
    relationsSeededOverride = seeded;
    store.refresh();
  },
  clusterCount: () => renderedClusters.length,
  pointsAssignments: () => globe.pointsAssignments,
  parkCamera: (lat, lng) => globe.flyTo(lat, lng, 0),
  firstClusterPosition: () => {
    const first = renderedClusters[0];
    return first ? { lat: first.lat, lng: first.lng } : null;
  },
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
