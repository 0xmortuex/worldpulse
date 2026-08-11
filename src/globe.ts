import Globe, { type GlobeInstance } from 'globe.gl';
import { Color, MeshPhongMaterial } from 'three';
import type { Country } from './countries';
import type { EventCluster } from './layers/events';
import { BASE_STROKE, GLOBE_COLOR } from './theme';

export interface PolygonStyle {
  cap: string;
  side: string;
  stroke: string;
  altitude: number;
  label: string;
}

export interface GlobeCallbacks {
  onSelect(code: string, additive: boolean): void;
  onHover(code: string | null): void;
  onEventClick?(cluster: EventCluster): void;
}

export interface PointStyle {
  radius: number;
  color: string;
  altitude: number;
  label: string;
}

/**
 * three-globe declares GeoJsonGeometry with `coordinates: number[]`, which does
 * not describe real Polygon or MultiPolygon coordinates. Cast once, here, rather
 * than letting the inaccuracy leak into the rest of the app.
 */
type GeometryAccessor = Parameters<GlobeInstance['polygonGeoJsonGeometry']>[0];
const geometryAccessor = ((datum: object) =>
  (datum as Country).feature.geometry) as unknown as GeometryAccessor;

const DEFAULT_STYLE: PolygonStyle = {
  cap: '#20242a',
  side: '#101318',
  stroke: BASE_STROKE,
  altitude: 0.006,
  label: '',
};

/**
 * Thin wrapper over globe.gl. It owns no opinion about what anything means —
 * it is handed a code -> style map and renders it. All classification logic
 * lives in the relations engine so it stays testable without a WebGL context.
 */
