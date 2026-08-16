import gdpNormal from '../../tests/fixtures/economy/gdp-normal.json';
import inflationHyper from '../../tests/fixtures/economy/inflation-hyper.json';
import { fixtureFor } from '../dossier/economy-provider';
import { INDICATORS } from '../economy/series';
import { Fetcher, type FetchOutcome, type RequestOptions } from './transport';
import type { RequestSpec } from './compose';

/**
 * Deterministic fetch scenarios, selected by `?econ=<name>` in the URL.
 *
 * ## Why this exists
 *
 * The four panel states the fetch layer introduces — loading, stale, degraded,
 * unavailable — are each reachable only through a specific failure of a remote
 * server. Demonstrating them against the live World Bank would mean waiting for
 * it to break, which is not a test.
 *
 * ## Why it is not a lie
 *
 * Every response served here is marked `fromFixture: true`, which the inspector
 * already renders as a warning. A scenario run therefore says on screen that it
 * is not live data. The distinction this project cares about is not "did bytes
 * come off a socket" but "does the app claim more confidence than it has", and a
 * fixture that announces itself claims nothing.
 *
 * Without a scenario parameter this returns the real `Fetcher` and the app makes
 * real requests. The default path has no stub in it.
 */

export type ScenarioName = 'ok' | 'stale' | 'degraded' | 'unavailable' | 'loading' | 'fixtures';

const SCENARIOS: readonly ScenarioName[] = ['ok', 'stale', 'degraded', 'unavailable', 'loading', 'fixtures'];

export function parseScenario(search: string): ScenarioName | null {
  const value = new URLSearchParams(search).get('econ');
  return SCENARIOS.find((name) => name === value) ?? null;
}

/** What the economy panel calls. Narrower than `Fetcher` so a stub can stand in. */
export interface RequestingFetcher {
  request(spec: RequestSpec, options?: RequestOptions): Promise<FetchOutcome>;
}

const NEVER = new Promise<never>(() => {});

/**
 * ## Per-source scenario handlers — the generalisation step 10 needs
 *
 * This harness was World-Bank-shaped, because it was built for the one panel
 * that needed it: it read `spec.path.split('/indicator/')`, branched on
 * `NY.GDP`, and hardcoded `api.worldbank.org` into every URL it reported.
 * `PROGRESS.md` recorded that as the blocker gating three otherwise-ready
 * panels — legislature, government and the dossier header all fetch from
 * `wikidata-sparql`, which is CLIENT-FETCH with a 146-byte probe response.
 *
 * The dispatch key was already there: every `RequestSpec` carries a
 * `sourceId`. So a handler registers against that, and the four fetch states
 * — loading, stale, degraded, unavailable — stay generic because they are
 * properties of the TRANSPORT rather than of any source.
 */
export interface ScenarioSource {
  /** Origin reported in provenance, so the inspector shows a truthful URL. */
  origin: string;
  /**
   * The body this request gets under `fixtures`, or `undefined` when the
   * fixture set never covered it.
   *
   * Undefined must mean a FAILED request rather than an empty body: rendering
   * "no data" for something never captured would assert something about the
   * subject that no source ever said.
   */
  fixture(spec: RequestSpec): unknown | undefined;
  /** The body for `ok` and `stale`. */
  sample(spec: RequestSpec): unknown;
  /**
   * Whether this particular request succeeds under `degraded`.
   *
   * Degraded is partial-by-construction — some requests answer and some do
   * not — and which ones is a per-source judgement, because "partial" for a
   * multi-indicator panel is not the same shape as for a single query.
   */
  degradedOk(spec: RequestSpec): boolean;
}

const SOURCES = new Map<string, ScenarioSource>();

export function registerScenarioSource(sourceId: string, source: ScenarioSource): void {
  SOURCES.set(sourceId, source);
}

/** Exported so a test can assert the registry is populated rather than empty. */
export function registeredScenarioSources(): string[] {
  return [...SOURCES.keys()].sort();
}

class ScenarioFetcher implements RequestingFetcher {
  constructor(private readonly scenario: ScenarioName) {}

