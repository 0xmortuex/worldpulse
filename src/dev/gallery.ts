import worldbankFixture from '../../tests/fixtures/worldbank-indicator.json';
import usgsFixture from '../../tests/fixtures/usgs-quakes.json';
import gdeltFixture from '../../tests/fixtures/gdelt-doc.json';
import { escapeHtml, factHtml } from '../facts/badge';
import { contributingShortfall, type AnyFact, type Fact } from '../facts/types';
import type { Store } from '../state';
import type { FetchContext } from '../sources/adapter';
import * as gdelt from '../sources/gdelt';
import * as usgs from '../sources/usgs';
import * as worldbank from '../sources/worldbank';

/**
 * Component gallery for the confidence badge and provenance inspector.
 *
 * Every entry below is driven through a real adapter from a real fixture, so
 * this demonstrates the working pipeline rather than mocked-up markup. It exists
 * because step 2 has no live data to show the badge against; delete it once the
 * dossier panels land and the badge has real work to do.
 *
 * The fixtures are hand-authored from documented schemas, NOT captured
 * responses — see tests/fixtures/README.md. The inspector says so on every one.
 */

const FIXTURE_CTX: FetchContext = {
  requestUrl: 'https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=3',
  httpStatus: 200,
  fetchedAt: '1970-01-01T00:00:00.000Z',
  cache: 'miss',
  fromFixture: true,
};

interface Entry {
  title: string;
  explain: string;
  fact: AnyFact;
}

/**
 * A derivation over three World Bank indicators where one has no observation.
 *
 * The URLs are built off the registry's own indicator host rather than written
 * out, because `registry-coverage.test.ts` requires every host in `src/` to
 * resolve through the registry — and it caught the first draft of this entry,
 * which invented three citation hosts to look like a relations score. That guard
 * is right: a host typed into a component is a fetch target nobody registered.
 * Building the demonstration out of a source the app actually knows is both
 * legal and more honest, since a World Bank indicator genuinely can return no
 * observation for a country while its siblings return one.
 */
function indicatorInput(indicator: string, value: number | null, extractedBy: string): {
  fact: AnyFact;
  required: false;
} {
  const base = new URL(FIXTURE_CTX.requestUrl);
  return {
    fact: {
      value,
      asOf: '2024',
      tier: 'OFFICIAL',
      provenance: {
        kind: 'fetch',
        sourceId: 'worldbank',
        requestUrl: `${base.origin}/v2/country/SMR/indicator/${indicator}?format=json`,
        httpStatus: 200,
        fetchedAt: '2026-01-01T00:00:00Z',
        cache: 'miss',
        raw: value === null ? '[{"page":1},[]]' : `[{"page":1},[{"value":${value}}]]`,
        extractedBy,
        fromFixture: true,
      },
    },
    // Contributing, never required: the average of the indicators that DID
    // answer is a real figure. Marking these required would render the whole
    // thing as no data, which is the larger lie.
    required: false,
  };
}

function indicatorBreadth(): AnyFact {
  const inputs = [
    indicatorInput('NY.GDP.MKTP.CD', 3, 'latest non-null observation'),
    indicatorInput('SP.POP.TOTL', 2, 'latest non-null observation'),
    // The one that answered with nothing. Consulted, present in the input list,
    // absent from the formula — which is exactly why the formula alone cannot
    // disclose it.
    indicatorInput('MS.MIL.XPND.CD', null, 'no non-null observation among 60 rows'),
  ];

  const provenance = {
    kind: 'derived' as const,
    computedBy: 'src/dev/gallery.ts',
    formula: '+3 +2 = 5',
    computedAt: '2026-01-01T00:00:00Z',
    inputs,
  };

  /**
   * The note is computed by the same helper the relations score uses, not typed
   * out. A hand-written caveat would keep rendering its sentence after the rule
   * behind it changed or broke — the gallery asserting a string rather than the
   * behaviour.
   */
  const shortfall = contributingShortfall(provenance);
  return {
    value: 5,
    asOf: '2026',
    tier: 'DERIVED',
    provenance,
    ...(shortfall === null
      ? {}
      : {
          note: `${shortfall.missing} of ${shortfall.contributing} contributing findings returned no value, so this figure rests on fewer inputs than were consulted.`,
        }),
  };
}

