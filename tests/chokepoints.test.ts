import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { capturedDays, renderChokepoint, summarise } from '../src/ui/chokepoints';
import { AIS_CAVEAT, type ChokepointDay } from '../src/sources/portwatch';

function day(over: Partial<ChokepointDay> = {}): ChokepointDay {
  const fact = (value: number | null, tier: 'OFFICIAL' | 'ESTIMATE', unit?: string) =>
    ({ value, asOf: '2026-08-07', tier, ...(unit ? { unit } : {}), provenance: null }) as never;

  return {
    chokepointId: 'chokepoint1',
    chokepointName: 'Strait of Hormuz',
    date: '2026-08-07',
    transits: {
      container: fact(3, 'OFFICIAL'),
      dryBulk: fact(4, 'OFFICIAL'),
      generalCargo: fact(2, 'OFFICIAL'),
      roro: fact(1, 'OFFICIAL'),
      tanker: fact(9, 'OFFICIAL'),
      cargo: fact(10, 'OFFICIAL'),
      total: fact(19, 'OFFICIAL'),
    },
    volume: {
      cargo: fact(500_000, 'ESTIMATE', 'metric tons'),
      tanker: fact(900_000, 'ESTIMATE', 'metric tons'),
      total: fact(1_400_000, 'ESTIMATE', 'metric tons'),
    },
    ...over,
  } as ChokepointDay;
}

test('the captured window parses through the app\'s own adapter', () => {
  const days = capturedDays();
  assert.ok(days.length > 0, 'the real capture produced no days');
  assert.ok(days.every((d) => typeof d.date === 'string' && d.date !== ''));
});

test('summarise reports the days PRESENT, never the span requested', () => {
  const summary = summarise([day({ date: '2026-08-01' }), day({ date: '2026-08-04' })]);
  assert.ok(summary);
  assert.equal(summary.days, 2, 'a 4-day span with 2 rows has 2 days of evidence');
  assert.equal(summary.first, '2026-08-01');
  assert.equal(summary.last, '2026-08-04');
});

/**
 * PLANTED (rule 27 / rule 30): a null figure must not be summed as zero.
 *
 * A `Fact` holding null means the source gave no value. Adding it as zero would
 * turn "we do not know" into "nothing crossed" — and on a strait monitor that
 * understates activity while looking precise.
 */
test('planted: a null transit figure is excluded from the total, not counted as zero', () => {
  const nullDay = day({ date: '2026-08-02' });
  (nullDay.transits.total as { value: number | null }).value = null;

  const summary = summarise([day({ date: '2026-08-01' }), nullDay]);
  assert.ok(summary);
  assert.equal(summary.transitTotal, 19, 'the null day must contribute nothing to the sum');
  assert.equal(summary.transitDaysCounted, 1, 'and must be excluded from the days counted');
  assert.equal(summary.days, 2, 'while still being a day the source returned');
});

test('an unmeasured day is disclosed on the surface, not silently dropped', () => {
  const nullDay = day({ date: '2026-08-02' });
  (nullDay.transits.total as { value: number | null }).value = null;

  const html = renderChokepoint([day({ date: '2026-08-01' }), nullDay]).replace(/\s+/g, ' ');
  assert.match(html, /carried no transit figure/i);
  assert.match(html, /not a day on which nothing crossed/i);
});

test('an empty window says the gap is ours, not the strait\'s', () => {
  const html = renderChokepoint([]).replace(/\s+/g, ' ');
  assert.match(html, /gap in what this app received/i);
  assert.match(html, /not a statement that nothing crossed/i);
});

/**
 * REQUIREMENT 1 and 2 — the caveat renders, verbatim from the adapter, as OURS,
 * with its basis on the surface rather than only in an inspector.
 */
test('the AIS caveat renders verbatim, attributed to us, with its basis inline', () => {
  const html = renderChokepoint([day()]).replace(/\s+/g, ' ');

  // Verbatim, so the panel and the assertion cannot drift apart.
  assert.ok(
    html.includes(AIS_CAVEAT.replace(/\s+/g, ' ').replace(/&/g, '&amp;').replace(/'/g, '&#39;')) ||
      html.includes(AIS_CAVEAT.replace(/\s+/g, ' ')),
    'AIS_CAVEAT did not render verbatim',
  );

  assert.match(html, /Our caveat, not the IMF/i, 'must not be attributed to the IMF');
  assert.match(html, /Arslanalp, Koepke &amp; Verschuur, IMF WP\/2021\/225/i, 'basis must be on the surface');
  assert.match(html, /can be jammed or spoofed/i);
  assert.match(html, /not counted/i);
});

/**
 * REQUIREMENT 3 — the tier split survives to the badge. Rendering a modelled
 * tonnage as OFFICIAL would assert a measurement the IMF calls an estimate.
 */
test('transit counts render OFFICIAL and volumes render ESTIMATE, never flattened', () => {
  /*
   * THE REAL CAPTURE, not the synthetic day above.
   *
   * The first version used the local helper, whose facts carry no provenance —
   * and the badge component correctly rendered them UNTRACEABLE rather than
   * honouring a tier it could not trace. That is the fact discipline working,
   * and it means a tier assertion is only meaningful against facts the adapter
   * actually produced. Rule 46's principle: borrow the real body.
   */
  const html = renderChokepoint(capturedDays());
  const transits = /<dd class="choke-transits">([\s\S]*?)<\/dd>/.exec(html)?.[1] ?? '';
  const volume = /<dd class="choke-volume">([\s\S]*?)<\/dd>/.exec(html)?.[1] ?? '';

  assert.match(transits, /OFFICIAL/, 'transit counts must carry the OFFICIAL badge');
  assert.match(volume, /ESTIMATE/, 'volumes must carry the ESTIMATE badge');
  assert.ok(!/OFFICIAL/.test(volume), 'a modelled tonnage must never render as OFFICIAL');
});

/**
 * REQUIREMENT 4 — a transit is a crossing, and the panel never claims more.
 * "Traffic through the strait" is the specific phrase the spec forbids.
 */
test('the panel says what a transit is, and never calls it traffic through the strait', () => {
  const html = renderChokepoint([day()]).replace(/\s+/g, ' ');

  assert.match(html, /one crossing of the chokepoint boundary/i);
  assert.match(html, /48-hour threshold/i);
  assert.match(html, /not a measure of traffic through the strait/i);

  /*
   * The forbidden claim must not appear as an ASSERTION anywhere on the panel.
   *
   * Checked by removing what is allowed and requiring nothing to be left, which
   * is legible in a way a lookbehind is not: strip HTML comments (not visible
   * to a reader, but they do ship in the markup), strip the one sanctioned
   * sentence that negates the phrase, and the phrase must then be absent.
   *
   * The first version of this test caught my own explanatory comment using the
   * forbidden words. That is the check working — markup I ship is markup I am
   * accountable for.
   */
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/not a measure of traffic through the strait/gi, '');
  assert.ok(
    !/traffic through the strait/i.test(visible),
    'the panel asserted "traffic through the strait"',
  );
});

/** REQUIREMENT 5 — attribution and a link back, and no claim to redistribute. */
test('attribution links back and disclaims redistribution', () => {
  const html = renderChokepoint([day()]).replace(/\s+/g, ' ');
  assert.match(html, /portwatch\.imf\.org/);
  assert.match(html, /does not redistribute the dataset/i);
});
