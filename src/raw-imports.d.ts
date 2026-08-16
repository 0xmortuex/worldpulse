/**
 * Vite's `?raw` suffix imports a file as a string. The bundler understands it;
 * `tsc` does not, and without this declaration a real, working import fails the
 * typecheck.
 *
 * Narrow on purpose. A blanket `declare module '*'` would silence every missing
 * module in the project — including the genuinely missing ones — which is the
 * shape of fix this repository rejects everywhere else: making a check quieter
 * rather than making the code right.
 */
declare module '*.xml?raw' {
  const content: string;
  export default content;
}
