import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { glArgs, glLabel, isSoftwareRenderer } from '../scripts/gl-config.mjs';

/**
 * Planted cases for the renderer guard (rules 27, 32 and 35).
 *
 * For four sessions this project ran a configuration called "hardware GL" that
 * was SwiftShader. `WORLDPULSE_HARDWARE_GL=1` only removed the swiftshader
 * flags, and headless Chromium falls back to software on its own — so every
 * "hardware" frame profile, flake rate and duration described a renderer nobody
 * had asked for, under a label saying otherwise.
 *
 * Nothing caught it because nothing ever asked the process which renderer it
 * had. These cases exist so the silent-fallback class cannot mislabel a
 * measurement again.
 */
describe('gl configuration', () => {
  it('defaults to the GPU, with software as the opt-out', () => {
    // The inversion. Software was the default when it was believed to be the
    // only thing that worked; it is now a deliberate fallback.
    assert.deepEqual(glArgs({}), ['--use-gl=angle', '--use-angle=gl']);
    assert.match(glLabel({}), /gpu/);

    assert.match(glArgs({ WORLDPULSE_SOFTWARE_GL: '1' }).join(' '), /swiftshader/);
    assert.match(glLabel({ WORLDPULSE_SOFTWARE_GL: '1' }), /software/);
  });

  it('requests an EXPLICIT ANGLE backend, because omitting one falls back silently', () => {
    /**
     * The precise mistake: "hardware GL" was implemented as *no GL flags*, and
     * headless Chromium then chose SwiftShader. An empty argument list is not a
     * request for the GPU — it is a request for whatever Chromium prefers, which
     * is software.
     */
    const args = glArgs({});
    assert.ok(args.length > 0, 'no flags at all is how the silent fallback happened');
    assert.ok(
      args.some((arg) => arg.startsWith('--use-angle=')),
      'an explicit ANGLE backend is what actually engages the GPU',
    );
  });

  /**
   * THE PLANTED CASE THE GUARD EXISTS FOR.
   *
   * These are real renderer strings. The first is what this machine reported for
   * four sessions while the configuration was labelled "hardware GL".
   */
  it('recognises a software renderer whatever it was asked to be', () => {
    const swiftshader =
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
    assert.equal(isSoftwareRenderer(swiftshader), true, 'the exact string that went unnoticed');
    assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true);
    assert.equal(isSoftwareRenderer('Software Rasterizer'), true);
  });

  it('does not mistake a real GPU for software', () => {
    // Both strings measured on this machine with an explicit ANGLE backend.
    assert.equal(
      isSoftwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics, OpenGL 4.5.0)'),
      false,
    );
    assert.equal(
      isSoftwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics (0x00009B41) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      false,
    );
    assert.equal(isSoftwareRenderer('NVIDIA GeForce RTX 4070/PCIe/SSE2'), false);
  });

  it('the verify harness fails a run that requested the GPU and got software', () => {
    /**
     * Asserted on the source rather than by launching a browser: the behaviour
     * is a `process.exit(1)` at startup, and a test that had to boot Chromium to
     * check it would be slower than the thing it guards.
     *
     * What matters is that the check is unconditional and names both strings —
     * a warning nobody reads is how the original mislabelling survived.
     */
    const source = readFileSync(new URL('../scripts/verify-render.mjs', import.meta.url), 'utf8');
    assert.match(source, /isSoftwareRenderer\(renderer\)/, 'the run does not check what it got');
    assert.match(source, /REQUESTED THE GPU AND GOT SOFTWARE/, 'the failure does not name the condition');
    assert.match(source, /process\.exit\(1\)/, 'a silent fallback must fail the run, not warn');
  });
});
