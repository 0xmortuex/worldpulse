/**
 * Loads the built app in Chromium and asserts the step-1 interaction actually
 * works: globe renders, default selection lands on the USA, relations mode
 * classifies, multi-select opens compare, and the weight sliders recolour.
 *
 * Usage: node scripts/verify-render.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = 'artifacts';

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

/**
 * TESTING.md rule 8: existing is not working.
 *
 * Presence and text assertions are blind to layout. This measures geometry:
 * nothing overflows its container, no two siblings overlap, and nothing has
 * collapsed to zero size — a collapsed element is invisible, not absent, so
 * presence checks pass on it.
 */
async function assertLayout(page, containerSelector, childSelector, label) {
  const report = await page.evaluate(
    ([container, child]) => {
      const root = document.querySelector(container);
      if (!root) return { error: `container ${container} not found` };
      const rootBox = root.getBoundingClientRect();
      const kids = [...root.querySelectorAll(child)]
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            tag: el.className || el.tagName,
            x: Math.round(box.x), y: Math.round(box.y),
            w: Math.round(box.width), h: Math.round(box.height),
          };
        });
      return { rootBox: { x: rootBox.x, y: rootBox.y, w: rootBox.width, h: rootBox.height }, kids };
    },
    [containerSelector, childSelector],
  );

  if (report.error) {
    check(`${label}: layout`, false, report.error);
    return;
  }
  if (report.kids.length === 0) {
    check(`${label}: layout`, false, `no visible children matched ${childSelector}`);
    return;
  }

  const problems = [];
  const { rootBox, kids } = report;

  for (const kid of kids) {
    if (kid.w <= 0 || kid.h <= 0) problems.push(`${kid.tag} collapsed to ${kid.w}x${kid.h}`);
    // 1px tolerance for sub-pixel rounding.
    if (kid.x < rootBox.x - 1 || kid.x + kid.w > rootBox.x + rootBox.w + 1) {
      problems.push(`${kid.tag} overflows horizontally (${kid.x}..${kid.x + kid.w} vs ${Math.round(rootBox.x)}..${Math.round(rootBox.x + rootBox.w)})`);
    }
  }

  for (let i = 0; i < kids.length; i += 1) {
    for (let j = i + 1; j < kids.length; j += 1) {
      const a = kids[i];
      const b = kids[j];
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapW > 1 && overlapH > 1) {
        problems.push(`${a.tag} overlaps ${b.tag} by ${overlapW}x${overlapH}px`);
      }
    }
  }

  check(`${label}: no overlap or overflow`, problems.length === 0, problems.slice(0, 3).join('; '));
}

/**
 * TESTING.md rule 9: geometry cannot prove readability.
 *
 * scrollWidth > clientWidth means the text does not fit its box — the direct
 * test for clipping, independent of formatting strategy. SVG text is measured
 * with getComputedTextLength() instead, since scrollWidth does not apply.
 *
 * Rule 9b: a value clipped without an ellipsis is a DIFFERENT NUMBER, not an
 * approximation. Prose may ellipsize visibly; values may not.
 */
async function assertTextFits(page, selector, label, options = {}) {
  const clipped = await page.evaluate(
    ([sel, allowEllipsis]) => {
      const out = [];
      for (const el of document.querySelectorAll(sel)) {
        if (el.getClientRects().length === 0) continue;
        const text = (el.textContent ?? '').trim();
        if (text.length === 0) continue;
        const style = getComputedStyle(el);
        // A visible ellipsis is permitted on prose only, and the caller says so.
        const ellipsized = style.textOverflow === 'ellipsis';
        if (allowEllipsis && ellipsized) continue;
        if (el.scrollWidth > el.clientWidth + 1) {
          out.push({ cls: String(el.className).slice(0, 40), text: text.slice(0, 48), scroll: el.scrollWidth, client: el.clientWidth });
        }
      }
      return out;
    },
    [selector, options.allowEllipsis === true],
  );
  check(`${label}: text not clipped`, clipped.length === 0, JSON.stringify(clipped.slice(0, 3)));
}

/** SVG text has no scrollWidth; measure the rendered advance instead. */
async function assertSvgTextFits(page, selector, maxPx, label) {
  const overflowing = await page.evaluate(
    ([sel, budget]) =>
      [...document.querySelectorAll(sel)]
        .filter((el) => el.getComputedTextLength && el.getComputedTextLength() > budget)
        .map((el) => ({ text: el.textContent, width: Math.round(el.getComputedTextLength()) })),
    [selector, maxPx],
  );
  check(`${label}: SVG text within ${maxPx}px`, overflowing.length === 0, JSON.stringify(overflowing.slice(0, 3)));
}

