import chokepointCapture from '../../tests/fixtures/portwatch-chokepoints.json';
import { AIS_CAVEAT, parse, type ChokepointDay } from '../sources/portwatch';
import { factHtml } from '../facts/badge';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';
import { getSource } from '../facts/registry';

/**
 * The chokepoint monitor — SPEC-WARWATCH §2's Hormuz panel, as amended.
 *
 * ## What the amendment changed, and why it matters here
 *
 * The original design tracked individual vessels over AIS. `SPEC-EXPANSION`
 * Phase A6 replaced it with **IMF PortWatch**: aggregated chokepoint data from
 * an IGO, published per day, counting transits rather than following ships.
 * That retires most of what made the original dangerous — there is no per-vessel
 * position here to mistake for surveillance, and no way to read one ship's
 * movements off this panel.
 *
 * What it does NOT retire is the sensing limitation, because PortWatch is built
 * on AIS too. So the caveat below is not decoration.
 *
 * ## Five requirements this panel inherits and cannot be built without
 *
 * 1. **`AIS_CAVEAT` renders, and a browser assertion proves it renders.** The
 *    text is imported from `src/sources/portwatch.ts`, so the panel and the
 *    assertion share one source of truth and cannot drift apart.
 * 2. **It renders as OURS, with its basis inline.** Whether the IMF documents
 *    these limitations could not be established, so the caveat must not be
 *    attributed to them — it opens "Our caveat, not the IMF's" — and its basis
 *    (Arslanalp, Koepke & Verschuur, IMF WP/2021/225) appears on the rendered
 *    surface, not only in the provenance inspector. A reader who never opens an
 *    inspector still learns whose claim it is.
 * 3. **The tier split survives to the badge.** Transit counts render `OFFICIAL`;
 *    trade volumes render `ESTIMATE` with `unit: "metric tons"`. The adapter
 *    already tiers them; this panel's job is not to flatten them on the way out.
 *    Rendering a modelled tonnage as OFFICIAL would assert a measurement the
 *    IMF itself calls an estimate.
 * 4. **Transit counts are counts of TRANSITS, labelled as such.** PortWatch
 *    counts a vessel crossing the chokepoint boundary, once per transit, with a
 *    48-hour re-count threshold. That is not "traffic through the strait", and
 *    this panel never uses that phrase.
 * 5. **Licence `restricted-minimal`.** Figures with attribution and a link back;
 *    never a bulk redistribution of the dataset. This panel shows a window, and
 *    links to the source.
 */

/** Counts and volumes are different quantities and never share a column. */
export interface ChokepointSummary {
  chokepointId: string;
  chokepointName: string;
  /** Days actually present in the window, not the days it was asked for. */
  days: number;
  first: string | null;
  last: string | null;
  /** Total counted transits across the window, over the days that carried one. */
  transitTotal: number;
  /** Estimated payload, metric tons. Never added to a transit count. */
  volumeTotal: number;
  /**
   * How many days actually contributed a figure.
   *
   * A `Fact` may hold `null`, which means the source did not give a value —
   * NOT that zero vessels crossed. Adding a null as zero would turn "we do not
   * know" into "nothing happened", which is rule 30's whole subject, and on
   * this panel it would understate a strait's activity while looking precise.
   * So nulls are excluded from the sum and counted here instead.
   */
  transitDaysCounted: number;
  volumeDaysCounted: number;
}

/**
 * The window PortWatch actually returned, summarised.
 *
 * `days` counts rows PRESENT, never the span requested. A window asked for
 * seven days that returns four has four days of evidence, and reporting seven
 * would turn a gap in the source into an assertion about the strait.
 */
export function summarise(rows: readonly ChokepointDay[]): ChokepointSummary | null {
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  if (!first) return null;

  let transitTotal = 0;
  let volumeTotal = 0;
  let transitDaysCounted = 0;
  let volumeDaysCounted = 0;
  for (const row of sorted) {
    const transits = row.transits.total.value;
    if (transits !== null) {
      transitTotal += transits;
      transitDaysCounted += 1;
    }
    const volume = row.volume.total.value;
    if (volume !== null) {
      volumeTotal += volume;
      volumeDaysCounted += 1;
    }
  }

  return {
    chokepointId: first.chokepointId,
    chokepointName: first.chokepointName,
    days: sorted.length,
    first: first.date,
    last: sorted[sorted.length - 1]?.date ?? null,
    transitTotal,
    volumeTotal,
    transitDaysCounted,
    volumeDaysCounted,
  };
}

/**
 * Which countries' risk tabs show which chokepoint.
 *
 * **This is a routing choice made by this app, not a claim about territory.**
 * The distinction matters most for exactly this chokepoint: the Strait of
 * Hormuz is bordered by states with contested maritime claims, and a list that
 * looked like an assertion of control would be taking a side in a live dispute
 * while pretending to be a lookup table.
 *
 * So it says what it is: these are the countries for which this app considers
 * the panel *relevant enough to show*. Showing it does not assert that a
 * country controls the strait, and omitting a country does not assert that it
 * has no interest in it.
 */
