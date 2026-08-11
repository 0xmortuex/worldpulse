declare module 'world-atlas/countries-110m.json' {
  import type { GeometryCollection, Topology } from 'topojson-specification';

  /**
   * Declared rather than imported as JSON: letting tsc infer a literal type for
   * a 100KB topology is slow and buys nothing.
   */
  const topology: Topology<{
    countries: GeometryCollection<{ name: string }>;
    land: GeometryCollection;
  }>;
  export default topology;
}

declare module 'i18n-iso-countries/langs/en.json' {
  const locale: { locale: string; countries: Record<string, string | string[]> };
  export default locale;
}