  async request(spec: RequestSpec, options: RequestOptions = {}): Promise<FetchOutcome> {
    /**
     * AN UNREGISTERED SOURCE FAILS LOUDLY.
     *
     * The alternative — falling through to the World Bank's handler — is how a
     * scenario run would quietly serve GDP figures for a Wikidata query and
     * still look like a working demonstration. A scenario that serves the wrong
     * source's data is worse than one that refuses, because it renders.
     */
    const source = SOURCES.get(spec.sourceId);
    if (!source) {
      throw new Error(
        `scenario "${this.scenario}" has no handler for source "${spec.sourceId}". ` +
          `Registered: ${registeredScenarioSources().join(', ') || '(none)'}. ` +
          'Register one with registerScenarioSource() rather than letting the request fall ' +
          'through to another source\'s fixtures.',
      );
    }

    // A loading state has to actually persist, or the assertion races the
    // render. Aborting still resolves, so a selection change is not wedged.
    if (this.scenario === 'loading') {
      if (options.signal?.aborted) return this.#failure(spec, 'aborted', source.origin);
      return NEVER;
    }

    if (this.scenario === 'unavailable') return this.#failure(spec, 'http', source.origin);

    /**
     * Serve exactly what the fixture provider served.
     *
     * A request with no fixture gets a FAILED result rather than an empty body,
     * for the reason recorded on `ScenarioSource.fixture`.
     */
    if (this.scenario === 'fixtures') {
      const raw = source.fixture(spec);
      if (raw === undefined) return this.#failure(spec, 'http', source.origin);
      return {
        ok: true,
        ctx: {
          requestUrl: `${source.origin}${spec.path}`,
          httpStatus: 200,
          fetchedAt: new Date().toISOString(),
          cache: 'miss',
          fromFixture: true,
        },
        raw,
      };
    }

    // Partial by construction, which is the state most likely to be skipped.
    if (this.scenario === 'degraded' && !source.degradedOk(spec)) {
      return this.#failure(spec, 'http', source.origin);
    }

    const raw = source.sample(spec);
    const fetchedAt =
      this.scenario === 'stale'
        ? // Comfortably past the World Bank TTL, inside the bounded window, so
          // it is servable AND must announce its age.
          new Date(Date.now() - 3 * 86_400_000).toISOString()
        : new Date().toISOString();

    return {
      ok: true,
      ctx: {
        requestUrl: `${source.origin}${spec.path}`,
        httpStatus: 200,
        fetchedAt,
        cache: this.scenario === 'stale' ? 'stale-revalidating' : 'miss',
        fromFixture: true,
      },
      raw,
    };
  }

  #failure(spec: RequestSpec, reason: 'http' | 'aborted', origin: string): FetchOutcome {
    return {
      ok: false,
      failure: {
        kind: 'fetch-failed',
        sourceId: spec.sourceId,
        requestUrl: `${origin}${spec.path}`,
        httpStatus: reason === 'http' ? 503 : null,
        attemptedAt: new Date().toISOString(),
        attempts: reason === 'http' ? 3 : 1,
        reason,
        detail: reason === 'http' ? 'upstream returned HTTP 503' : 'the selection changed',
        retryableAt: null,
      },
    };
  }
}

/**
 * Scenario set at runtime rather than by URL, so switching does not reload.
 *
 * The URL parameter still works and is the documented way in; this exists
 * because the browser harness needs to visit four states in sequence, and doing
 * that by navigation reloads the app four times. Measured: the reloads made
 * step 7's marker-click check — already the suite's known flake, and frame-rate
 * sensitive — fail four ways instead of one. An instrument that degrades the
 * thing it is measuring is not measuring it (rule 20).
 */
let override: ScenarioName | null | undefined;

export function setScenario(scenario: ScenarioName | null): void {
  override = scenario;
}

/**
 * The World Bank handler — the behaviour this harness had before it was
 * generalised, moved behind the registry rather than rewritten.
 *
 * Registered here rather than in the economy panel so that the harness is
 * populated whether or not that panel has been mounted: a scenario run that
 * threw "no handler" because a module had not been imported yet would be a
 * worse failure than the one the guard exists to prevent.
 */
registerScenarioSource('worldbank', {
  origin: 'https://api.worldbank.org',

  fixture(spec) {
    const iso3 = spec.path.split('/country/')[1]?.split('/')[0] ?? '';
    const indicator = spec.path.split('/indicator/')[1] ?? '';
    const indicatorId = INDICATORS.find((entry) => indicator.startsWith(entry.code))?.id ?? '';
    return fixtureFor(decodeURIComponent(iso3), indicatorId);
  },

  sample(spec) {
    return isGdpRequest(spec) ? gdpNormal : inflationHyper;
  },

  /** GDP answers, everything else does not — the partial case, deliberately. */
  degradedOk(spec) {
    return isGdpRequest(spec);
  },
});

function isGdpRequest(spec: RequestSpec): boolean {
  return (spec.path.split('/indicator/')[1] ?? '').startsWith('NY.GDP');
}

export function fetcherFor(search: string): RequestingFetcher {
  const scenario = override === undefined ? parseScenario(search) : override;
  return scenario ? new ScenarioFetcher(scenario) : new Fetcher();
}
