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

class ScenarioFetcher implements RequestingFetcher {
  constructor(private readonly scenario: ScenarioName) {}

  async request(spec: RequestSpec, options: RequestOptions = {}): Promise<FetchOutcome> {
    const indicator = spec.path.split('/indicator/')[1] ?? '';
    const isGdp = indicator.startsWith('NY.GDP');

    // A loading state has to actually persist, or the assertion races the
    // render. Aborting still resolves, so a selection change is not wedged.
    if (this.scenario === 'loading') {
      if (options.signal?.aborted) return this.#failure(spec, 'aborted');
      return NEVER;
    }

    if (this.scenario === 'unavailable') return this.#failure(spec, 'http');

    /**
     * Serve exactly what the fixture provider served, per country.
     *
     * A country with no fixture for an indicator gets a FAILED request rather
     * than an empty series — the fixture set never covered every indicator, and
     * rendering "no data" for one we simply never captured would assert
     * something about the country that no source told us.
     */
    if (this.scenario === 'fixtures') {
      const iso3 = spec.path.split('/country/')[1]?.split('/')[0] ?? '';
      const indicatorId = INDICATORS.find((entry) => indicator.startsWith(entry.code))?.id ?? '';
      const raw = fixtureFor(decodeURIComponent(iso3), indicatorId);
      if (raw === undefined) return this.#failure(spec, 'http');
      return {
        ok: true,
        ctx: {
          requestUrl: `https://api.worldbank.org${spec.path}`,
          httpStatus: 200,
          fetchedAt: new Date().toISOString(),
          cache: 'miss',
          fromFixture: true,
        },
        raw,
      };
    }

    // Degraded: GDP answers, everything else does not. Partial by construction,
    // which is the state most likely to be skipped.
    if (this.scenario === 'degraded' && !isGdp) return this.#failure(spec, 'http');

    const raw = isGdp ? gdpNormal : inflationHyper;
    const fetchedAt =
      this.scenario === 'stale'
        ? // Comfortably past the World Bank TTL, inside the bounded window, so
          // it is servable AND must announce its age.
          new Date(Date.now() - 3 * 86_400_000).toISOString()
        : new Date().toISOString();

    return {
      ok: true,
      ctx: {
        requestUrl: `https://api.worldbank.org${spec.path}`,
        httpStatus: 200,
        fetchedAt,
        cache: this.scenario === 'stale' ? 'stale-revalidating' : 'miss',
        fromFixture: true,
      },
      raw,
    };
  }

  #failure(spec: RequestSpec, reason: 'http' | 'aborted'): FetchOutcome {
    return {
      ok: false,
      failure: {
        kind: 'fetch-failed',
        sourceId: spec.sourceId,
        requestUrl: `https://api.worldbank.org${spec.path}`,
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

export function fetcherFor(search: string): RequestingFetcher {
  const scenario = override === undefined ? parseScenario(search) : override;
  return scenario ? new ScenarioFetcher(scenario) : new Fetcher();
}
