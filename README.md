# worldpulse

A single-page 3D globe that acts as a live intelligence dashboard for every country
on Earth: politics, government, military, economy, news, live TV and natural events.

**Current state: build step 7 of 14.** The globe, selection model, relations engine,
confidence badge, provenance inspector, dossier header, Government, Economy and News tabs, and the natural-event globe
layers work. No live data pipeline
yet — relations run on a hand-checked seed set and the adapters run against fixtures,
so both are provable before the ingests land.

---

## The one rule

Every rendered fact carries a confidence tier and an "as of" date:

| Tier | Meaning |
| --- | --- |
| `[OFFICIAL]` | From a government or IGO primary source. |
| `[ESTIMATE]` | From a credible third party but inherently approximate. |
| `[DERIVED]` | Inferred by this app, or extracted from news text. |

If data for a country is missing, the UI says **no data**. It never shows a
plausible-looking placeholder. A confident wrong number is worse than a blank.

**The badge is the only sanctioned way to render a fact.** Every badge is clickable
and opens the provenance inspector: request URL, raw response body, fetch timestamp,
cache hit or miss, licence class, and whether the source has ever been confirmed
against a live response. A value that reached the UI without a traceable request or
computation renders as **UNTRACEABLE**, loudly — an untraceable `[OFFICIAL]` badge is
the worst failure mode this app has, so it is made the most visible thing on screen
rather than being allowed to pass as authoritative.

`tests/fact-discipline.test.ts` enforces this statically: it fails the build when a
numeric expression is interpolated into DOM-bound markup anywhere outside `src/facts/`.
It uses real type information, so an intermediate variable does not evade it. The two
compliant ways to render a number are `factHtml(fact)` and, for numbers that genuinely
are not facts, `notAFact(value, reason)` — which requires a written reason at the call
site.

The rule deliberately flags layout numbers too (a portrait's pixel size, a CSS styling
hook). Carving out an exemption for style attributes would leave a hole a real fact could
slip through, so those are wrapped with a reason like anything else.

