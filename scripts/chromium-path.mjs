/**
 * Decide which Chromium the browser harness launches, and refuse to guess.
 *
 * ## Why this is a module and not four lines at the launch site
 *
 * It was four lines at the launch site: `PLAYWRIGHT_CHROMIUM_PATH ?? undefined`,
 * passed to `chromium.launch`. When the variable was unset on a machine that
 * ships Chromium out of band, Playwright looked for its own pinned build,
 * did not find it, and threw — and `verify-render.mjs` reported that abort as a
 * FAIL, which `mutation-check.mjs` scored as a catch, which let a whole mutation
 * run exit 0 having executed no assertions.
 *
 * The environment being misconfigured is what made that classifier bug visible.
 * On a correctly configured machine it would have stayed hidden — so the fix is
 * not "document the variable" (it was documented, in two places). The fix is for
 * the harness to detect that it cannot launch and say so in terms that end the
 * problem, instead of degrading into a run that tests nothing.
 *
 * ## Directly callable, per rule 32
 *
 * `resolveChromium` takes the environment as data — the variable, the pinned
 * path, an existence predicate, the discovered candidates — and returns a
 * decision. It touches no filesystem and reads no globals, so a planted case
 * can put it in each of its four states without a browser, without an env var,
 * and without the hour-long suite it serves. The discovery I/O lives in
 * `findChromiumCandidates` below and is the only part that cannot be tested
 * this way.
 */

/**
 * @typedef {object} ChromiumInputs
 * @property {string | undefined} envPath   PLAYWRIGHT_CHROMIUM_PATH, if set
 * @property {string | null} pinnedPath     what Playwright would use on its own
 * @property {(path: string) => boolean} exists
 * @property {string[]} candidates          browsers discovered on this machine
 */

/**
 * @param {ChromiumInputs} inputs
 * @returns {{ executablePath: string | undefined, note: string }}
 */
export function resolveChromium({ envPath, pinnedPath, exists, candidates }) {
  if (envPath) {
    if (exists(envPath)) {
      return { executablePath: envPath, note: `PLAYWRIGHT_CHROMIUM_PATH=${envPath}` };
    }
    throw new Error(explain(`PLAYWRIGHT_CHROMIUM_PATH is set to ${envPath}, which does not exist.`, candidates));
  }

  // Unset is correct and common: on a machine where `playwright install` put
  // the browsers where the package expects them, deferring to Playwright is the
  // right answer and this must not second-guess it.
  if (pinnedPath && exists(pinnedPath)) {
    return { executablePath: undefined, note: `Playwright's own build at ${pinnedPath}` };
  }

  throw new Error(
    explain(
      pinnedPath
        ? `Playwright expects Chromium at ${pinnedPath}, which does not exist — ` +
            'the installed build does not match the one this package pins.'
        : 'Playwright could not name a Chromium build to launch.',
      candidates,
    ),
  );
}

/**
 * The message is the deliverable. A harness that fails with
 * "Executable doesn't exist" and a suggestion to run `npx playwright install`
 * — which is wrong here, and would download a second copy of a browser already
 * on disk — costs more time than one that prints the line to paste.
 */
function explain(problem, candidates) {
  const lines = [
    problem,
    '',
    'The browser harness will not launch a guessed binary: a run that cannot start is',
    'not a run that found nothing (rule 30), and scoring it as one is how a mutation',
    'suite came to exit clean over zero executed assertions.',
    '',
  ];

  if (candidates.length > 0) {
    lines.push('Chromium builds found on this machine:', ...candidates.map((path) => `  ${path}`), '');
    lines.push('Export one of them and re-run:', '', `  export PLAYWRIGHT_CHROMIUM_PATH=${candidates[0]}`, '');
  } else {
    lines.push(
      'No Chromium was found. If this environment is supposed to ship one, check',
      'PLAYWRIGHT_BROWSERS_PATH; otherwise install browsers for this Playwright version.',
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Chromium builds sitting under PLAYWRIGHT_BROWSERS_PATH, newest-looking first.
 *
 * Deliberately tolerant: it globs rather than knowing the layout, because the
 * point is to put a usable path in front of a human, not to be authoritative
 * about Playwright's directory conventions.
 *
 * @param {string | undefined} browsersPath
 * @param {{ readdirSync: (p: string) => string[], existsSync: (p: string) => boolean }} fs
 * @param {(...parts: string[]) => string} join
 */
export function findChromiumCandidates(browsersPath, fs, join) {
  if (!browsersPath || !fs.existsSync(browsersPath)) return [];

  /** Relative layouts seen in practice, headful build preferred over the shell. */
  const layouts = ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe'];

  let entries;
  try {
    entries = fs.readdirSync(browsersPath);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()
    .flatMap((name) => layouts.map((layout) => join(browsersPath, name, layout)))
    .filter((path) => fs.existsSync(path));
}