const BREAKPOINTS = [
  { width: 360, height: 780, name: '360px' },
  { width: 900, height: 800, name: '900px' },
  { width: 1600, height: 950, name: 'desktop' },
];

// This environment ships Chromium out of band; PLAYWRIGHT_CHROMIUM_PATH points
// at it so the npm package's pinned build number does not have to match.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // Software rasterise: there is no GPU here, and without this the globe
  // renders as an empty canvas and every check below passes vacuously.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

// Uncaught exceptions are always fatal. Resource-load failures are separated
// out because this build environment blocks all external hosts, so portrait
// images legitimately 403 here — the app is required to degrade gracefully, and
// that degradation is asserted directly further down rather than inferred from
// a silent console.
const pageErrors = [];
const resourceErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/Failed to load resource/i.test(text)) resourceErrors.push(text);
  else pageErrors.push(text);
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

await mkdir(SHOTS, { recursive: true });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log('\nstep 1 render checks');

// Globe actually drew something, rather than failing silently to a black box.
const canvasPixels = await page.evaluate(() => {
  const canvas = document.querySelector('#globe canvas');
  if (!canvas) return null;
  return { width: canvas.width, height: canvas.height };
});
check('globe canvas present and sized', canvasPixels !== null && canvasPixels.width > 100, JSON.stringify(canvasPixels));

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const seedVisible = await page.locator('#seed-banner strong').first().isVisible();
check('seed-data banner is visible', seedVisible);

const mode = await page.locator('#mode').textContent();
check('opens in relations mode', mode?.trim() === 'Relations mode', `got "${mode}"`);

const heading = await page.locator('#panel h2').first().textContent();
check('default selection is the United States', /United States/.test(heading ?? ''), `got "${heading}"`);

// Tier counts must be populated, and no-data must dominate — the seed set is
// partial and the UI is supposed to make that obvious.
const counts = await page.locator('.tier-count-n').allTextContents();
check('tier counts rendered', counts.length === 5, counts.join(','));
const [allies, , , , nodata] = counts.map(Number);
check('USA has allies from the seed set', allies > 20, `allies=${allies}`);
check('most countries read as no data', nodata > 100, `nodata=${nodata}`);

await page.screenshot({ path: `${SHOTS}/01-relations-usa.png` });

// Hovering the globe must raise a tooltip. This is the only check that proves
// country polygons actually rendered: a bare sphere with no polygons still
// produces a correctly sized canvas, so pixel dimensions alone prove nothing.
const box = await page.locator('#globe canvas').boundingBox();
let tooltipSeen = false;
for (const [dx, dy] of [[0, 0], [-0.12, 0.05], [0.1, -0.08], [0.05, 0.15]]) {
  await page.mouse.move(box.x + box.width * (0.5 + dx), box.y + box.height * (0.5 + dy));
  await page.waitForTimeout(400);
  if (await page.locator('.pop-title').first().isVisible().catch(() => false)) {
    tooltipSeen = true;
    break;
  }
}
check('hovering the globe hits a country polygon', tooltipSeen);
if (tooltipSeen) await page.screenshot({ path: `${SHOTS}/04-traceability-popover.png` });

// Select a second country by keyboard, which doubles as the no-pointer path.
await page.locator('.search-input').fill('China');
await page.waitForTimeout(250);
await page.keyboard.down('Control');
await page.keyboard.press('Enter');
await page.keyboard.up('Control');
await page.waitForTimeout(600);

const compareMode = await page.locator('#mode').textContent();
check('ctrl-click adds a country and opens compare', /Compare mode · 2/.test(compareMode ?? ''), `got "${compareMode}"`);
const compareRows = await page.locator('table.compare tbody tr').count();
check('compare table renders a row per tier', compareRows === 5, `rows=${compareRows}`);

await page.screenshot({ path: `${SHOTS}/02-compare.png` });

// Back to single selection, then prove the sliders actually recolour.
await page.locator('.search-input').fill('United States');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('plain selection replaces rather than adds', (await page.locator('#mode').textContent())?.trim() === 'Relations mode');

const before = await page.locator('.tier-count-n').allTextContents();
const slider = page.locator('input[name="sharedDefenseBloc"]');
await slider.fill('-8');
await slider.dispatchEvent('input');
await page.waitForTimeout(600);
const after = await page.locator('.tier-count-n').allTextContents();
check('weight slider changes the classification', before.join() !== after.join(), `${before.join()} -> ${after.join()}`);

await page.screenshot({ path: `${SHOTS}/03-weights-inverted.png` });

