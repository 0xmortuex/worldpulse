import Globe, { type GlobeInstance } from 'globe.gl';
import { Color, MeshPhongMaterial } from 'three';
import type { Country } from './countries';
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