The rule runs on `typescript@5`, aliased as `ts-analyzer` and pinned exactly. The repo's
own `typescript@7` is the native port and exposes only `version` — no `createProgram`, no
type checker. A syntactic allowlist rule would have missed most of the violations this
one found, so the second compiler earns its place. **TODO: drop the alias once
typescript@7 exposes a checker API**, and delete this paragraph with it.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build
npm test             # unit, contract and static-analysis tests
npm run verify       # browser assertions against a freshly built bundle
npm run mutate       # proves the browser suite can fail, one mutation per step
npm run probe        # CORS + reachability verdicts for every source
npm run check:deploy # blocks a deploy while any source is unverified
PROBE_LIVE=1 npm test   # same contract assertions, against live sources
```

No API keys are needed. Copy `.env.example` to `.env` when you have them; every
key-gated panel degrades to "key not configured" rather than erroring.

### Verifying a build in a browser

```bash
npx vite preview --port 4173 &
npm run verify       # builds first, then asserts against that build
npm run mutate       # breaks one feature per step, requires the suite to notice
```

`verify` asserts rendered behaviour — the globe drew polygons, markers are pickable
and resolve to the event aimed at, values are badged, nothing overlaps or clips — and
prints a per-step table every run. It **refuses to start against a bundle older than
its sources**: it previously drove whatever was already serving the port, which meant a
green result could be produced without executing the code under test.

`mutate` exists because a suite that has never been observed failing proves nothing. It
breaks one real behaviour per step, rebuilds, and requires the assertion that names that
behaviour to fail. A surviving mutation is a check that cannot see its subject.

Screenshots land in `artifacts/`. Where Chromium is installed out of band, set
`PLAYWRIGHT_CHROMIUM_PATH`.

---

## The relations engine

Relation tiers are **computed, never hardcoded**, and the arithmetic is visible.
Hovering any recoloured country shows every input that produced its colour, each
with its weight, its source and the year that source's coverage ends.

### Default weights

Who counts as an ally is contested. These are this app's opinion, exposed as
sliders in the left rail so you can disagree with them and watch the map change.

| Input | Weight |
| --- | --- |
| Shared defence bloc | +3 |
| Bilateral defence treaty | +3 |
| Intelligence-sharing arrangement | +2 |
| Historical alliance (archival dataset) | +2 |
| Shared economic bloc | +1 |
| Active state-based conflict | −6 |
| Severed or absent diplomatic relations | −4 |
| Mutual sanctions | −4 |
| One-directional sanctions | −2 |
| Territorial dispute | −2 |
| Recalled ambassador | −1 |

### Thresholds

| Tier | Condition |
| --- | --- |
| Ally | score ≥ +3 |
| Adversary | score ≤ −4 |
| Strained | score ≤ −1 |
| Neutral | anything else, with at least one input |
| No data | no inputs at all |

Worked example — the popover for the United Kingdom with the United States selected:

```
Shared defence bloc          +3   NATO — North Atlantic Treaty (1949), Article 5   through 2026
Intelligence-sharing         +2   Five Eyes — UKUSA Agreement (1946)               through 2026
+3 +2 = 5 → ALLY
```

### Staleness and low confidence

Evidence older than five years renders greyed with its age. When more than half of
a classification's evidence weight is stale, the country is marked **low confidence**
and painted in a muted variant rather than a confident blue or red.

This matters because the alliance datasets the original spec proposed — Correlates
of War Formal Alliances v4.1 and ATOP — stop in 2012 and the late 2010s respectively.
Scoring "who is an ally today" from them would produce confidently wrong answers, so
current bloc membership carries the weight and the archival datasets are corroboration
that visibly announces its own age.

Low confidence applies at every tier that rests on evidence, neutral included: a pair
known only through a dataset that ended in 2012 must not read the same as one where
current evidence genuinely nets out to nothing. Only "no data" is exempt, having no
evidence to be stale about.

### Seed data

Step 1 reads `data/relations-seed.json`, a hand-checked fact table with a source
citation and coverage year on every entry. It is **not a data source** and does not
survive into production — step 10 replaces it with live ingests (Wikidata bloc
membership, UCDP GED, OFAC and EU sanctions lists) and deletes it. The app shows a
persistent SEED banner whenever it is in use, and coverage is deliberately partial so
most countries read as "no data".

---

## Leader resolution

Which portrait leads the dossier header is decided by a five-rule order, and **the rule
that fired is always shown**. A header that displays a face without saying why that face
was chosen is making an editorial judgement invisibly.

| Rule | Condition | Header |
| --- | --- | --- |
| 1 | A reviewed override records a de facto authority above the formal head of state | Supreme authority leads; formal head of state as labelled secondary |
| 2 | Presidential or semi-presidential | Head of state leads |
| 3 | Parliamentary republic or constitutional monarchy | Head of government leads; ceremonial head of state as smaller secondary |
| 4 | Monarch holds executive power | Monarch leads |
| 5 | Transitional or military government | Actual leader, with the **literal title in use** |
| 0 | Nothing matched | Says so, and shows whichever office was recorded |

Two things it will not do. It will not normalise an office title — a junta leader is
shown as "Chairman, Transitional Military Council" if that is the title in use, because
smoothing it to "President" launders a coup into a constitutional office. And it will not
guess when the form of government is unrecognised; that yields the undetermined class,
which says so on the header.

Classification is **label-driven**, not Q-id driven (`data/government-forms.json`).
Q-ids for forms of government could not be confirmed from this build environment, and a
wrong Q-id would silently misclassify a country's entire header, where a wrong English
label is checkable by eye. Populate the `qids` arrays once egress opens.

`data/leader-overrides.json` holds rule-1 corrections. Every entry needs a source
citation and a review date; **an override without one is ignored rather than trusted**.
Keep the list small — it is an admission that the general mechanism missed a case, not a
place to encode opinions about who really runs a country.

### Portraits

Wikidata P18 → Commons thumbnail, then the Wikipedia REST summary thumbnail, then a
neutral placeholder carrying the person's initials. **Never a photograph of a different
person, and never a search-engine image.** A wrong face is a factual error that reads as
authoritative and no caption fixes it.

Portraits load lazily and never block the header render. A portrait whose image fails
degrades to the initials placeholder rather than to a broken-image icon or a blank frame
that reads as a person we could not name. Commons licence and photographer credit are
shown on hover, and credit is assumed **required** whenever the licence cannot be read —
failing open there would silently drop a legally required attribution.

IndexedDB portrait caching is not built yet; it lands with the cache layer, alongside
last-known-good offline mode.

## Government tab

Cabinet, legislature, judiciary and a 25-year leadership timeline, all from Wikidata.
Three refusals carry most of the weight:

- **A ministry's "plain-English line" is Wikidata's own description**, never written
  here. Where there is none, the row says so. A guessed remit reads as fact.
- **A party breakdown bar is drawn only when the parties account for the whole
  chamber.** 150 recorded seats in a 400-seat chamber, rendered as a stacked bar, reads
  as a complete picture of a legislature — a confident falsehood in the most trusted
  format there is. Partial data gets a sentence saying how much is missing.
- **A portfolio with no English label keeps its Q-id** and is flagged, rather than being
  translated or dropped. Dropping silently shrinks the cabinet; translating invents.

An empty cabinet and a cabinet whose posts have no recorded officeholders are different
states and render differently. The first means Wikidata records no ministries at all;
the second means the posts exist and nobody is recorded in them.

Sections that cannot be built yet — term limits, next scheduled election — render as
explicit no-data cards naming the step that will fill them. A missing section that was
promised is invisible; a card that says "no data, arriving in step N" is a commitment
you can hold this build to.

Q-ids referenced by hand-written SPARQL live in `data/wikidata-entities.json`, all
unverified, so verification at egress is one pass over one file. Queries are written so
a wrong Q-id yields **missing rows rather than wrong rows** — an empty cabinet is
honest, another country's ministries would not be.

## Economy tab

Three absences are kept distinct, because collapsing any of them produces a confident
falsehood:

| Absence | Wrong rendering | What it does |
| --- | --- | --- |
| No data for the indicator | A flat line at zero | No-data card. A zero line says the indicator *measured* zero. |
| A gap mid-series | A line bridging the gap | The line breaks; the gap is hatched and named; nothing is interpolated. |
| A stale latest value | One panel-wide "as of" | Each indicator states its own latest year and age. Series update on different cadences. |

**Every monetary value carries a currency and a current/constant basis**, enforced in
`data/indicators.json` rather than at the call site — so a missing unit is a build-time
gap, not a rendering omission. "GDP: 29,184,890,000,000" is unusable and "GDP grew 8%"
is meaningless without knowing whether the series is nominal or real.

A **log/linear toggle** is offered per indicator where the series is strictly positive
and spans two or more orders of magnitude — the redenomination and hyperinflation case,
where a linear axis flattens everything below the peak. The active scale is always
stated. Log is refused, with the reason, for any indicator that can go negative.
Scale choices reset on country change: carrying a toggle across countries would
silently change how the next chart reads.

A late-starting series is **not** a gap. A country whose data begins in 2019 has no
missing observations before 2019, and rendering that as a gap would imply data was lost.

## News tab

The framing rule for the whole panel: **GDELT indexes English-language online news that
it crawls.** Coverage volume is a fact about the index, never about the country. Two
articles must read as "two articles indexed", not "a quiet week here".

**Tone is the single most misleading element this app could contain.** A tone line reads
as "how bad things are in country X". It is a machine sentiment estimate of the
English-language coverage GDELT happened to index. That caveat is rendered *on the
chart* — in the visible caption and the accessible label — not in a footnote, because the
footnote is what a reader skips. A day with no indexed coverage breaks the line: a quiet
news week has no tone, and drawing one would invent a sentiment reading.

**Syndication is deduplicated, and the count is shown.** Thirty identical headlines
would misrepresent how many things happened; hiding the copies would misrepresent how
widely one was carried. One row with "+11 more outlets" misrepresents neither. Grouping
is on normalised case and punctuation only — anything cleverer starts merging genuinely
different stories, and a wrongly merged pair is invisible to a reader in a way a
duplicate row is not.

**Unusable rows are counted, not dropped.** A feed row with no outlet, no timestamp or a
non-web link cannot be rendered honestly, but silently shortening the list reads as less
news. The panel says how many were excluded and why.

Direction is detected from the headline text, not the source country — GDELT indexes
coverage of every country, so a Hebrew headline can appear under any of them.

## Globe layers

Markers for USGS earthquakes and NASA EONET events. Six properties are enforced
rather than assumed:

- **Occlusion.** A marker on the far side of the globe is not pickable. three.js will
  happily raycast through the planet, and a user clicking a marker they cannot see
  would open a different event than the one under their cursor.
- **Coincident events cluster.** An aftershock sequence stacks a dozen epicentres
  within a few kilometres; drawn individually only the topmost is ever reachable. The
  cluster marker sits on the **strongest member's real coordinate**, never on a group
  average — an averaged position is a place where nothing happened — and every member
  is listed in the tooltip.
- **A polygon-derived marker says so.** The centroid of a wildfire perimeter is not the
  fire's location. Those markers are tagged `[DERIVED]` on the marker itself and state
  how many vertices were reduced away.
- **Staleness is computed, not trusted.** EONET marks events open until explicitly
  closed and many never are. Anything not updated for six months is excluded from the
  default view, labelled, and still available behind a toggle — deleting it would hide
  real history.
- **Marker size is bounded.** Size encodes magnitude on a bounded linear scale with a
  published key. It is not proportional to energy, area or damage, and the minimum
  radius is a *pointer-target* floor: a marker too small to click is a marker the user
  cannot check.
- **The magnitude in a tooltip is badged, not printed.** It is a USGS measurement, so it
  carries its tier and its provenance like any other fact: an unreviewed automatic
  solution renders `[ESTIMATE]` with its revision caveat, never identically to an
  analyst-reviewed `[OFFICIAL]` one. A quake published before a magnitude was computed
  reads *no data*; an EONET event carries no magnitude fact at all, because EONET does
  not measure one and claiming "no data" would invent a missing value.

Antimeridian and polar coordinates are handled explicitly — two events 10km apart across
the dateline must not render a world apart, and a perimeter crossing 180° must not
produce a centroid in the Gulf of Guinea.

## Provenance and verification

Every source in `data/sources.json` carries `verifiedAgainst`:

| Value | Meaning |
| --- | --- |
| `documentation` | Endpoint contract read from vendor docs. Never confirmed against a live response. |
| `live` | Confirmed against a real response, with the observed shape captured in a fixture. |

**Nothing ships to a real deployment while any runtime source it depends on is still
`documentation`.** `npm run check:deploy` enforces that and names what is outstanding.
Bundled, version-pinned sources are not gated: they cannot drift underneath us, and
their shape is asserted against the real bytes by the test suite.

Contract tests assert response *shape* and *sanity ranges*, never current values — a
test pinned to a live figure fails whenever the world changes, which trains people to
ignore it. The same assertions run against fixtures by default and against live sources
under `PROBE_LIVE=1`; only the input is swapped.

The fixtures in `tests/fixtures/` are **hand-authored from published documentation, not
captured responses** — no request in this repository has ever reached these APIs. The
inspector says so on every value derived from one.

## Architecture

```
src/
  countries.ts          Natural Earth topology -> ISO-coded country records
  facts/
    types.ts            Fact and Provenance contracts; fetch/derived/seed/unconfigured
    registry.ts         typed access to data/sources.json
    badge.ts            the confidence badge — the only way to render a fact
    inspector.ts        provenance inspector, recursive through derived inputs
    discipline.ts       notAFact(), the audited escape hatch
  sources/              per-source adapters: parse validates, toFact attaches provenance
  globe.ts              globe.gl wrapper; renders a style map, owns no opinions
  state.ts              observable store (selection, weights); URL state in step 13
  relations/
    types.ts            Finding / ScoredInput / RelationResult contracts
    facts.ts            fact tables -> pair findings index
    score.ts            weights -> tier, with staleness
  ui/                   rail, panel, search, traceability popover