// ---- step 2: confidence badges and the provenance inspector ----
//
// Per docs/TESTING.md rule 1, these assert on behaviour a broken component
// could not fake: the inspector must actually surface the request URL and raw
// body for the clicked fact.

await page.locator('.rail-reset').click();
await page.waitForTimeout(400);

const tiers = await page.locator('.gallery .badge').allTextContents();
check('gallery renders every badge state', tiers.length >= 6, tiers.join(' | '));
check('an untraceable value renders as broken', tiers.some((t) => t.includes('UNTRACEABLE')));
check('a key-gated source renders as unconfigured', tiers.some((t) => t.includes('KEY NOT SET')));
check(
  'OFFICIAL, ESTIMATE and DERIVED are all present and distinct',
  ['OFFICIAL', 'ESTIMATE', 'DERIVED'].every((tier) => tiers.some((t) => t.includes(tier))),
);

// Tier styling must differ, not just the text — the spec requires ESTIMATE and
// DERIVED to be unmistakable for OFFICIAL at a glance.
const styles = await page.evaluate(() =>
  ['official', 'estimate', 'derived', 'broken'].map((tier) => {
    const el = document.querySelector(`.badge--${tier}`);
    if (!el) return null;
    const s = getComputedStyle(el);
    return `${s.color}|${s.borderStyle}|${s.backgroundColor}`;
  }),
);
check('each tier is visually distinct', new Set(styles.filter(Boolean)).size === styles.filter(Boolean).length, styles.join(' // '));

// Open the inspector on the World Bank fixture badge.
await page.locator('.gallery .badge--official').first().click();
await page.waitForTimeout(400);
const inspectorVisible = await page.locator('.inspector-body').isVisible();
check('clicking a badge opens the provenance inspector', inspectorVisible);

const inspectorText = await page.locator('.inspector-body').innerText();
check('inspector shows the request URL', inspectorText.includes('api.worldbank.org'), '');
check('inspector shows the fetch timestamp', /Fetched at/.test(inspectorText));
check('inspector shows cache state', /hit|miss/i.test(inspectorText));
check('inspector shows the licence class', /CC BY 4\.0/.test(inspectorText) && /open/i.test(inspectorText));
check('inspector flags fixture-sourced data', /fixture/i.test(inspectorText));
check('inspector marks the source as documentation-verified', /documentation/i.test(inspectorText));

const rawShown = await page.locator('.inspector-raw pre').innerText();
check('inspector shows the raw response body', rawShown.includes('NY.GDP.MKTP.CD'), rawShown.slice(0, 60));

await page.screenshot({ path: `${SHOTS}/05-inspector.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes the inspector', !(await page.locator('.inspector-body').isVisible().catch(() => false)));
check(
  'Escape closing the inspector does not also clear the selection',
  (await page.locator('#mode').textContent())?.trim() === 'Relations mode',
);

// The broken state must be loud in the inspector too, not just the badge.
await page.locator('.gallery .badge--broken').first().click();
await page.waitForTimeout(400);
const alarm = await page.locator('.inspector-alarm').isVisible().catch(() => false);
check('untraceable value raises an alarm in the inspector', alarm);
await page.screenshot({ path: `${SHOTS}/06-broken.png` });
await page.keyboard.press('Escape');

// A derived fact must expose its arithmetic and walk down to its seed inputs.
await page.waitForTimeout(300);
await page.locator('.relation-list .badge').first().click();
await page.waitForTimeout(400);
const derivedText = await page.locator('.inspector-body').innerText().catch(() => '');
check('a derived fact shows its arithmetic', /Arithmetic/i.test(derivedText), derivedText.slice(0, 80));
check('a derived fact lists its inputs', /Inputs \(\d+\)/i.test(derivedText));
check('derived inputs resolve to seed citations', /Checked against/i.test(derivedText));
await page.screenshot({ path: `${SHOTS}/07-derived-provenance.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---- step 3: dossier header and leader resolution ----

async function selectCountry(name) {
  await page.locator('.search-input').fill(name);
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

// Rule 2 — presidential, one portrait.
await selectCountry('United States');
const usHeader = await page.locator('.dossier').innerText();
check('dossier header renders vitals', /Capital/i.test(usHeader) && /Population/i.test(usHeader));
check('header states which resolution rule fired', /Rule 2/i.test(usHeader), usHeader.slice(0, 120));
check('presidential renders a single portrait', (await page.locator('.dossier .portrait').count()) === 1);
check('office title is shown verbatim', /President of the United States/.test(usHeader));
await page.screenshot({ path: `${SHOTS}/08-dossier-presidential.png` });

// Rule 3 — parliamentary, two portraits, head of government first.
await selectCountry('United Kingdom');
check('parliamentary renders two portraits', (await page.locator('.dossier .portrait').count()) === 2);
const roles = await page.locator('.dossier .portrait-role').allTextContents();
check('head of government leads a parliamentary system', /head of government/i.test(roles[0] ?? ''), roles.join(' | '));
check('the monarch is the labelled secondary', /monarch/i.test(roles[1] ?? ''), roles.join(' | '));
check('primary portrait frame is larger than the secondary', await page.evaluate(() => {
  const frames = [...document.querySelectorAll('.dossier .portrait-frame')].map((f) => f.getBoundingClientRect().width);
  return frames.length === 2 && frames[0] > frames[1];
}), JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll('.dossier .portrait-frame')].map((f) => Math.round(f.getBoundingClientRect().width)))));
await page.screenshot({ path: `${SHOTS}/09-dossier-dual-portrait.png` });

