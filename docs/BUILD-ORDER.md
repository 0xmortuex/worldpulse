# Build order — all 14 steps

**Current state: step 7 of 14 complete** (7b included). The globe, selection model,
relations engine, confidence badge, provenance inspector, dossier header, Government,
Economy and News tabs, the natural-event globe layers, and the economy fetch states work.

## Why this file exists

The enumeration lived in the original spec and in one README line — `build step 7 of 14` —
with individual steps referenced only in passing across `README.md`, `DECISIONS.md`,
`FOUND.md` and `OPEN-QUESTIONS.md`. Steps 9, 10, 12 and 13 could be reconstructed from
those scattered references; **steps 8, 11 and 14 could not be recovered from the repository
at all** and had to be supplied from outside it.

That is the same failure as a handoff that never landed: **load-bearing state living in
scrollback.** A number in a README that says "7 of 14" without saying what the 14 are is a
promise the repository cannot keep. This file is the enumeration, and it is the thing to
update when the state changes.

---

## The steps

| # | Step | State |
| --- | --- | --- |
| 1 | Globe, selection model, traceable relations engine | done |
| 2 | Confidence badge, provenance inspector, fact discipline | done |
| 3 | Dossier header, leader resolution, portrait pipeline | done |
| 4 | Government tab, layout assertions, classification watchlist | done |
| 5 | Economy tab, series gaps, log scale | done |
| 6 | News tab, tone timeline, text-fidelity assertions | done |
| 7 | Globe event layers, occlusion, clustering, staleness | done |
| 7b | Economy fetch states — loading, unavailable, degraded, stale | done |
| 8 | **Military tab** | scheduled |
| 9 | **Legislature tab** | done |
| 10 | **Live data pipeline** — ingests replace the seed set | scheduled |
| 11 | **Live TV** | scheduled |
| 12 | **Coverage-gap choropleth** | scheduled |
| 13 | **URL state, time scrub, compare view** | scheduled |
| 14 | **Closing sweep** — contract tests, accessibility, performance | scheduled |

---

## Step 8 — Military tab

Personnel and expenditure (World Bank / SIPRI-derived), FAS warhead estimates, chain of
command, force posture from DMDC and UN Peacekeeping, and the generated
no-equipment-data card.

**Fixture hard cases, already specced:**

- a country with **no armed forces**
- **expenditure without personnel**, and the reverse
- **C-in-C is the same person as the head of government**
- **ceremonial vs operational** command
- **non-NPT and undeclared** nuclear states
- **zero recorded overseas presence** renders as **"none recorded"**, never "none"

That last one is rule 30 in its sharpest form: no answer is not an answer of no.

## Step 9 — Legislature tab · DONE

**The blocker was real and is fixed.** `buildLegislatureQuery` never completed against live
WDQS for any country tried — 504 for GBR, 500 after 60.6s for Iceland, 504 after 65.5s for
Vatican City. The cause was not slowness: a `BIND` in its own UNION branch left `?chamber`
unbound, so `OPTIONAL { ?chamber wdt:P1342 ?seats }` matched every entity in Wikidata with a
seat count. That is the timeout AND the reason a query for the United Kingdom returned Swiss
cantons.

**Two further defects were found while building the tab, both of which had been recorded as
successes:**

- **The parent body was returned as a chamber of itself.** GBR rendered as tricameral with a
  third seat count that was the other two added together; NZL rendered the same 120 seats
  twice. Fixed with a relational guard — keep a body only when no child of it is itself a
  chamber — chosen over two structural repairs that measurement showed would drop Germany
  and every unicameral country respectively.
- **`P527` is "has part(s)", and the party clause read it as "has party".** Across eight
  countries it returned the Monarch of the United Kingdom, the Bundesrat Library, committees
  and bare Q-ids, and **not one political party**. The clause now constrains to real parties,
  which returns nothing — so the panel states the absence. Sourcing is `OPEN-QUESTIONS` 30.

**What the tab does.** Chambers and seat counts as badged facts; the shape (unicameral /
bicameral / "at least N"); a combined total withheld when any chamber's count is missing; and
status — sitting, dissolved, suspended, contested, appointed-consultative, unrecorded — seeded
from `data/legislature-seed.json` because no query answers it.

**The rule-30 pair is the point:** an empty chamber list renders as a gap in *our source*,
never as the country having no legislature. Saudi Arabia is the measured case — its `P194`
points at "Government of Saudi Arabia", which reaches no chamber type at any depth, while the
Consultative Assembly exists unlinked with 150 seats.

## Step 10 — Live data pipeline

Live ingests replace the hand-checked seed set (`README.md`: the seed banner exists so the
interaction is provable before the pipeline lands). Phase A of `SPEC-EXPANSION.md` builds
the ingest muscle this step needs.

## Step 11 — Live TV

Via iptv-org, with **per-stream health checks**. Dead streams are **marked offline and
sorted last** — not hidden, which would misreport coverage.

## Step 12 — Coverage-gap choropleth

Carries the **P3 missing-data propagation** change with it (`UNEXERCISED-PATHS.md` §
P3). Note that P3 has since been **re-scheduled forward** into the batched `Fact`-model
migration in `SPEC-EXPANSION.md` Phase B — see that spec for the current disposition.

## Step 13 — URL state, time scrub, compare view

`state.ts` holds selection and weights; URL state lands here. The time scrub must score a
pair as of a past date without the scoring module knowing about time.

**Phase B2 of `SPEC-EXPANSION.md` is the same work** and discharges the URL-state portion of
this step. Do it once.

## Step 14 — Closing sweep

Contract tests completion, accessibility pass, performance pass.

**Phase B of `SPEC-EXPANSION.md` moves most of the accessibility pass earlier** — B1
(colourblind-safe, dual-encoded), B5 (`prefers-reduced-motion`) and B6 (parallel accessible
data table) are accessibility work pulled forward because they change how everything
renders and because B6 is L10's load-bearing mitigation. What remains here is the sweep over
whatever landed after them.

---

## Relationship to SPEC-EXPANSION.md

The expansion spec **does not displace these steps**. It interleaves with them; the approved
interleaving is recorded in `SPEC-EXPANSION.md` under *Order and process*. The couplings
that matter:

| Expansion item | Build-order step | Disposition |
| --- | --- | --- |
| B2 — deep-link view state | 13 | same work; do once |
| B6 — accessible data table | with the event feed | per `DECISIONS.md` L10 |
| B1/B3/B4 + P3 | was 12 | pulled forward into one batched `Fact`-model migration |
| C2 — population-exposed significance | vs `SPEC-BREAKING-NEWS.md` | sequenced against that spec's ranking |
| Phase A | 10 | builds the ingest muscle step 10 needs |