data/
  sources.json          the source registry — licences, cadences, TTLs, keys
  relations-seed.json   step-1 seed facts (temporary)
scripts/
  probe-sources.mjs     CORS + reachability verdicts
  gen-attribution.mjs   regenerates the README attribution table
  verify-render.mjs     browser assertions for the built app
```

Findings are computed once from the fact tables; weights are applied on every slider
move. That split is what makes live recolouring cheap across 177 countries.

`currentYear` is injected into the scorer rather than read from the clock, so the
time scrub in step 13 can score a pair as of a past date without the scoring module
needing to know that time travel exists.

### Data discipline

- Every source is declared in `data/sources.json` with its licence class. Sources
  that are non-commercial (`nc`) or share-alike get their own adapter module and
  their data is never merged into a general-purpose derived table — swapping one
  module is all a licence change should cost.
- `npm run probe` records each source's CORS posture and issues a routing verdict:
  client-fetch, Worker-required, key-gated, or inconclusive. The edge proxy is used
  only where a probe proves it is needed.
- A 4xx from an upstream yields `INCONCLUSIVE`, never `WORKER-REQUIRED`. Error
  responses routinely omit CORS headers, and inferring a proxy dependency from one
  would manufacture a requirement the probe never demonstrated.

---

## Attribution

<!-- ATTRIBUTION:START -->

<!-- Generated by scripts/gen-attribution.mjs from data/sources.json. Do not edit by hand. -->

worldpulse renders data from the following sources. Every figure in the UI carries
its source, confidence tier and "as of" date; this list is the registry those come from.

**Verified:** 0 of 34 sources have been confirmed against a live response.
The rest carry endpoint contracts read from vendor documentation only. `npm run check:deploy`
blocks a deploy while any remain unverified.

| Source | Panel | Licence | Attribution | Key | Verified |
| --- | --- | --- | --- | --- | --- |
| [Natural Earth (via world-atlas)](https://www.naturalearthdata.com/) | globe | Public domain | Made with Natural Earth. | none | **docs only** |
| [World Bank Indicators API v2](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589) | economy | CC BY 4.0 | World Bank Open Data (CC BY 4.0). | none | **docs only** |
| [World Bank MS.MIL.* (SIPRI data, redistributed)](https://data.worldbank.org/indicator/MS.MIL.XPND.CD) | military | CC BY 4.0 | Stockholm International Peace Research Institute (SIPRI), Yearbook, via World Bank Open Data (CC BY 4.0). | none | **docs only** |
| [USGS Earthquake Hazards Program feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | layers | US Government work, public domain | U.S. Geological Survey. | none | **docs only** |
| [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) | layers | US Government work, public domain | NASA Earth Observatory Natural Event Tracker (EONET). | none | **docs only** |
| [Wikidata Query Service (SPARQL)](https://query.wikidata.org/) | government | CC0 1.0 | Wikidata (CC0). | none | **docs only** |
| [Wikipedia REST v1 summary](https://en.wikipedia.org/api/rest_v1/) | government | CC BY-SA 4.0 **Share-alike licence** — kept in a separate store, never merged into a general derived table. | Wikipedia contributors (CC BY-SA 4.0). | none | **docs only** |
| [Wikimedia Commons API (portraits, licence and credit)](https://commons.wikimedia.org/w/api.php) | header | per file, frequently CC BY / CC BY-SA **Share-alike licence** — kept in a separate store, never merged into a general derived table. | Per-image; photographer credit and licence shown on hover. | none | **docs only** |
| [GDELT DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | news | Open for research and non-commercial use; see GDELT terms **Non-commercial licence** — isolated behind its own adapter. | The GDELT Project. | none | **docs only** |
| [UCDP Georeferenced Event Dataset](https://ucdp.uu.se/apidocs/) | risk | CC BY 4.0 | Uppsala Conflict Data Program (UCDP), Georeferenced Event Dataset v26.1. | none | **docs only** |
| [UCDP Candidate Events (preliminary, monthly)](https://ucdp.uu.se/apidocs/) | risk | CC BY 4.0 | Uppsala Conflict Data Program (UCDP), Candidate Events Dataset. | none | **docs only** |
| [iptv-org channel index](https://github.com/iptv-org/api) | tv | Index is open; streams are third-party and not hosted or proxied by this project | iptv-org. | none | **docs only** |
| [iptv-org stream index](https://github.com/iptv-org/api) | tv | Index is open; streams are third-party | iptv-org. | none | **docs only** |
| [Frankfurter (ECB reference rates)](https://frankfurter.dev/) | economy | Open; underlying data ECB | European Central Bank reference rates via Frankfurter. | none | **docs only** |
| [exchangerate.host](https://exchangerate.host/documentation) | economy | Vendor terms **No reuse licence** — link-out only, not ingested. | exchangerate.host. | `VITE_EXCHANGERATE_HOST_KEY` | **docs only** |
| [UN Comtrade API](https://comtradedeveloper.un.org/) | economy | UN Comtrade terms; attribution required **No reuse licence** — link-out only, not ingested. | UN Comtrade. | `COMTRADE_KEY` | **docs only** |
| [congress.gov API v3](https://api.congress.gov/) | legislature | US Government work | congress.gov. | `CONGRESS_GOV_KEY` | **docs only** |
| [UK Commons Votes API](https://developer.parliament.uk/) | legislature | Open Parliament Licence | Contains Parliamentary information licensed under the Open Parliament Licence v3.0. | none | **docs only** |
| [HowTheyVote weekly data dumps (GitHub)](https://github.com/HowTheyVote/data) | legislature | See repository; EP source data is open | HowTheyVote.eu. | none | **docs only** |
| [openparliament.ca API](https://openparliament.ca/api/) | legislature | See site terms; attribution required | openparliament.ca. | none | **docs only** |
| [Dados Abertos Câmara dos Deputados](https://dadosabertos.camara.leg.br/) | legislature | Open government data | Câmara dos Deputados, Dados Abertos. | none | **docs only** |
| [abgeordnetenwatch.de API v2](https://www.abgeordnetenwatch.de/api) | legislature | ODbL / CC BY-SA depending on dataset **Share-alike licence** — kept in a separate store, never merged into a general derived table. | abgeordnetenwatch.de. | none | **docs only** |
| [NosDéputés.fr API](https://github.com/regardscitoyens/nosdeputes.fr/blob/master/doc/api.md) | legislature | ODbL 1.0 **Share-alike licence** — kept in a separate store, never merged into a general derived table. | NosDéputés.fr / Regards Citoyens (ODbL). | none | **docs only** |
| [Tweede Kamer OData v4](https://opendata.tweedekamer.nl/documentatie/introductie) | legislature | Open government data | Tweede Kamer der Staten-Generaal. | none | **docs only** |
| [Sveriges Riksdag open data](https://www.riksdagen.se/en/follow-and-subscribe/the-riksdags-open-data/) | legislature | Free reuse, no fee | Sveriges Riksdag. | none | **docs only** |
| [They Vote For You (Australia)](https://theyvoteforyou.org.au/help/data) | legislature | See site terms | They Vote For You / OpenAustralia Foundation. | `THEYVOTEFORYOU_KEY` | **docs only** |
| [Fundacja ePaństwo (Poland)](https://api.sejmometr.pl/) | legislature | Unverified **No reuse licence** — link-out only, not ingested. | Fundacja ePaństwo. | none | **docs only** |
| [OFAC Specially Designated Nationals list](https://ofac.treasury.gov/sanctions-list-service) | risk | US Government work, public domain | US Treasury, Office of Foreign Assets Control. | none | **docs only** |
| [EU consolidated financial sanctions list](https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions) | risk | Free reuse | European Union. | none | **docs only** |
| [OpenSanctions](https://www.opensanctions.org/docs/api/) | risk | CC BY-NC 4.0 **Non-commercial licence** — isolated behind its own adapter. | OpenSanctions (CC BY-NC 4.0). | `OPENSANCTIONS_KEY` | **docs only** |
| [US State Dept travel advisories](https://travel.state.gov/) | risk | US Government work, public domain | US Department of State. | none | **docs only** |
| [UK FCDO foreign travel advice](https://www.gov.uk/foreign-travel-advice) | risk | Open Government Licence v3.0 | Contains public sector information licensed under the Open Government Licence v3.0. | none | **docs only** |
| [Australian Smartraveller](https://www.smartraveller.gov.au/) | risk | CC BY 4.0 (Australian Government) | Australian Government Department of Foreign Affairs and Trade. | none | **docs only** |
| [US EIA API v2](https://www.eia.gov/opendata/) | economy | US Government work, public domain | US Energy Information Administration. | `EIA_KEY` | **docs only** |

### Considered and excluded

These are named here because their absence is a deliberate licensing decision,
not an oversight. Where a panel is missing data because of one of them, the panel
says so rather than substituting a guess.

- **[Global Firepower](https://www.globalfirepower.com/)** — No reuse licence granted. Per decision 2: excluded. No API, no licence grant, proprietary compiled estimates. Named in the Military tab's no-data card as a reason equipment inventories are unavailable.
- **[IISS Military Balance](https://www.iiss.org/publications/the-military-balance/)** — Proprietary, paywalled. Per decision 2: excluded. Named in the Military tab's no-data card.
- **[ACLED](https://acleddata.com/)** — Registration required; commercial use prohibited without a corporate licence. Excluded per Phase 0 section 1.1. UCDP GED is the conflict source.
- **[SIPRI databases (direct)](https://www.sipri.org/databases)** — Fair-use policy, redistribution restricted. No API. Reached indirectly via worldbank-milex. Link-out only. Arms-transfer arcs dropped per decision 4.
- **[UN Register of Conventional Arms](https://www.unroca.org/)** — UN terms. Excluded per decision 4. Self-reported and sparse; drawn as arcs, a missing report reads as 'no transfers', which is a confident falsehood. Replaced by a coverage note in the Military tab.

<!-- ATTRIBUTION:END -->