// Rule 1 — de facto authority, with the override citation on screen.
await selectCountry('Iran');
const iranHeader = await page.locator('.dossier').innerText();
check('de facto authority fires rule 1', /Rule 1/i.test(iranHeader), iranHeader.slice(0, 140));
check('override citation is shown', /Reviewed override/i.test(iranHeader));
check('the supreme authority leads, not the president', /Supreme authority/i.test((await page.locator('.dossier .portrait-role').first().innerText())));
await page.screenshot({ path: `${SHOTS}/10-dossier-de-facto.png` });

// Rule 5 — junta title is not normalised.
await selectCountry('Mali');
const maliHeader = await page.locator('.dossier').innerText();
check('transitional government fires rule 5', /Rule 5/i.test(maliHeader));
check('the literal junta title survives to the DOM', /Chairman, Transitional Military Council/.test(maliHeader));
check('the junta title is not smoothed to President', !/\bPresident\b/.test(maliHeader), maliHeader.slice(0, 160));
await page.screenshot({ path: `${SHOTS}/11-dossier-junta.png` });

// Missing P18 — initials placeholder, and never a substitute photograph.
await selectCountry('Canada');
check('a leader with no P18 falls back to an initials placeholder',
  (await page.locator('.dossier .portrait-frame--placeholder').count()) >= 1);
check('the placeholder carries no image element',
  (await page.locator('.dossier .portrait-img').count()) === 0);

// A portrait whose image cannot load must fall back to initials, not to a
// broken-image icon and not to a blank frame that reads as an unnamed person.
// Every external host is blocked here, so every Commons URL fails — which makes
// this environment an unusually good test of the degradation path.
await selectCountry('United States');
await page.waitForTimeout(600);
check('a portrait whose image fails to load degrades to initials',
  await page.evaluate(() => {
    const placeholder = document.querySelector('.dossier .portrait-frame--placeholder');
    if (!placeholder) return false;
    const img = document.querySelector('.dossier .portrait-img');
    return img === null && placeholder.textContent.trim().length > 0;
  }));
check('blocked portrait requests were actually observed', resourceErrors.length > 0,
  'expected the sandbox to block commons.wikimedia.org');

// A country with no dossier fixture must say so, not render an empty header.
await selectCountry('Japan');
check('a country with no dossier data says so', /No dossier data/i.test(await page.locator('.dossier').innerText()));

// Leader detail sheet.
await selectCountry('United States');
await page.locator('.dossier .portrait').first().click();
await page.waitForTimeout(400);
const sheet = await page.locator('.sheet-body').innerText();
check('clicking a portrait opens the leader sheet', (await page.locator('.sheet-body').isVisible()));
check('sheet shows the biography', /synthetic person/i.test(sheet));
check('sheet lists unbuilt sections as no data rather than hiding them',
  /Career timeline/i.test(sheet) && /No data/i.test(sheet));
