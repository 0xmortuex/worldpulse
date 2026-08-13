import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findChromiumCandidates, resolveChromium } from '../scripts/chromium-path.mjs';

/**
 * Planted cases for browser resolution (rules 27 and 32).
 *
 * All four states are reachable here without a browser, without an environment
 * variable and without the hour-long suite this serves — which is the whole
 * claim rule 32 makes. The previous version of this logic was two lines at a
 * launch site and could only be exercised by launching.
 */
const REAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PINNED_MISSING = '/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

const exists = (path: string): boolean => path === REAL;

describe('chromium resolution', () => {
  it('uses PLAYWRIGHT_CHROMIUM_PATH when it points at a real binary', () => {
    const choice = resolveChromium({ envPath: REAL, pinnedPath: null, exists, candidates: [REAL] });
    assert.equal(choice.executablePath, REAL);
  });

  it('defers to Playwright when the variable is unset and its own build exists', () => {
    // Unset is correct on an ordinary dev machine. Hard-failing whenever the
    // variable is absent would break every environment that never needed it.
    const choice = resolveChromium({ envPath: undefined, pinnedPath: REAL, exists, candidates: [REAL] });
    assert.equal(choice.executablePath, undefined, 'overrode a working Playwright install');
  });

  it('refuses to start when the pinned build is missing, and names the export line', () => {
    assert.throws(
      () => resolveChromium({ envPath: undefined, pinnedPath: PINNED_MISSING, exists, candidates: [REAL] }),
      (error: Error) => {
        assert.match(error.message, /does not exist/);
        assert.match(
          error.message,
          new RegExp(`export PLAYWRIGHT_CHROMIUM_PATH=${REAL}`),
          'the failure must hand over the line to paste, not describe the problem',
        );
        return true;
      },
    );
  });

  it('refuses when the variable points somewhere that does not exist', () => {
    assert.throws(
      () => resolveChromium({ envPath: '/nope/chrome', pinnedPath: REAL, exists, candidates: [REAL] }),
      /PLAYWRIGHT_CHROMIUM_PATH is set to \/nope\/chrome, which does not exist/,
    );
  });

  it('says so plainly when no browser exists anywhere', () => {
    assert.throws(
      () => resolveChromium({ envPath: undefined, pinnedPath: PINNED_MISSING, exists, candidates: [] }),
      /No Chromium was found/,
    );
  });

  it('discovers candidates under the browsers path, newest first', () => {
    const fs = {
      readdirSync: (): string[] => ['chromium-1194', 'chromium-1300', 'ffmpeg-1011', 'chromium_headless_shell-1194'],
      // The browsers directory itself must exist too — the real function checks
      // it before reading, and a stub that says otherwise tests a code path
      // nothing takes.
      existsSync: (path: string): boolean => path === '/opt/pw-browsers' || path.endsWith('chrome-linux/chrome'),
    };
    const found = findChromiumCandidates('/opt/pw-browsers', fs, (...parts) => parts.join('/'));
    assert.deepEqual(found, [
      '/opt/pw-browsers/chromium-1300/chrome-linux/chrome',
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    ]);
  });

  it('finds the Windows layout Playwright actually ships', () => {
    // chrome-win64, not chrome-win. Its absence meant a Windows machine WITH
    // browsers installed would have been told none were found — and the whole
    // point of that error path is the line it prints.
    const fs = {
      readdirSync: (): string[] => ['chromium-1234'],
      existsSync: (path: string): boolean =>
        path === '/browsers' || path.endsWith('chrome-win64/chrome.exe'),
    };
    assert.deepEqual(findChromiumCandidates('/browsers', fs, (...parts) => parts.join('/')), [
      '/browsers/chromium-1234/chrome-win64/chrome.exe',
    ]);
  });

  it('returns nothing rather than throwing when the browsers path is absent', () => {
    const fs = { readdirSync: (): string[] => [], existsSync: (): boolean => false };
    assert.deepEqual(findChromiumCandidates(undefined, fs, (...parts) => parts.join('/')), []);
  });
});
