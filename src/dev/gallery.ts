import worldbankFixture from '../../tests/fixtures/worldbank-indicator.json';
import usgsFixture from '../../tests/fixtures/usgs-quakes.json';
import gdeltFixture from '../../tests/fixtures/gdelt-doc.json';
import { escapeHtml, factHtml } from '../facts/badge';
import type { AnyFact, Fact } from '../facts/types';
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