await page.screenshot({ path: `${SHOTS}/12-leader-sheet.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes the leader sheet without clearing the selection',
  !(await page.locator('.sheet-body').isVisible().catch(() => false)) &&
    (await page.locator('#mode').textContent())?.trim() === 'Relations mode');

// ---- step 4: government tab ----

await selectCountry('United Kingdom');
check('dossier tabs render', (await page.locator('.tabs .tab').count()) === 7);
check('government is the default tab', (await page.locator('.tab--active').innerText()).trim() === 'Government');

const govGbr = await page.locator('.gov').innerText();
check('cabinet renders ministries', (await page.locator('.ministry').count()) > 0);
check('a ministry gloss comes from Wikidata', /foreign relations/i.test(govGbr));
check('a missing gloss says so instead of inventing one', /No plain-English description/i.test(govGbr));
check('legislature seat totals render', /650/.test(govGbr));
check('a complete party split draws a bar', (await page.locator('.party-bar').count()) === 1);
check('a chamber with no party data draws no bar', /records no party composition/i.test(govGbr));
await page.screenshot({ path: `${SHOTS}/13-government-gbr.png` });

// Hard case: partial party data must NOT be drawn as a bar.
await selectCountry('Saudi Arabia');
const govSau = await page.locator('.gov').innerText();
check('partial party data is refused, not drawn', (await page.locator('.party-bar').count()) === 0);
check('the refusal explains itself', /seats are accounted for/i.test(govSau), govSau.slice(0, 200));

// Hard case: 58-post cabinet.
await selectCountry('Germany');
const ministriesShown = await page.locator('.ministry:not(.ministry--hidden)').count();
check('a large cabinet collapses rather than dumping 58 rows', ministriesShown <= 12, `shown=${ministriesShown}`);
check('the full count is stated up front', /58 posts/.test(await page.locator('.gov').innerText()));
await page.locator('[data-expand="cabinet"]').click();
await page.waitForTimeout(300);
check('expanding reveals every post', (await page.locator('.ministry:not(.ministry--hidden)').count()) === 58);
await page.screenshot({ path: `${SHOTS}/14-government-large-cabinet.png` });

// Hard case: untranslated portfolios.
await selectCountry('Iran');
const govIrn = await page.locator('.gov').innerText();
check('untranslated portfolios are flagged, not translated', /no English label/i.test(govIrn));
check('an untranslated portfolio keeps its identifier', /Q500[12]/.test(govIrn), govIrn.slice(0, 200));
check('a non-English label is kept rather than dropped', /Ministerio de Hacienda/.test(govIrn));

// Hard case: positions exist, no officeholders at all.
await selectCountry('Mali');
const govMli = await page.locator('.gov').innerText();
check('a cabinet with no holders still lists its posts', (await page.locator('.ministry').count()) === 3);
check('vacancies are counted rather than hidden', /3 of 3 positions have no current officeholder/i.test(govMli), govMli.slice(0, 200));
await page.screenshot({ path: `${SHOTS}/15-government-no-holders.png` });

// Leadership timeline and the leader sheet's filled sections.
await selectCountry('United States');
const govUsa = await page.locator('.gov').innerText();
check('leadership timeline renders ended terms', /→/.test(govUsa) && /present/i.test(govUsa));
check('an undated term is kept and labelled', /dates not recorded/i.test(govUsa));

await page.locator('.dossier .portrait').first().click();
await page.waitForTimeout(400);
const sheet4 = await page.locator('.sheet-body').innerText();
check('leader sheet now shows a career timeline', /Career timeline/i.test(sheet4) && /Senator/i.test(sheet4));
check('predecessor and successor render from qualifiers', /after Robin Fixture/i.test(sheet4) && /succeeded by Kim Fixture/i.test(sheet4));
await page.screenshot({ path: `${SHOTS}/16-leader-sheet-history.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Tab switching by keyboard, and unbuilt tabs naming their step.
// Key 6 is Live TV, which is still unbuilt. Retarget this whenever the tab it
// points at gets built, or it silently stops testing the pending-tab path.
await page.keyboard.press('6');
await page.waitForTimeout(300);
check('number keys switch dossier tabs', (await page.locator('.tab--active').innerText()).trim() === 'Live TV');
check('an unbuilt tab names the step that fills it', /step 11/.test(await page.locator('.gov').innerText()));
await page.keyboard.press('1');
await page.waitForTimeout(300);

// ---- step 5: economy tab ----

async function openEconomy(country) {
  await selectCountry(country);
  await page.locator('[data-tab="economy"]').click();
  await page.waitForTimeout(400);
}

await openEconomy('United States');
check('economy tab renders indicator blocks', (await page.locator('.econ-block').count()) > 0);
const econUsa = await page.locator('.econ').innerText();
check('every indicator states its own latest year', (await page.locator('.econ-asof').count()) > 1);
check('the panel refuses a single panel-wide as-of', /no single "as of" for this panel/i.test(econUsa));
check('a monetary value states its currency and basis', /US\$/.test(econUsa) && /Not adjusted for inflation/i.test(econUsa));
check('a chart is drawn', (await page.locator('svg.chart').count()) > 0);
await page.screenshot({ path: `${SHOTS}/17-economy-usa.png` });

// Hard case: an indicator with no data must not plot a flat line at zero.
check('an empty indicator renders a no-data card, not a zero line',
  (await page.locator('.chart--empty').count()) > 0);
check('the no-data card explains why nothing is plotted', /different claim/i.test(econUsa));
const emptyBlockHasLine = await page.evaluate(() => {
  const empty = document.querySelector('.chart--empty');
  return empty?.closest('.econ-block')?.querySelector('polyline') !== null;
});
check('the empty indicator has no polyline anywhere in its block', emptyBlockHasLine === false);

// Hard case: a gap must break the line.
await openEconomy('Kosovo');
const econGap = await page.locator('.econ').innerText();
const gapSegments = await page.locator('.econ-block[data-indicator="gdp"] polyline').count();
check('a mid-series gap breaks the line into two segments', gapSegments === 2, `segments=${gapSegments}`);
check('the gap is marked on the chart', (await page.locator('.chart-gap').count()) > 0);
check('the gap years are named and non-interpolation is stated',
  /2011–2014/.test(econGap) && /not interpolated/i.test(econGap), econGap.slice(0, 240));
await page.screenshot({ path: `${SHOTS}/18-economy-gap.png` });

// Hard case: a stale series.
await openEconomy('Eritrea');
const econStale = await page.locator('.econ').innerText();
check('a stale indicator states its age', /8 years old/.test(econStale), econStale.slice(0, 200));
check('a stale indicator states its latest year', /latest 2018/.test(econStale));

// Hard case: redenomination — log offered, and the toggle actually changes the plot.
await openEconomy('Zimbabwe');
const econZwe = await page.locator('.econ').innerText();
check('a wide-span series suggests a log scale', /orders of magnitude/i.test(econZwe), econZwe.slice(0, 200));
check('linear is the active scale before toggling', /linear scale/.test(econZwe));
const beforeToggle = await page.locator('.econ-block[data-indicator="gdp"] polyline').getAttribute('points');
await page.locator('.econ-block[data-indicator="gdp"] .econ-scale-toggle').click();
await page.waitForTimeout(400);
const afterToggle = await page.locator('.econ-block[data-indicator="gdp"] polyline').getAttribute('points');
check('the log toggle changes the plotted geometry', beforeToggle !== afterToggle);
check('the active scale is stated after toggling', /log scale/.test(await page.locator('.econ').innerText()));
await page.screenshot({ path: `${SHOTS}/19-economy-log.png` });

// Hard case: log refused where the indicator can go negative.
await openEconomy('Venezuela');
const econVen = await page.locator('.econ').innerText();
check('log is refused for an indicator that can go negative', /log unavailable/i.test(econVen), econVen.slice(0, 200));
check('no log toggle is offered where log is undefined',
  (await page.locator('.econ-block[data-indicator="inflation"] .econ-scale-toggle').count()) === 0);

// Scale choice must not leak across a country change.
await openEconomy('Zimbabwe');
await page.locator('.econ-block[data-indicator="gdp"] .econ-scale-toggle').click();
await page.waitForTimeout(300);
await openEconomy('United States');
check('a log toggle does not follow the user to another country',
  /linear scale/.test(await page.locator('.econ').innerText()));

// ---- step 6: news tab ----

async function openNews(country) {
  await selectCountry(country);
  await page.locator('[data-tab="news"]').click();
  await page.waitForTimeout(400);
}

await openNews('United States');
check('news tab renders articles', (await page.locator('.news-item').count()) > 0);
const newsUsa = await page.locator('.news').innerText();
check('coverage volume is framed as a property of the index',
  /indexes English-language online news that it crawls/i.test(newsUsa));
check('the tone chart renders', (await page.locator('svg.tone-chart').count()) === 1);
check('tone is labelled on the chart, not in a footnote',
  /Tone of coverage, not conditions/i.test(newsUsa));
check('tone carries a DERIVED badge beside its caption',
  (await page.locator('.tone-caption .badge--derived').count()) === 1);
await page.screenshot({ path: `${SHOTS}/20-news-usa.png` });

// Hard case: sparse coverage must read as an index limitation.
await openNews('Fiji');
const newsTuv = await page.locator('.news').innerText();
check('sparse coverage says little is INDEXED, not that little is happening',
  /Little English-language coverage/i.test(newsTuv) && /limitation of the source/i.test(newsTuv), newsTuv.slice(0, 200));
check('sparse coverage is visually flagged', (await page.locator('.news-coverage--sparse').count()) === 1);
check('an empty tone window plots nothing', (await page.locator('.news .chart--empty').count()) === 1);
await page.screenshot({ path: `${SHOTS}/21-news-sparse.png` });

// Hard case: non-Latin and RTL.
await openNews('Iran');
check('RTL headlines get dir=rtl', (await page.locator('.news-title[dir="rtl"]').count()) >= 3);
check('non-Latin outlet names render', await page.evaluate(() =>
  [...document.querySelectorAll('.news-outlet')].some((el) => /[\u0600-\u06FF]/.test(el.textContent))));
check('CJK headlines render', await page.evaluate(() =>
  [...document.querySelectorAll('.news-title')].some((el) => /[\u4E00-\u9FFF]/.test(el.textContent))));
await assertTextFits(page, '.news-item .news-title', 'RTL and CJK headlines');
await assertTextFits(page, '.news-item .news-outlet', 'non-Latin outlet names');
await page.screenshot({ path: `${SHOTS}/22-news-multiscript.png` });

// Hard case: degraded rows counted, not dropped silently.
await openNews('Mali');
const newsMli = await page.locator('.news').innerText();
check('unusable feed rows are counted and explained',
  /4 item\(s\) in the feed could not be shown/.test(newsMli), newsMli.slice(0, 240));
check('the reasons are named', /no usable web link|no usable timestamp/.test(newsMli));

// Hard case: syndication is deduplicated AND counted.
await openNews('United Kingdom');
const newsGbr = await page.locator('.news').innerText();
check('syndicated copies collapse to one row', (await page.locator('.news-item').count()) === 3);
check('the outlet count is shown rather than the copies hidden',
  /\+11 more outlets/.test(newsGbr), newsGbr.slice(0, 200));

// Hard case: a tone timeline with a hole in the middle.
await openNews('Kosovo');
check('a tone gap breaks the line',
  (await page.locator('.tone-chart polyline').count()) === 2);
check('the missing days are stated',
  /8 day\(s\) had no indexed coverage/.test(await page.locator('.news').innerText()));

// Topic filters.
await openNews('United States');
await page.locator('[data-topic="economy"]').click();
await page.waitForTimeout(300);
check('a topic filter narrows the list', (await page.locator('.news-item').count()) < 6);
check('filters are described as a convenience, not a classification',
  /not a classification/i.test(await page.locator('.news').innerText()));
await page.locator('[data-topic=""]').click();
await page.waitForTimeout(300);

// ---- text fidelity (TESTING.md rule 9), retroactive ----

await selectCountry('Germany');
await page.locator('[data-tab="economy"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.econ-block .fact-value', 'economy values');
await assertTextFits(page, '.econ-block .econ-name', 'economy indicator names');
await assertTextFits(page, '.econ-block .econ-asof', 'economy as-of labels');
await assertSvgTextFits(page, '.econ-block .chart-axis', 42, 'economy axis labels');

// The extreme-value fixture: the longest plausible strings on this surface.
await selectCountry('Zimbabwe');
await page.locator('[data-tab="economy"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.econ-block .fact-value', 'economy values at extreme magnitude');
await assertSvgTextFits(page, '.econ-block .chart-axis', 42, 'economy axis labels at extreme magnitude');
const zweAxis = await page.locator('.econ-block[data-indicator="gdp"] .chart-axis').allTextContents();
check('axis labels are compacted, not truncated', zweAxis.every((t) => /^-?[\d.]+[kMBTP]?$|^\d{4}$/.test(t.trim())), zweAxis.join(' | '));

await selectCountry('Germany');
await page.locator('[data-tab="government"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.ministry:not(.ministry--hidden) .ministry-label', 'ministry labels');
await assertTextFits(page, '.ministry:not(.ministry--hidden) .ministry-holder', 'ministry holders');
await assertTextFits(page, '.gov-count', 'cabinet count');

await selectCountry('United Kingdom');
await page.locator('[data-tab="government"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.party-legend .party-name', 'party names');
await assertTextFits(page, '.party-legend .party-seats', 'party seat counts');
await assertTextFits(page, '.term .term-dates', 'timeline dates');

await selectCountry('Germany');
await page.locator('[data-tab="news"]').click();
await page.waitForTimeout(400);
await assertTextFits(page, '.news-item .news-title', 'extreme-length headlines');
await assertTextFits(page, '.news-item .news-outlet', 'extreme-length outlet names');
await assertSvgTextFits(page, '.tone-chart .chart-axis', 60, 'tone axis labels');

// Header vitals, which carry population and dates.
await selectCountry('United Kingdom');
await assertTextFits(page, '.dossier-vitals .fact-value', 'header vitals');
await assertTextFits(page, '.portrait-vitals .fact-value', 'portrait vitals');

// ---- layout geometry at every breakpoint (TESTING.md rule 8) ----
//
// Applied retroactively to the dossier header, whose dual-portrait case
// rendered as overlapping soup with every other assertion green.

for (const breakpoint of BREAKPOINTS) {
  await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
  await page.waitForTimeout(400);

  // Parliamentary: the densest header, two portraits plus captions.
  await selectCountry('United Kingdom');
  await assertLayout(page, '.dossier', ':scope > *', `${breakpoint.name} header rows`);
  await assertLayout(page, '.dossier-main', ':scope > *', `${breakpoint.name} flag and titles`);
  await assertLayout(page, '.dossier-portraits', ':scope > .portrait', `${breakpoint.name} dual portraits`);
  await assertLayout(page, '.dossier-vitals', 'dd', `${breakpoint.name} vitals values`);

  // Rule 1: the widest rule block, with an override citation.
  await selectCountry('Iran');
  await assertLayout(page, '.rule-block', ':scope > *', `${breakpoint.name} rule block`);

  // Government tab: the densest panel in the app. The tab is selected
  // explicitly — a previous section may have left another tab active, and a
  // layout assertion against an absent container is a false pass waiting to
  // happen.
  await selectCountry('United Kingdom');
  await page.locator('[data-tab="government"]').click();
  await page.waitForTimeout(300);
  await assertLayout(page, '.tabs', ':scope > .tab', `${breakpoint.name} tab strip`);
  await assertLayout(page, '.gov', ':scope > .gov-block', `${breakpoint.name} government sections`);
  await assertLayout(page, '.ministry-list', ':scope > .ministry:not(.ministry--hidden)', `${breakpoint.name} ministry rows`);
  await assertLayout(page, '.party-legend', ':scope > li', `${breakpoint.name} party legend`);

  await selectCountry('Germany');
  await page.locator('[data-tab="government"]').click();
  await page.waitForTimeout(300);
  await assertLayout(page, '.ministry-list', ':scope > .ministry:not(.ministry--hidden)', `${breakpoint.name} large cabinet rows`);

  // Economy tab: charts are the first non-list layout in the app.
  await openEconomy('Zimbabwe');
  await assertLayout(page, '.econ', ':scope > .econ-block', `${breakpoint.name} economy blocks`);
  await assertLayout(page, '.econ-block[data-indicator="gdp"]', ':scope > *', `${breakpoint.name} indicator internals`);
  await assertTextFits(page, '.econ-block .fact-value', `${breakpoint.name} economy values`);
  await assertSvgTextFits(page, '.econ-block .chart-axis', 42, `${breakpoint.name} economy axis`);

  // News at every breakpoint: the multiscript feed is where a Latin-calibrated
  // layout fails, and 360px is where nobody screenshots.
  await openNews('Iran');
  await assertLayout(page, '.news-list', ':scope > .news-item', `${breakpoint.name} news rows`);
  await assertTextFits(page, '.news-item .news-title', `${breakpoint.name} RTL headlines`);
  await assertTextFits(page, '.news-item .news-outlet', `${breakpoint.name} RTL outlets`);

  await openNews('Germany');
  await assertTextFits(page, '.news-item .news-title', `${breakpoint.name} extreme headlines`);
  await assertTextFits(page, '.news-item .news-outlet', `${breakpoint.name} extreme outlets`);

  await page.screenshot({ path: `${SHOTS}/layout-${breakpoint.width}.png` });
}

await page.setViewportSize({ width: 1600, height: 950 });
await selectCountry('United Kingdom');
await page.waitForTimeout(400);

// Self-test: the geometry harness must be able to fail. Recreate the exact bug
// it was written for — the portraits laid back beside the title block, which is
// what produced the overlapping soup — and confirm it is caught.
const injected = await page.addStyleTag({
  content: `.dossier { position: relative; }
            .dossier-portraits { position: absolute; top: 0; left: 0; right: 0;
              margin-top: 0; padding-top: 0; border-top: none; }`,
});
await page.waitForTimeout(300);

const caughtOverlap = await (async () => {
  const before = failures.length;
  await assertLayout(page, '.dossier', ':scope > *', 'self-test (expected to fail)');
  const detected = failures.length > before;
  if (detected) failures.pop(); // the failure was the point
  return detected;
})();
check('the layout harness detects an overlap it is shown', caughtOverlap,
  'a geometry check that cannot fail is not a check');

await injected.evaluate((node) => node.remove());
await page.waitForTimeout(300);
await assertLayout(page, '.dossier', ':scope > *', 'header recovers after self-test');

await browser.close();

console.log(`\n${failures.length === 0 ? 'all checks passed' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
console.log(`screenshots in ${SHOTS}/`);
process.exit(failures.length === 0 ? 0 : 1);