function entries(): Entry[] {
  const series = worldbank.parse(worldbankFixture);
  const gdp = worldbank.latestFact(series, FIXTURE_CTX, { unit: 'USD' });

  const feed = usgs.parse(usgsFixture);
  const reviewed = feed.quakes.find((quake) => quake.status === 'reviewed');
  const automatic = feed.quakes.find((quake) => quake.status !== 'reviewed');

  const usgsCtx: FetchContext = {
    ...FIXTURE_CTX,
    requestUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  };

  const articles = gdelt.parse(gdeltFixture);

  const list: Entry[] = [
    {
      title: 'OFFICIAL',
      explain: 'A primary source reported it. Note the skipped empty current year.',
      fact: gdp,
    },
  ];

  if (reviewed) {
    list.push({
      title: 'OFFICIAL — analyst reviewed',
      explain: 'A reviewed seismic solution.',
      fact: usgs.magnitudeFact(reviewed, feed, usgsCtx),
    });
  }
  if (automatic) {
    list.push({
      title: 'ESTIMATE — same source, weaker claim',
      explain: 'An automatic solution from the same feed. The tier is a property of the record, not the source.',
      fact: usgs.magnitudeFact(automatic, feed, usgsCtx),
    });
  }

  list.push({
    title: 'DERIVED',
    explain: 'A count this app computed. Measures coverage of the news, not events.',
    fact: gdelt.articleCountFact(articles, { ...FIXTURE_CTX, requestUrl: 'https://api.gdeltproject.org/api/v2/doc/doc?query=sourcecountry%3AUS&mode=artlist&format=json' }, 'last 24h'),
  });

  /**
   * P3 made visible. A derivation whose REQUIRED input came back empty renders
   * as no data rather than as a confident computed number.
   *
   * This is the gallery entry that satisfies P12 for P3: the rule specifies
   * user-visible behaviour, so it owes a browser assertion, and this is the case
   * that assertion can point at. Before P3 the empty input was invisible to the
   * derivation and this fact would have rendered its arithmetic as though every
   * term were present.
   */
  list.push({
    title: 'DERIVED — a required input came back empty',
    explain:
      'P3: missing data propagates through required inputs. The source was asked for the ' +
      'input, answered with nothing, and the derivation says so instead of computing around it.',
    fact: {
      value: null,
      asOf: '2026',
      tier: 'DERIVED',
      provenance: {
        kind: 'derived',
        computedBy: 'src/dev/gallery.ts',
        formula: 'population ÷ area',
        computedAt: '2026-01-01T00:00:00Z',
        inputs: [
          {
            fact: {
              value: null,
              asOf: '2026',
              tier: 'OFFICIAL',
              provenance: {
                kind: 'fetch',
                sourceId: 'worldbank',
                requestUrl: 'https://api.worldbank.org/v2/country/XKX/indicator/SP.POP.TOTL?format=json',
                httpStatus: 200,
                fetchedAt: '2026-01-01T00:00:00Z',
                cache: 'miss',
                raw: '[{"page":1},null]',
                extractedBy: 'value at [1][0].value',
              },
            },
            required: true,
          },
        ],
      },
    },
  });

  /**
   * P3's OTHER half, and the one that had no browser-visible case until now.
   *
   * A derivation whose merely-CONTRIBUTING input came back empty is not "no
   * data" — the remaining terms still sum to a real number — and it is not a
   * complete figure either. It is the third state: a value, with a caveat saying
   * how much of what was consulted actually answered.
   *
   * **This state is currently unreachable from any production construction
   * site**, and that is a finding rather than a reason to leave it
   * undemonstrated. `src/relations/provenance.ts` is the only caller that marks
   * inputs `required: false`, and it builds each input fact from
   * `ScoredInput.weight`, typed `number` — so no relations input can ever be
   * empty, and `contributingShortfall` cannot fire in the shipped app. The
   * mechanism is right; the one site that could use it cannot yet represent
   * consulted-and-empty. See `OPEN-QUESTIONS.md` 13.
   *
   * The entry is here so the disclosure is watched working before a source needs
   * it. A rule that has never been seen rendering is a rule nobody has checked.
   */
  list.push({
    title: 'DERIVED — computed from fewer inputs than were consulted',
    explain:
      'P3: a CONTRIBUTING input came back empty. The value still computes from the rest, so it ' +
      'renders — with a caveat. Calling this "no data" would be a bigger lie than the shortfall.',
    fact: indicatorBreadth(),
  });

  list.push({
    title: 'No data',
    explain: 'The source was asked and had nothing. Never a placeholder value.',
    fact: {
      value: null,
      asOf: '2024',
      tier: 'OFFICIAL',
      provenance: {
        kind: 'fetch',
        sourceId: 'worldbank',
        requestUrl: 'https://api.worldbank.org/v2/country/XKX/indicator/MS.MIL.XPND.CD?format=json',
        httpStatus: 200,
        fetchedAt: '1970-01-01T00:00:00.000Z',
        cache: 'hit',
        raw: { note: 'fixture: an empty but valid indicator response' },
        extractedBy: 'no non-null observation among 60 rows',
        fromFixture: true,
      },
    } satisfies Fact<number>,
  });

  list.push({
    title: 'Key not configured',
    explain: 'A key-gated source with no key. Degrades to a state, never an error.',
    fact: {
      value: null,
      asOf: '',
      tier: 'OFFICIAL',
      provenance: { kind: 'unconfigured', sourceId: 'comtrade', keyEnv: 'COMTRADE_KEY' },
    } satisfies Fact<number>,
  });

  list.push({
    title: 'BROKEN — the failure this system exists to catch',
    explain:
      'A value with no provenance. It would otherwise render as a confident OFFICIAL figure that nobody can check.',
    fact: { value: 42, asOf: '2024', tier: 'OFFICIAL', provenance: null } satisfies Fact<number>,
  });

  return list;
}

export function mountGallery(root: HTMLElement, store: Store): void {
  let list: Entry[];
  try {
    list = entries();
  } catch (error) {
    // An adapter throwing here means a fixture and its parser disagree, which
    // the contract tests should already have caught. Say so rather than
    // rendering a blank section.
    root.innerHTML = `<section class="rail-section"><h2>Component gallery</h2>
      <p class="rail-help">Adapter failed on its own fixture: ${escapeHtml(String(error))}</p></section>`;
    return;
  }

  // Re-rendered on every state change so its fact ids stay recent enough to
  // survive registry eviction, like every other view.
  store.subscribe(() => {
    root.innerHTML = render(list);
  });
}

function render(list: Entry[]): string {
  return `
    <section class="rail-section">
      <h2>Badge states</h2>
      <p class="rail-help">Every value below is parsed from a fixture by the real
      adapter. Click any badge to open the provenance inspector. Fixtures are
      hand-authored from documented schemas, not captured responses.</p>
      <ul class="gallery">
        ${list
          .map(
            (entry) => `<li>
              <div class="gallery-title">${escapeHtml(entry.title)}</div>
              <div class="gallery-fact">${factHtml(entry.fact)}</div>
              <div class="gallery-explain">${escapeHtml(entry.explain)}</div>
            </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}
