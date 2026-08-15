/**
 * Which renderer the browser should use, and — crucially — which one it got.
 *
 * ## Why this module exists
 *
 * For four sessions this project ran a configuration called "hardware GL" that
 * was SwiftShader. `WORLDPULSE_HARDWARE_GL=1` only *removed* the swiftshader
 * launch flags, and headless Chromium falls back to SwiftShader on its own, so
 * every "hardware" number ever recorded was software compared against software.
 * The medians came out 733ms against 750ms, and that 2% was read as "hardware GL
 * is not faster here" rather than as "these are the same renderer".
 *
 * The GPU was never blocked — `--ignore-gpu-blocklist` changes nothing. Headless
 * Chromium needs an explicit ANGLE backend, and with one the same machine goes
 * from 1.3fps to 59.9fps on the same page.
 *
 * ## The rule this encodes
 *
 * **A configuration is identified by what it reports, not by the flag that
 * requested it.** `describeRenderer` asks the live context which renderer it
 * actually has, and every run prints it. A label is a request; the renderer
 * string is the answer.
 */

/** Explicit ANGLE backend. Without `--use-angle`, headless falls back to software. */
const GPU = ['--use-gl=angle', '--use-angle=gl'];

const SOFTWARE = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * GPU is the default; software is the opt-out.
 *
 * `angle gl` over `angle d3d11`: identical medians (16.7ms), but its p95 is
 * 16.8ms against d3d11's 33.3ms. A flat frame time is worth more to this harness
 * than to the app, because every wait in it is budgeted in frames.
 */
export function glArgs(env = process.env) {
  return env['WORLDPULSE_SOFTWARE_GL'] === '1' ? SOFTWARE : GPU;
}

export function glLabel(env = process.env) {
  return env['WORLDPULSE_SOFTWARE_GL'] === '1' ? 'software (swiftshader)' : 'gpu (angle gl)';
}

/**
 * Ask the page which renderer it actually has.
 *
 * Never infer this from the flags. That inference is the entire bug this module
 * exists because of.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
export async function describeRenderer(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 'no webgl context';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'renderer string unavailable';
  });
}

/**
 * Is this renderer a software rasteriser, whatever it was asked to be?
 *
 * Used to fail loudly when a run requested the GPU and silently got software —
 * the exact condition that went unnoticed for four sessions.
 *
 * @param {string} renderer
 */
export function isSoftwareRenderer(renderer) {
  return /swiftshader|llvmpipe|software/i.test(renderer);
}
