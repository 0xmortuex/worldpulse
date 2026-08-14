# Spec — research-driven expansion

Written 2026-08-14 from a research pass against comparable projects. This spec adds
sources, accessibility work and three strategic capabilities. It does not change the
charter, and several of its entries exist to *defend* the charter against features the
comparable projects have normalised.

---

## Why these items and not others

Research against **worldmonitor**, **DeepStateMap**, **Kontur**, **Liveuamap** and the
WarWatch clone cluster produced one finding that drives everything below:

> **Our differentiator is provenance and traceability, not feature count.**

`worldmonitor` shares our exact stack and leans on AI synthesis and a black-box instability
index — **the two things our charter forbids**. That is not a gap to close; it is the
distinction to widen. Every feature in this spec was chosen to deepen the trust position,
not to chase the clones. Where a clone feature was considered and rejected, it is recorded
in [Standing prohibitions](#standing-prohibitions) with its reason, so that a future session
cannot relitigate it silently by simply not knowing.

---

## The gate — no item enters by another route

Every source in Phase A passes through the existing gate, in this order:

1. **Registered** in `data/sources.json` **with its licence class**
2. **Probed** — a CORS and reachability verdict recorded in `data/probe-results.json`,
   with a `transport` declared that matches the verdict
3. **Fixture captured live** — a real response, stored, labelled as a fixture
4. **Contract test passing** — shape and range, never values (rule 4)
5. **Then live** — wired into a panel

All existing rules apply without exception, and the ones this spec most often touches:

| Rule | What it means here |
| --- | --- |
| Provenance tiers | every new value carries `[OFFICIAL]`/`[ESTIMATE]`/`[DERIVED]`, plus the new `[UNVERIFIED]` (Phase B3) |
| Rule 22 — units | a numeric fact whose meaning depends on a unit carries the unit or does not render |
| Rule 30 — states | "no answer" is not an answer of "no"; absent, empty and failed are distinct renderings |
| Rule 3 | an error response is never evidence about the success path |
| Rule 4 | contract tests assert shape and range, never current values |
| Rule 5 | fixtures are labelled and never silently substitute for live data |
| No authored content | no summaries, no editorial framing, no invented prose |
| No composite scores | no derived score without visible, decomposable arithmetic |

---

## Phase A — new data sources

Quick wins: keyless or free-key. Registered, probed, fixtured, contract-tested, then
integrated — **one at a time**.

| # | Source | Licence / key | Feeds |
| --- | --- | --- | --- |
| 1 | **CISA KEV** — known exploited vulnerabilities | CC0, no key | cyber row in Risk & Stability |
| 2 | **disease.sh + WHO Disease Outbreak News** | keyless, CORS-enabled | foundation of biohazard mode |
| 3 | **UNHCR Refugee Data Finder** | keyless JSON, CC BY 4.0 | displacement figures per country |
| 4 | **IOM DTM** | public API | IDP figures, country/admin level |
| 5 | **NASA FIRMS** | free MAP_KEY, 5,000 tx/10min | thermal anomalies layer |
| 6 | **IMF PortWatch** | 2065 ports, 28 chokepoints, weekly | port & chokepoint activity |
| 7 | **Ember electricity** | CC BY 4.0, free key, 215 countries | generation mix, economy tab |
| 8 | **ReliefWeb + HDX HAPI** | humanitarian reports, standardized indicators | humanitarian tab |
| 9 | **FEWS NET Data Warehouse** | free account, GeoJSON/CSV | food security classifications |
| 10 | **IFES ElectionGuide** | free, non-commercial, credentials requested | elections-in-90-days glow |
| 11 | **UN General Assembly voting** | Dag Hammarskjöld Library, non-commercial + attribution | voting-alignment view in relations |
| 12 | **Cloudflare Radar + IODA + OONI** | Radar: free token, CC BY-NC | internet connectivity layer |
| 13 | **abuse.ch Feodo Tracker** | CC0, keyless | blocklist download |

### Per-source constraints that are not negotiable

**1. CISA KEV** — pull from the **`cisagov/kev-data` GitHub mirror, not `cisa.gov`
directly**. Direct fetches have been rate-limited and IP-blocked. The mirror is the
registered origin; the probe verdict must be measured against it.

**5. NASA FIRMS — critical labelling rule.**

> Render as **"thermal anomalies" ONLY**. Never assert or imply strikes, shelling, or
> combat. **A fire pixel is a fire pixel.**

This is a rendering requirement, not a style preference. A thermal anomaly is a
radiometric measurement; any label implying causation is authored content the sensor did
not supply, and it is the single most likely way this project could publish something
false and inflammatory. Rule 24 applies with full force: registering a layer is a claim
that its marker represents the phenomenon. The marker represents *heat*.

**6. IMF PortWatch — replaces the AIS-based Hormuz monitor in `SPEC-WARWATCH.md`.**
It is methodologically rigorous, aggregated, and carries its own caveats. **Those caveats
must render on the panel**, not sit in a doc:

- GPS jamming
- AIS spoofing
- vessels going dark

A traffic figure derived from transponders that can be jammed, spoofed or switched off is
an `[ESTIMATE]` with a stated reason, never an `[OFFICIAL]` count.

**8. ReliefWeb + HDX HAPI** — headlines with **source and link only, never our own
summaries**. This is the no-authored-content rule at its most tempting boundary: the
reports are long, and summarising them is exactly the feature `worldmonitor` ships and we
forbid.

**11. UN General Assembly voting** — adds a voting-alignment view to relations mode: how
often two selected countries vote together, **computed and traceable**. It is a `[DERIVED]`
value and therefore must show its arithmetic and its inputs in the inspector like every
other derived value.

**12. Connectivity** — Cloudflare Radar needs a free account token and is **CC BY-NC**,
which suits a non-commercial project, with **attribution mandatory**. IODA and OONI
corroborate. A connectivity drop during a crisis is factual signal — it is not a claim
about a cause.

**13. abuse.ch** — Feodo Tracker is CC0 and keyless. **ThreatFox and URLhaus now require
free auth keys**; register those separately if wanted later, not as part of this item.

### Licence discipline

| Source | Licence | Consequence |
| --- | --- | --- |
| **RSF press-freedom index** | CC BY-ND | **display as-is, never reshape.** No recomputing, rebinning, or re-ranking |
| **CPJ** | CC BY-NC-ND, API dead since 2024 | periodic bulk only |
| **Cloudflare Radar** | CC BY-NC | attribution mandatory |
| **CIVICUS civic space** | CC BY-SA | share-alike obligation on derived presentation |

Both RSF and CPJ constraints are **recorded in the `licence` fields in `sources.json`**, not
only here — a constraint that lives only in a spec is a constraint the code cannot enforce.

> **If display-as-is cannot fit the panel, do not include the source.** Reshaping ND-licensed
> data to fit a layout is a licence violation, and "it looked better this way" is not a
> defence.

---

## Phase B — UX and accessibility

**B1, B3 and B4 land before any new layer renders**, because they change how everything
renders. Building layers first means rebuilding them.

### B1. Colourblind-safe palettes, everywhere

Relations mode currently leans on red/green. **Red-green CVD affects roughly 1 in 12 men.**

- Move to **ColorBrewer-safe categorical** colours
- **DUAL-ENCODE**: every relation tier gets a shape, pattern or label — **never colour
  alone**
- Choropleths use **Viridis/Cividis** sequential
- Signed data uses a **proper diverging palette with a meaningful zero**
- **Rule 8 and rule 9 assertions extend to the new encodings** — the geometry and text
  checks must cover the shape/pattern encodings, or the dual-encoding is unverified

### B2. Deep-link full view state

Already specced, now prioritised. The URL must capture: **camera position, selection,
active layers, relation weights, time index, mode.**

> **A reproducible view is itself provenance.**

### B3. `UNVERIFIED` tier

A fourth confidence tier **below `[ESTIMATE]`** for anything that cannot be corroborated.
**Visually distinct from all three existing tiers** — and distinct from `UNTRACEABLE`,
which is a failure, not a tier.

### B4. Coordinate precision binding

Every plotted point's precision **matches its source's actual resolution** — country,
admin-1, or point. The provenance popover **states the resolution**.

> A 6-decimal coordinate from a country-level source is **false precision** — a lie told in
> the units of accuracy.

This generalises the existing DERIVED-marker treatment (a polygon centroid is not the event
location) to every coordinate in the app.

### B5. `prefers-reduced-motion`

Disable auto-rotate and ripple animations when set.

### B6. Parallel accessible data table

**Every globe layer gets a DOM table equivalent, keyboard-reachable.**

This is also the **L10 marker-click mitigation, now load-bearing.** L9 records that marker
clicks may not resolve on low-frame-rate devices — a defect located inside globe.gl's raycast
and deliberately not patched. The table is the route around it. Every event reachable by
clicking a marker must be reachable here, and that equivalence is **asserted, not assumed**.

---

## Phase C — strategic additions

### C1. 2D flat map fallback

MapLibre or equivalent, **sharing the same layer data and selection state as the globe**.

- **Auto-switch** when frame rate is unsustainable
- **Manual toggle always available**

This is the mobile answer and the biggest UX gap against `worldmonitor`. It also has a
measured justification in this repo: `TESTING.md` §15 records frame profiles of 583–750ms
per frame under software rasterisation, and L9's dropped clicks are frame-rate sensitive.

### C2. Population-exposed significance

Replace the news board's coverage-volume significance score with — or add alongside it — a
**population-affected metric**: event footprint intersected with population data (HDX /
WorldPop).

This is Kontur's model and it is the **defensible, non-editorial answer to "how big is this
event."** It must be **fully decomposable in the inspector** like every other derived value:
footprint, population raster, intersection, result.

### C3. Humanitarian tab

In the dossier: ReliefWeb + HAPI + FEWS NET/IPC + IOM DTM. **A serious counterweight to the
military tab.**

### C4. Governance layers

UN voting alignment, election calendar, CIVICUS civic-space (CC BY-SA), press freedom
display-as-is. **Non-editorial, and absent from every clone.**

### C5. Freshness monitor

A panel showing **every source's last successful fetch against its declared cadence**,
generated from the registry. The "as of" system already holds the data; this surfaces it
app-wide.

### C6. Command palette

`Ctrl`/`Cmd`+`K` — country search, layer toggles, mode switches, tab jumps. Pairs with the
existing keyboard requirements and with B6.

---

## Standing prohibitions

**Recorded verbatim. These were considered and rejected with reasons; do not build them, and
do not let a future session relitigate silently.**

1. **NO AI-written summaries or briefs.** worldmonitor's core feature; our charter's core
   prohibition.
2. **NO composite instability/threat score without fully visible, user-adjustable
   arithmetic.** A single "danger number" is editorial content wearing math.
3. **NO live military-asset tracking or military filters on broadcast traffic.**
4. **NO conflict-zone webcams or embedded live streams.** Privacy, safety, and legal risk
   outweigh value. Public-camera spec in SPEC-WARWATCH is downgraded to link-out only.
5. **NO casualty tickers, kill counters, or tactical-cosplay UI.** The "war as entertainment"
   critique is current, mainstream, and correct about the clones. We are not one.
6. **NO breaking-item elevation without ≥2 independent sources.** Single-source items render
   with the single-source marker and never lead a ranked board.

### Consequent amendments to existing specs

| Doc | Amendment |
| --- | --- |
| `SPEC-WARWATCH.md` | AIS-based Hormuz monitor **replaced** by IMF PortWatch (Phase A6) |
| `SPEC-WARWATCH.md` | public-camera spec **downgraded to link-out only** (prohibition 4) |

---

## Order and process

- **Phase A** sources one at a time through the gate, most-valuable first.
- **Phase B items 1, 3, 4 before any new layer renders** — they change how everything
  renders.
- **Phase C after A and B.**
- **Steps 8–14 of the original build order remain scheduled and are not displaced by this
  spec.** They are enumerated in `BUILD-ORDER.md`; the interleaving is below.
- **Findings to `FOUND.md`, judgement calls to `OPEN-QUESTIONS.md`, no mid-item
  reprioritising.**
- **Report at least every 20 minutes.**

### The approved sequence

**Item 0 — the transport gate, before any Phase A source.** `tests/transport-check.test.ts`
is red (see [Preconditions](#preconditions)). Thirteen sources are about to land on that
gate; a red gate needs **diagnosing, not greening**.

```
Item 0  →  PortWatch  →  disease.sh/WHO  →  UNHCR  →  KEV  →  Ember
        →  [ B1 + B3 + B4 + P3 — one batched Fact-model migration ]
        →  FIRMS  →  rest of Phase A  →  Phase C
```

**Phase A pauses after Ember and before FIRMS.** FIRMS is the source where false precision
does the most damage: **a thermal anomaly plotted at 6 decimals reads as a strike location**,
violating the labelling rule and the precision rule at the same time. B4 must exist before
that layer renders.

### The batched `Fact`-model migration

Four changes to one model, done once rather than three times:

| Change | What it adds |
| --- | --- |
| **B1** | colourblind-safe, dual-encoded rendering |
| **B3** | the `UNVERIFIED` tier |
| **B4** | coordinate precision bound to source resolution |
| **P3** | `DerivedProvenance.inputs` changes from `Provenance[]` to **`Fact[]`** |

**P3 — decided 2026-08-14.** The original recommendation was to defer to step 12, on the
grounds that a breaking change to the fact model was the wrong trade mid-build. **Batching
flips that trade**: three migrations of the same model become one, with one test sweep, and
all four gaps close together. Shipping B3's tier alone would mean migrating the model twice.

**P3's rule as originally written stands:**

> Missing data propagates through required inputs. A shortfall among contributing inputs
> renders as a **caveat, never silently absorbed.**

**The relations panel's disclosure caveat comes off only when the propagation actually
works** — not when the code lands. The **San Marino** and **relations-score** cases are its
first test fixtures, which makes them the evidence that the caveat may be removed rather
than an assertion that it should be.

### Interleaving with the build order

| Expansion item | Build-order step | Disposition |
| --- | --- | --- |
| B2 — deep-link view state | 13 | the same work; do it once, it discharges step 13's URL-state portion |
| B6 — accessible data table | with the event feed | per `DECISIONS.md` L10 — the marker-click mitigation is load-bearing |
| B1/B3/B4 + P3 | was 12 | pulled forward into the batched migration above |
| C2 — population-exposed significance | vs `SPEC-BREAKING-NEWS.md` | sequenced against that spec's ranking, not independently |
| Phase A | 10 | builds the ingest muscle step 10 needs |
| — | 9 | **stays blocked.** The SPARQL redesign is its own item and precedes step 9 (`FOUND.md`) |

---

## Preconditions

Recorded here because Phase A cannot start cleanly until they are resolved.

**The transport gate is currently red.** `tests/transport-check.test.ts` imports
`data/sources.json` and `data/probe-results.json` and asserts consistency between each
source's declared `transport` and its measured probe verdict. A probe run on 2026-08-14
took the results from 32 rows to 47 and turned that gate red with 2 failures:

- **16 sources have a probe verdict but no `transport` declared** — the 15 `rss-*` feeds and
  `howtheyvote-data`. 24 of 54 registry entries lack the field entirely.
- **`camara-br`** declares `direct` but measured INCONCLUSIVE (504, transient upstream).
- **`riksdagen`** declares `direct` but measured UNREACHABLE — established as a **TCP reset
  on the measuring network**, not an upstream change.

The committed probe results predated the `rss-*` sources, so the gate had been passing over
sources it had never seen. **This matters for Phase A specifically**: every source added
below lands in the same registry and must declare a `transport` that matches its verdict, so
the gate must be green and meaningful before 13 more rows arrive. Fixing it is a
registry change with app-behaviour consequences and belongs to its own item, not to the
first source that trips over it.