export class CountryGlobe {
  readonly #globe: ReturnType<typeof createGlobe>;
  #styles: ReadonlyMap<string, PolygonStyle> = new Map();
  #pointStyle: (cluster: EventCluster) => PointStyle = () => ({
    radius: 0.2,
    color: '#f0553d',
    altitude: 0.01,
    label: '',
  });

  constructor(container: HTMLElement, countries: readonly Country[], callbacks: GlobeCallbacks) {
    this.#globe = createGlobe(container);

    this.#globe
      .polygonsData(countries as unknown as object[])
      // Our data objects are Country records, not raw GeoJSON features, so the
      // geometry has to be pointed at explicitly — three-globe otherwise looks
      // for `d.geometry` and silently renders nothing.
      .polygonGeoJsonGeometry(geometryAccessor)
      .polygonCapColor((d) => this.#styleOf(d).cap)
      .polygonSideColor((d) => this.#styleOf(d).side)
      .polygonStrokeColor((d) => this.#styleOf(d).stroke)
      .polygonAltitude((d) => this.#styleOf(d).altitude)
      .polygonLabel((d) => this.#styleOf(d).label)
      .polygonsTransitionDuration(200)
      .onPolygonClick((polygon, event) => {
        const country = polygon as unknown as Country;
        callbacks.onSelect(country.code, event.ctrlKey || event.metaKey);
      })
      .onPolygonHover((polygon) => {
        callbacks.onHover(polygon ? (polygon as unknown as Country).code : null);
      })
      .onPointClick((point) => {
        const cluster = point as unknown as EventCluster;
        if (this.facesCamera(cluster.lat, cluster.lng)) callbacks.onEventClick?.(cluster);
      })
      // Occlusion: reject pointer events for markers on the far side of the
      // globe, which three.js would otherwise happily raycast through the body.
      .pointerEventsFilter((_object, data) => {
        const cluster = data as unknown as EventCluster | undefined;
        if (!cluster || typeof cluster.lat !== 'number' || !Array.isArray(cluster.members)) return true;
        return this.facesCamera(cluster.lat, cluster.lng);
      });

    const resize = (): void => {
      this.#globe.width(container.clientWidth).height(container.clientHeight);
    };
    resize();
    new ResizeObserver(resize).observe(container);
  }

  #styleOf(datum: object): PolygonStyle {
    return this.#styles.get((datum as Country).code) ?? DEFAULT_STYLE;
  }

  /**
   * Re-reads the style map. globe.gl only re-evaluates accessors when one is
   * reassigned, so reassigning the cheapest accessor is what triggers a repaint
   * — this avoids calling polygonsData and rebuilding every geometry.
   */
  setStyles(styles: ReadonlyMap<string, PolygonStyle>): void {
    this.#styles = styles;
    this.#globe
      .polygonCapColor((d) => this.#styleOf(d).cap)
      .polygonSideColor((d) => this.#styleOf(d).side)
      .polygonStrokeColor((d) => this.#styleOf(d).stroke)
      .polygonAltitude((d) => this.#styleOf(d).altitude)
      .polygonLabel((d) => this.#styleOf(d).label);
  }

  flyTo(lat: number, lng: number, ms = 1000): void {
    this.#globe.pointOfView({ lat, lng, altitude: 1.8 }, ms);
  }

  /**
   * Screen position of a lat/lng, used by browser checks to AIM a pointer.
   *
   * Aiming with the renderer's own projection is not circular so long as the
   * assertion is on what comes back: hover here, read the tooltip's event id,
   * and require it to equal the event that was aimed at. A wrong projection
   * yields a different id, or none.
   */
  screenCoords(lat: number, lng: number, altitude = 0.012): { x: number; y: number } {
    return this.#globe.getScreenCoords(lat, lng, altitude);
  }

  /** Current camera target, for verifying a fly actually moved. */
  pointOfView(): { lat: number; lng: number; altitude: number } {
    return this.#globe.pointOfView();
  }

  setEvents(clusters: readonly EventCluster[], styleOf: (cluster: EventCluster) => PointStyle): void {
    this.#pointStyle = styleOf;
    this.#globe
      .pointsData(clusters as unknown as object[])
      .pointLat((d) => (d as unknown as EventCluster).lat)
      .pointLng((d) => (d as unknown as EventCluster).lng)
      .pointRadius((d) => this.#pointStyle(d as unknown as EventCluster).radius)
      .pointColor((d) => this.#pointStyle(d as unknown as EventCluster).color)
      .pointAltitude((d) => this.#pointStyle(d as unknown as EventCluster).altitude)
      .pointLabel((d) => this.#pointStyle(d as unknown as EventCluster).label);
  }

  /**
   * Is this lat/lng within the camera's visible cap?
   *
   * globe.gl raycasts point meshes without regard to the globe body, so a marker
   * on the far side stays hit-testable through the planet. A user clicking a
   * point they cannot see would select a different event than the one under
   * their cursor — the globe's version of a UI element resolving to the wrong
   * record.
   *
   * Derived from the camera's own lat/lng rather than from a world-space normal:
   * three-globe's axis convention is an implementation detail, and an earlier
   * hand-rolled normal had it inverted, which silently marked every visible
   * marker as occluded. Spherical geometry has no such trap.
   *
   * For a camera `altitude` globe-radii above the surface the horizon sits where
   * cos(angle) = 1 / (1 + altitude), which is tighter than a plain hemisphere and
   * matches what is actually on screen.
   */
  facesCamera(lat: number, lng: number): boolean {
    const view = this.#globe.pointOfView();
    const toRad = (deg: number): number => (deg * Math.PI) / 180;

    const cosAngle =
      Math.sin(toRad(lat)) * Math.sin(toRad(view.lat)) +
      Math.cos(toRad(lat)) * Math.cos(toRad(view.lat)) * Math.cos(toRad(lng - view.lng));

    const horizon = 1 / (1 + Math.max(0, view.altitude));
    return cosAngle > horizon;
  }
}

function createGlobe(container: HTMLElement): InstanceType<typeof Globe> {
  const globe = new Globe(container, { animateIn: false });

  // No remote textures: the app must render with zero network, and a flat lit
  // sphere reads better under the dark theme than a photographic earth.
  globe
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor('#2f81f7')
    .atmosphereAltitude(0.14);

  const material = globe.globeMaterial() as MeshPhongMaterial;
  material.color = new Color(GLOBE_COLOR);
  material.emissive = new Color('#05070a');
  material.shininess = 0.2;

  const controls = globe.controls();
  controls.autoRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 180;
  controls.maxDistance = 700;

  return globe;
}
