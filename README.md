# worldpulse

A single-page 3D globe that acts as a live intelligence dashboard for every country
on Earth: politics, government, military, economy, news, live TV and natural events.

**Current state: build step 1 of 14.** The globe, selection model and relations
engine work. No live data pipeline yet — relations run on a hand-checked seed set
so the interaction is provable before the ingests land.

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

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build
npm test             # relations engine and geometry tests
npm run probe        # CORS + reachability verdicts for every source
```

No API keys are needed. Copy `.env.example` to `.env` when you have them; every
key-gated panel degrades to "key not configured" rather than erroring.

### Verifying a build in a browser

```bash
npm run build && npx vite preview --port 4173 &
node scripts/verify-render.mjs
```

Asserts the globe actually drew polygons, the default selection lands on the USA,
ctrl-click opens compare, and the weight sliders recolour. Screenshots land in
`artifacts/`. On machines where Chromium is installed out of band, set
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

## Architecture

```
src/
  countries.ts          Natural Earth topology -> ISO-coded country records
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

| Source | Panel | Licence | Attribution | Key |
| --- | --- | --- | --- | --- |
| [Natural Earth (via world-atlas)](https://www.naturalearthdata.com/) | globe | Public domain | Made with Natural Earth. | none |
| [World Bank Indicators API v2](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589) | economy | CC BY 4.0 | World Bank Open Data (CC BY 4.0). | none |
| [World Bank MS.MIL.* (SIPRI data, redistributed)](https://data.worldbank.org/indicator/MS.MIL.XPND.CD) | military | CC BY 4.0 | Stockholm International Peace Research Institute (SIPRI), Yearbook, via World Bank Open Data (CC BY 4.0). | none |
| [USGS Earthquake Hazards Program feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | layers | US Government work, public domain | U.S. Geological Survey. | none |
| [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) | layers | US Government work, public domain | NASA Earth Observatory Natural Event Tracker (EONET). | none |
| [Wikidata Query Service (SPARQL)](https://query.wikidata.org/) | government | CC0 1.0 | Wikidata (CC0). | none |
| [Wikipedia REST v1 summary](https://en.wikipedia.org/api/rest_v1/) | government | CC BY-SA 4.0 **Share-alike licence** — kept in a separate store, never merged into a general derived table. | Wikipedia contributors (CC BY-SA 4.0). | none |
| [Wikimedia Commons API (portraits, licence and credit)](https://commons.wikimedia.org/w/api.php) | header | per file, frequently CC BY / CC BY-SA **Share-alike licence** — kept in a separate store, never merged into a general derived table. | Per-image; photographer credit and licence shown on hover. | none |
| [GDELT DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | news | Open for research and non-commercial use; see GDELT terms **Non-commercial licence** — isolated behind its own adapter. | The GDELT Project. | none |
| [UCDP Georeferenced Event Dataset](https://ucdp.uu.se/apidocs/) | risk | CC BY 4.0 | Uppsala Conflict Data Program (UCDP), Georeferenced Event Dataset v26.1. | none |
| [UCDP Candidate Events (preliminary, monthly)](https://ucdp.uu.se/apidocs/) | risk | CC BY 4.0 | Uppsala Conflict Data Program (UCDP), Candidate Events Dataset. | none |
| [iptv-org channel index](https://github.com/iptv-org/api) | tv | Index is open; streams are third-party and not hosted or proxied by this project | iptv-org. | none |
| [iptv-org stream index](https://github.com/iptv-org/api) | tv | Index is open; streams are third-party | iptv-org. | none |
| [Frankfurter (ECB reference rates)](https://frankfurter.dev/) | economy | Open; underlying data ECB | European Central Bank reference rates via Frankfurter. | none |
| [exchangerate.host](https://exchangerate.host/documentation) | economy | Vendor terms **No reuse licence** — link-out only, not ingested. | exchangerate.host. | `VITE_EXCHANGERATE_HOST_KEY` |
| [UN Comtrade API](https://comtradedeveloper.un.org/) | economy | UN Comtrade terms; attribution required **No reuse licence** — link-out only, not ingested. | UN Comtrade. | `COMTRADE_KEY` |
| [congress.gov API v3](https://api.congress.gov/) | legislature | US Government work | congress.gov. | `CONGRESS_GOV_KEY` |
| [UK Commons Votes API](https://developer.parliament.uk/) | legislature | Open Parliament Licence | Contains Parliamentary information licensed under the Open Parliament Licence v3.0. | none |
| [HowTheyVote weekly data dumps (GitHub)](https://github.com/HowTheyVote/data) | legislature | See repository; EP source data is open | HowTheyVote.eu. | none |
| [openparliament.ca API](https://openparliament.ca/api/) | legislature | See site terms; attribution required | openparliament.ca. | none |
| [Dados Abertos Câmara dos Deputados](https://dadosabertos.camara.leg.br/) | legislature | Open government data | Câmara dos Deputados, Dados Abertos. | none |
| [abgeordnetenwatch.de API v2](https://www.abgeordnetenwatch.de/api) | legislature | ODbL / CC BY-SA depending on dataset **Share-alike licence** — kept in a separate store, never merged into a general derived table. | abgeordnetenwatch.de. | none |
| [NosDéputés.fr API](https://github.com/regardscitoyens/nosdeputes.fr/blob/master/doc/api.md) | legislature | ODbL 1.0 **Share-alike licence** — kept in a separate store, never merged into a general derived table. | NosDéputés.fr / Regards Citoyens (ODbL). | none |
| [Tweede Kamer OData v4](https://opendata.tweedekamer.nl/documentatie/introductie) | legislature | Open government data | Tweede Kamer der Staten-Generaal. | none |
| [Sveriges Riksdag open data](https://www.riksdagen.se/en/follow-and-subscribe/the-riksdags-open-data/) | legislature | Free reuse, no fee | Sveriges Riksdag. | none |
| [They Vote For You (Australia)](https://theyvoteforyou.org.au/help/data) | legislature | See site terms | They Vote For You / OpenAustralia Foundation. | `THEYVOTEFORYOU_KEY` |
| [Fundacja ePaństwo (Poland)](https://api.sejmometr.pl/) | legislature | Unverified **No reuse licence** — link-out only, not ingested. | Fundacja ePaństwo. | none |
| [OFAC Specially Designated Nationals list](https://ofac.treasury.gov/sanctions-list-service) | risk | US Government work, public domain | US Treasury, Office of Foreign Assets Control. | none |
| [EU consolidated financial sanctions list](https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions) | risk | Free reuse | European Union. | none |
| [OpenSanctions](https://www.opensanctions.org/docs/api/) | risk | CC BY-NC 4.0 **Non-commercial licence** — isolated behind its own adapter. | OpenSanctions (CC BY-NC 4.0). | `OPENSANCTIONS_KEY` |
| [US State Dept travel advisories](https://travel.state.gov/) | risk | US Government work, public domain | US Department of State. | none |
| [UK FCDO foreign travel advice](https://www.gov.uk/foreign-travel-advice) | risk | Open Government Licence v3.0 | Contains public sector information licensed under the Open Government Licence v3.0. | none |
| [Australian Smartraveller](https://www.smartraveller.gov.au/) | risk | CC BY 4.0 (Australian Government) | Australian Government Department of Foreign Affairs and Trade. | none |
| [US EIA API v2](https://www.eia.gov/opendata/) | economy | US Government work, public domain | US Energy Information Administration. | `EIA_KEY` |

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
