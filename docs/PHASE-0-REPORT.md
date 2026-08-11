# worldpulse — Phase 0 report

Status: **awaiting approval. No application code written.**
Date of investigation: 2026-08-11

---

## 0. Blocker you need to resolve first

**I could not curl a single one of the APIs in the spec.**

This session runs behind a policy-enforcing egress proxy with a strict allowlist. Only
`api.github.com`, `github.com` and package registries (`registry.npmjs.org`, PyPI, crates.io…)
are reachable. Every third-party data host returns `403` at the CONNECT stage:

```
curl: (56) CONNECT tunnel failed, response 403
{"kind":"connect_rejected","host":"api.worldbank.org:443",
 "detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)"}
```

Confirmed blocked: `api.worldbank.org`, `earthquake.usgs.gov`, `eonet.gsfc.nasa.gov`,
`query.wikidata.org`, `api.gdeltproject.org`, `iptv-org.github.io`, `en.wikipedia.org`,
`api.exchangerate.host`. The sanctioned `WebFetch` tool is gated by the same proxy
(`EGRESS_BLOCKED`). Web *search* works, so everything below is verified against current
vendor documentation and terms pages — **not** against live responses.

The proxy documentation is explicit that policy denials must be reported rather than
routed around, so I have not attempted any workaround.

### What this means, concretely

| Verifiable here | Not verifiable here |
| --- | --- |
| License terms, key requirements, endpoint contracts, whether a project is alive | Live HTTP status, response shape, **CORS headers**, rate-limit behaviour, latency |

CORS is the one that matters most for architecture: the spec says "client-side fetch where
CORS allows, Worker proxy where it doesn't." I cannot determine which side of that line each
source falls on from here. My table below marks CORS as *expected* based on documentation and
known usage, flagged `?` where I am genuinely unsure.

**Pick one:**

- **(A) Unblock egress** — add the ~30 hosts in §4 to this environment's network policy. Then
  I re-run Phase 0 properly with real probes and give you a verified table. *Recommended.*
- **(B) Build against documented contracts** — I proceed, route everything through the Worker
  proxy by default (safe regardless of CORS), and you run the contract tests locally where
  network is open. Slower to converge, and step 1's "show me a working result" becomes
  "show me a working result against fixtures."

---

## 1. Licensing findings — three of these change the build

### 1.1 ACLED — restrictive, confirmed. Do not build against it.

You asked me to check this specifically before building. The answer is no.

- Access requires registration and an access key.
- "Commercial entities may not access or use the Content and/or Platforms without first
  obtaining a corporate license." **There are no license exemptions for commercial users.**
- Non-commercial grant is royalty-free but non-transferable and non-sublicensable, and
  anything published externally "must be transformative."

A public web app that renders ACLED events is redistribution, not transformative use, and if
worldpulse is ever commercial it is a straight violation. **Recommendation: UCDP GED as the
sole conflict source.** That is what the spec's fallback said, and it is the right call.

### 1.2 UCDP GED — clean. Use it.

- **CC BY 4.0.** Free to use and redistribute with citation. No key.
- Fully RESTful JSON: `https://ucdpapi.pcr.uu.se/api/gedevents/{version}?pagesize=&page=`
- Current version **26.1**. Versions back to 5.0 available — useful for the time scrub.
- Caveat: GED is released annually (plus UCDP Candidate monthly). It is **not** a live feed.
  The globe's "conflict events" layer will lag by weeks to months. The panel must say so.
  This is a real expectation mismatch with the spec's "live" framing — flagging it now.

### 1.3 Global Firepower — no. And this leaves a genuine hole.

GFP publishes no API, grants no license, and its disclaimer offers the data "as is" with no
reuse permission. Its numbers are proprietary compiled estimates. Scraping it would violate
both its terms and your "never invent or hardcode a fact" rule, since we could not cite a
verifiable primary source per figure.

IISS *Military Balance* is likewise paywalled and proprietary.

**There is no open, licensable, per-country equipment-inventory dataset.** The military tab's
"tanks / AFVs / combat aircraft / submarines by class" section cannot be built honestly from
open data. Options, in my order of preference:

1. **Drop equipment counts.** Build the military tab from what *is* open and official:
   personnel and budget (World Bank), chain of command (Wikidata), nuclear estimates (FAS),
   arms transfers (SIPRI, link-out), force posture (DMDC/UN). Show an explicit "no open
   dataset" card where equipment would go. Consistent with your stated principle.
2. Wikidata/Wikipedia-derived inventory figures, tagged `[ESTIMATE]` with a per-figure
   Wikipedia citation. Coverage is patchy and quality varies wildly by country. Honest but
   thin, and thin-but-honest may read as broken.
3. License IISS. Costs money, out of scope for me to arrange.

**I need your call on this one.** My recommendation is (1), with (2) available behind a
"show community-sourced estimates" toggle that is off by default.

### 1.4 SIPRI — use World Bank as the delivery mechanism

SIPRI has no API; data ships as spreadsheets, and its terms restrict redistribution ("fair
use" policy, no open license). Bundling it would breach that; there is no runtime endpoint to
fetch it from either, so the spec's "fetch at runtime, never bundle" escape hatch doesn't apply.

**But**: World Bank `MS.MIL.XPND.GD.ZS` and `MS.MIL.XPND.CD` *are* SIPRI data, redistributed
by the World Bank under CC BY 4.0 with a documented API. Same numbers, clean license, no key.
Use World Bank for milex; link out to SIPRI for the arms-transfer register rather than
ingesting it. Arms-transfer arcs on the globe would then need to be dropped or sourced from
the UN Register of Conventional Arms (which is self-reported, incomplete, and lags ~2 years —
usable but weak). Flagging as a second gap.

### 1.5 OpenSanctions — CC BY-**NC** 4.0

Free for non-commercial use; "any use inside a for-profit business requires a data license,"
no exemptions; hosted API is €0.10/call. If worldpulse is a personal/public-interest project
this is fine. If it is commercial, it is not.

**Mitigation regardless:** the primary sources are freely usable and are what OpenSanctions
aggregates anyway — OFAC SDN/consolidated lists (US government work, public domain) and the
EU consolidated financial sanctions list (free, registration-free download). Build against
those two directly; make OpenSanctions an optional keyed enrichment.

**I need to know whether this project is commercial.** It changes ACLED (already excluded),
OpenSanctions, and several smaller sources.

### 1.6 exchangerate.host now requires a key

The spec assumed keyless. It has required an access key since ~2023. Free tier still exists.

Recommendation: **Frankfurter** (`api.frankfurter.app`, ECB reference rates, no key, CORS-open,
CC-friendly) as the default, with exchangerate.host as a keyed fallback. Caveat: ECB publishes
~30 currencies on weekdays only, so exotic currencies and weekends need the fallback or show
"no data."

### 1.7 UN Comtrade requires a free key, 500 calls/day

That ceiling is per-key, not per-user. A public deployment will exhaust it quickly — so trade
data **must** be served from the Worker's cache with a long TTL, not fetched per visitor. Plan
for a nightly warm of the top ~50 countries and on-demand for the tail.

### 1.8 iptv-org — alive, but legally live-fire

The API (`iptv-org.github.io/api/*.json`) remains up. It has taken a Warner Bros. DMCA hit
that removed a set of channels; the project complied and survived. Expect churn and dead
streams — the health check the spec already mandates is not optional.

Two things I'd add: never proxy or re-host video (link/embed the upstream HLS only), and
attribute iptv-org visibly.

---

## 2. Relations engine — a correctness problem in the spec

The spec names **Correlates of War Formal Alliances v4.1** and **ATOP** as treaty inputs.
Both are historical research datasets: CoW Alliance v4.1's coverage ends in **2012**, ATOP's
in the late 2010s. Scoring "who is an ally *today*" from a dataset that stops 14 years ago
will produce confidently wrong answers — exactly the failure mode your spec is written to
prevent.

**Revised approach**, same architecture:

- **Primary (current):** bloc membership via Wikidata (NATO, CSTO, EU, ASEAN, AU, GCC, BRICS,
  SCO, Five Eyes) — live, queryable, and genuinely current.
- **Primary (current):** active conflict from UCDP; sanctions from OFAC/EU.
- **Corroborating (historical):** CoW/ATOP, contributing a *smaller* weight and rendered in
  the traceability popover with its coverage end year visible: "CoW alliance, data ends 2012."
- Wikidata **P530** (diplomatic relation) is sparsely populated and does not cleanly encode
  *severed* relations. I'd use it only as a weak positive signal, never to infer hostility.

The weight sliders and the arithmetic popover the spec asks for handle the rest — the
disagreement becomes visible rather than hidden.

---

## 3. Legislature tiering — results of the survey you asked for

You asked me to check AU, IN, FR, NL, SE, ES, IT, JP, NZ, IE, PL.

**Tier 1 — promote to full roll-call (new findings):**

| Country | Source | Notes |
| --- | --- | --- |
| AU | `theyvoteforyou.org.au` REST API | Divisions endpoint, mySociety-derived. Key may be required. |
| FR | NosDéputés.fr / NosSénateurs.fr API (XML/JSON/CSV) | **ODbL** — share-alike; modified data must be redistributed under ODbL. Legal note in README. |
| NL | Tweede Kamer OData + SyncFeed APIs | Official parliament open-data portal. OData is verbose; SyncFeed is XML/Atom. |
| SE | `data.riksdagen.se/voteringlista/` | Official, free, no license fee. |
| IE | mySociety-derived (KildareStreet lineage) | Verify current API status when egress opens. |
| PL | Fundacja ePaństwo API | ⚠ ePaństwo has wound down services; **must verify live before committing.** |

**Tier 2 — official but unstructured:**
ES (Congreso publishes open data but exposes no vote endpoint — votes are per-date file trees),
IT (no vote API found), NZ (noted in open-parliament surveys as having *almost no* voting data
published).

**Tier 3 — no open legislative data:** IN, JP.

**Corrections to the spec's Tier-1 list:**

- **DE / abgeordnetenwatch** publishes only *selected* (namentliche) votes, not full
  roll-call coverage. It is Tier 1 in format but partial in coverage — the tab must say
  "named votes only," or it will read as though the Bundestag rarely votes.
- **EU / HowTheyVote** self-describes as **experimental**, with formats subject to change and
  "availability not guaranteed." Prefer their weekly-updated CSV dumps on GitHub
  (`HowTheyVote/data`) as the stable path, API as the freshness layer.
- **US / congress.gov** free key confirmed as the documented model.
- **UK**: the modern surface is `developer.parliament.uk` (a family of APIs incl. Commons
  Votes); the older `data.parliament.uk` is legacy. Target the former.
- **CA / openparliament.ca**: JSON API confirmed, mirrors site URL structure.
- **BR / dadosabertos.camara.leg.br**: documented open API, Câmara only (Senado is separate).

---

## 4. Data-source table

Cadence = real upstream update rate, which drives the IndexedDB TTL. "CORS" is *expected*,
unverifiable from here (§0); `?` = genuinely unknown. Anything not CORS-clean routes through
the Worker, and the Worker is the default path in any case for rate-limited sources.

### Core / globe

| Panel | Source | Cadence | License | Key | CORS | Fallback if dead |
| --- | --- | --- | --- | --- | --- | --- |
| Country polygons | Natural Earth (bundled TopoJSON) | static | Public domain | — | n/a | none needed |
| Earthquakes | USGS `all_day.geojson` | ~5 min | US Gov, public domain | no | yes | EMSC FDSNWS |
| Natural events | NASA EONET v3 | ~hourly | US Gov, public domain | no | yes | GDACS |
| Country vitals | Wikidata SPARQL | continuous | CC0 | no (UA required) | yes | Wikipedia REST |
| Flags | Bundled SVG (flag-icons, ISO-3166) | static | CC0/MIT | — | n/a | — |

### Dossier

| Panel | Source | Cadence | License | Key | CORS | Fallback |
| --- | --- | --- | --- | --- | --- | --- |
| Leader portraits | Wikidata P18 → Commons thumb | continuous | per-file (many CC-BY → **attribution required**) | no | yes | Wikipedia REST thumb → initials placeholder |
| Government | Wikidata (P35/P6/P1308/P5054) | continuous | CC0 | no | yes | Wikipedia REST |
| Bios | Wikipedia REST summary | continuous | CC BY-SA | no | yes | none → "no data" |
| Economy | World Bank v2 | annual (indicator-dependent) | CC BY 4.0 | no | yes | IMF DataMapper |
| Milex | World Bank `MS.MIL.XPND.*` (SIPRI-derived) | annual | CC BY 4.0 | no | yes | none |
| FX | Frankfurter (ECB) | weekday daily | open | no | yes | exchangerate.host (keyed) |
| Trade | UN Comtrade | monthly/annual | UN terms, attribution | **yes**, free, 500/day | ? | World Bank WITS |
| Energy | Ember + EIA | monthly / annual | CC BY 4.0 / US Gov | Ember no, EIA yes | ? | IEA link-out |
| News | GDELT DOC 2.0 | ~15 min | open for research use | no | ? → **Worker** | per-country RSS |
| Live TV | iptv-org API | continuous | see repo; streams third-party | no | yes | mark offline |
| Conflict | UCDP GED 26.1 + Candidate | annual + monthly | **CC BY 4.0** | no | ? → Worker | none — panel says no data |
| Sanctions | OFAC SDN + EU consolidated | daily-ish | public domain / free | no | no → **Worker** | OpenSanctions (NC license) |
| Governance idx | V-Dem, RSF, TI CPI, FSI | annual | mixed; **FSI and RSF need per-source check** | no | no → Worker | omit individually |
| Advisories | US State Dept, UK FCDO, AU Smartraveller | irregular | Crown/US Gov | no | no → Worker | link-out only |
| Force posture | DoD DMDC quarterly; UN Peacekeeping open data | quarterly / monthly | US Gov / UN | no | no → Worker | panel says no data |
| Nuclear | FAS Nuclear Notebook | ~annual | **needs terms check** — FAS is CC BY-NC-ND on some outputs | no | no → Worker | omit |
| Legislature | see §3 | varies | varies (**FR is ODbL/share-alike**) | US & AU keyed | mixed | tier down |

### Excluded after review

| Source | Reason |
| --- | --- |
| **ACLED** | Registration + commercial prohibition; not freely licensed (§1.1) |
| **Global Firepower** | No license grant, no API, proprietary estimates (§1.3) |
| **IISS Military Balance** | Paywalled, proprietary |
| **SIPRI direct** | No API, redistribution restricted — reached via World Bank instead (§1.4) |

---

## 5. Feature list

Spec features, plus additions marked **[+]**. Effort S / M / L.

### Core
| # | Feature | Rationale | Effort |
| --- | --- | --- | --- |
| 1 | Globe, country polygons, hover/pick | The primary navigation surface | M |
| 2 | Single + multi-select (Ctrl/Cmd) | Enables compare mode | S |
| 3 | Relations recoloring with traceable scoring | The app's signature opinion, shown as an opinion | L |
| 4 | Relation-weight sliders, live recolor | Makes a contested judgement auditable | M |
| 5 | Compare view, deltas, "who leads" | Turns two dossiers into an argument | M |

### Provenance
| # | Feature | Rationale | Effort |
| --- | --- | --- | --- |
| 6 | Confidence badge component (OFFICIAL/ESTIMATE/DERIVED) | The spec's central rule; built before any panel | S |
| 7 | `sources.json` registry → README attribution generator | One place defines license and cadence | S |
| 8 | **[+] Provenance inspector** — click any value, see request URL, raw response, fetch time | Makes the badge checkable, not just decorative | M |
| 9 | **[+] Source health dashboard** — up / degraded / stale per source | Operationalises "one dead API degrades one panel" | M |
| 10 | **[+] Coverage-gap choropleth** — paint the map by how much we actually know | Absence of data is itself intelligence | S |

### Dossier
| # | Feature | Rationale | Effort |
| --- | --- | --- | --- |
| 11 | Header: flag, vitals, leader portrait w/ 5-rule resolution | Identity at a glance, without smoothing juntas into presidents | L |
| 12 | Leader detail sheet: bio, timeline, party, predecessor/successor | Depth behind the portrait | M |
| 13 | Government tab | Who actually runs the place | M |
| 14 | Legislature tab, tiered with visible tier badge | Sparse must read as "no open data," not "nothing happening" | L |
| 15 | Military tab (minus equipment — see §1.3) | Capability and command | L |
| 16 | Known Force Posture (explicitly lagging, never "live") | The honest version of a thing people expect to be live | M |
| 17 | Economy tab + anomaly flags | Twenty indicators and the outliers that matter | M |
| 18 | News tab + 30-day tone timeline | What is being said, and how it's trending | M |
| 19 | Live TV/radio grid with health checks | Unmediated primary source | M |
| 20 | Risk & stability tab | Conflict, unrest, indices, advisories | M |
| 21 | **[+] Neighbours & borders panel** | Most geopolitics is adjacency | S |

### Layers & time
| # | Feature | Rationale | Effort |
| --- | --- | --- | --- |
| 22 | USGS + EONET layers | Live-ish and genuinely real-time | S |
| 23 | Conflict / unrest point layers | With honest cadence labelling | M |
| 24 | Alliance, trade, arms arcs | Relationships as geometry | M |
| 25 | Military base markers | Posture on the map | S |
| 26 | Elections calendar + 90-day glow | Forward-looking, not just current-state | M |
| 27 | Choropleth mode, any indicator, legend + scale | Turns the globe into a chart | M |
| 28 | Time scrub across every time-varying layer | The feature that makes it a research tool | L |
| 29 | **[+] Day/night terminator + local time** | Cheap, and orients everything else | S |

### Session
| # | Feature | Rationale | Effort |
| --- | --- | --- | --- |
| 30 | Watchlist (persisted) | Return path into the app | S |
| 31 | Change digest with old/new + source | The reason to come back daily | L |
| 32 | Full URL state, back/forward | Shareability is the distribution model | M |
| 33 | **[+] Dossier export** — JSON/CSV with citations | Makes it usable as a source, not just a viewer | M |
| 34 | **[+] Command palette (Cmd-K)** | Faster than the rails for power users | S |
| 35 | **[+] Search by endonym, exonym, ISO-2/3, capital** | "Côte d'Ivoire" / "Ivory Coast" / "CIV" all work | S |
| 36 | **[+] Last-known-good offline mode from IndexedDB** | Degrades to stale-but-labelled rather than blank | M |

### Platform
| # | Feature | Rationale | Effort |
| --- | --- | --- | --- |
| 37 | Cloudflare Worker proxy w/ caching | CORS + rate-limit shield for free public APIs | M |
| 38 | Request queue, per-source concurrency, backoff | Be a good citizen of free infrastructure | M |
| 39 | Source contract tests in CI on a schedule | The main defence against silently starting to lie | M |
| 40 | Accessibility: full no-WebGL country-list equivalent | The globe is not the only way in | M |
| 41 | Perf pass: 5k points / 500 arcs @ 60fps | Instancing, throttled raycast, virtualised lists | M |
| 42 | Responsive < 900px: drawers + full-screen sheet | — | M |

---

## 6. Decisions I need from you

1. **Egress** — option (A) unblock, or (B) build against documented contracts? (§0)
2. **Military equipment** — drop the section, or Wikidata-derived `[ESTIMATE]` behind an
   off-by-default toggle? (§1.3)
3. **Commercial or not?** — governs OpenSanctions and several smaller sources. (§1.5)
4. **Arms-transfer arcs** — drop, or use the weak self-reported UN Register? (§1.4)
5. **Keys to provision** (all free): `congress.gov`, UN Comtrade, EIA, TheyVoteForYou (if
   required), optional exchangerate.host, optional OpenSanctions.

Confirm these and I'll start at build step 1 — globe, polygons, selection, and relations
recoloring over a hand-checked seed set — and stop there for review.