export const CHOKEPOINT_RELEVANCE: Record<string, readonly string[]> = {
  chokepoint1: ['IRN', 'OMN', 'ARE'],
};

/** Whether this app routes a chokepoint panel onto a country's risk tab. */
export function chokepointsFor(iso3: string): string[] {
  return Object.entries(CHOKEPOINT_RELEVANCE)
    .filter(([, codes]) => codes.includes(iso3))
    .map(([id]) => id);
}

const SOURCE_ID = 'portwatch-chokepoints';

function sourceHomepage(): string {
  return getSource(SOURCE_ID)?.homepage ?? '';
}

function sourceAttribution(): string {
  return getSource(SOURCE_ID)?.attribution ?? 'IMF PortWatch.';
}

/** The captured window, parsed through the app's own adapter. */
export function capturedDays(): ChokepointDay[] {
  return parse(chokepointCapture, {
    sourceId: 'portwatch-chokepoints',
    /*
     * Not a URL, deliberately. This window comes from a committed capture, and
     * writing a plausible-looking request URL here would put a host in `src/`
     * that nobody registered — and, worse, would let a provenance inspector
     * show a request this app never made.
     */
    requestUrl: 'committed capture — no request was made',
    fetchedAt: new Date(0).toISOString(),
  } as never);
}

/**
 * The risk tab's chokepoint section for one country.
 *
 * A country this app does not route a chokepoint to gets the app-owned gap
 * wording, never silence and never an implication that no chokepoint concerns
 * it — decision #32's distinction, applied here.
 */
export function renderRiskChokepoints(iso3: string): string {
  const ids = chokepointsFor(iso3);
  if (ids.length === 0) {
    return `<div class="choke-none"><p><strong>No chokepoint monitor is connected for this country.</strong>
      This app routes its chokepoint panel to a small number of countries; that is a limit of what
      is wired here, not a statement that no chokepoint affects this one.</p></div>`;
  }

  const days = capturedDays();
  return ids.map((id) => renderChokepoint(days.filter((row) => row.chokepointId === id))).join('');
}

export function renderChokepoint(rows: readonly ChokepointDay[]): string {
  const summary = summarise(rows);
  if (summary === null) {
    return `<section class="choke" aria-label="Chokepoint transits">
      <h3 class="choke-title">Chokepoint transits</h3>
      <p class="choke-empty">No days were returned for this window. That is a gap in what this
        app received, not a statement that nothing crossed.</p>
    </section>`;
  }

  const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];

  return `<section class="choke" aria-label="Chokepoint transits">
    <h3 class="choke-title">${escapeHtml(summary.chokepointName)} — counted transits</h3>

    <p class="choke-window">
      ${n(summary.days, 'a count of days PRESENT in what the source returned, not the span requested')} day(s)
      returned, ${escapeHtml(summary.first ?? '—')} to ${escapeHtml(summary.last ?? '—')}.
    </p>

    ${
      summary.transitDaysCounted < summary.days
        ? `<p class="choke-unmeasured">${n(summary.days - summary.transitDaysCounted, 'a count of returned days carrying no transit figure')}
           of those day(s) carried no transit figure and are excluded from the totals. An absent
           figure is not a day on which nothing crossed.</p>`
        : ''
    }

    <dl class="choke-figures">
      <dt>Transits counted</dt>
      <dd class="choke-transits">${latest ? factHtml(latest.transits.total) : '—'}</dd>

      <dt>Estimated payload</dt>
      <dd class="choke-volume">${latest ? factHtml(latest.volume.total) : '—'}</dd>
    </dl>

    <!--
      WHAT A TRANSIT IS. Requirement 4: never "traffic through the strait".
      PortWatch counts a crossing of the chokepoint boundary, once per transit,
      with a 48-hour re-count threshold — so this is a count of crossings by
      broadcasting vessels, and saying anything broader would be a claim the
      data cannot carry.
    -->
    <p class="choke-what">
      A <strong>transit</strong> is one crossing of the chokepoint boundary by a vessel that was
      broadcasting, counted once, with a 48-hour threshold before the same vessel is counted
      again. It is a count of crossings — not a measure of traffic through the strait, and not a
      measure of what was carried.
    </p>

    <!--
      Requirement 1 and 2. The text is AIS_CAVEAT, imported rather than retyped,
      and it opens by saying whose caveat it is. Its basis renders here on the
      surface, not only in the inspector.
    -->
    <p class="choke-caveat">${escapeHtml(AIS_CAVEAT)}</p>

    <!--
      Attribution and the link back come from the REGISTRY, not from a literal
      typed here. Two reasons, and the second is why the scanner caught it:
      the registry is where a source's homepage and attribution are curated, and
      a bare host written into src/ is a host nobody registered — which is
      exactly what tests/registry-coverage.test.ts refuses.
    -->
    <p class="choke-attribution">
      Source: <a href="${escapeHtml(sourceHomepage())}" rel="noopener noreferrer" target="_blank">${escapeHtml(sourceAttribution())}</a>
      Figures shown with attribution under a restricted licence — this app displays a window, and
      does not redistribute the dataset.
    </p>
  </section>`;
}
