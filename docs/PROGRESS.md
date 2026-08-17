# Progress log

Routine checkpoints during unattended work, per `DECISIONS.md` S5.

**What belongs here:** what was done, what was measured, what is next. Everything that would
otherwise be a status message to a human who is asleep.

**What does NOT belong here:** decisions needing a human (those go to `OPEN-QUESTIONS.md`),
findings (`FOUND.md`), or anything hitting the four emergency stops — those surface
immediately, and are the only things that do.

The point of the split: a human returning after eight hours should be able to read
`OPEN-QUESTIONS.md` to find what needs them, and this file only if they want the narrative.
A checkpoint that interrupts is a checkpoint that has cost more than it is worth.

---

## 2026-08-15 — Fact-model migration (B1 + B3 + B4 + P3)

Five commits, each individually green, none squashed.

| # | Commit | Landed |
| --- | --- | --- |
| 1 | `8801197` | B4 — coordinate precision bound to source resolution, undeclared fails closed to country-level |
| 2 | `f963f35` | B3 — `UNVERIFIED` tier, three distinguishing channels, no adapter emits it yet |
| 3 | `f5ce92e` | B1 — Okabe–Ito palette chosen by CVD measurement, dual-encoded with glyph and label |
| 4 | `540f5c7` | P3 mechanical — `inputs` became `DerivedInput[]`, pure refactor |
| 5 | *(this commit)* | P3 semantic — `nodata` in the merged ladder, shortfall caveat, fail-closed requiredness |

**Suite:** 556 → 583 tests across the five commits, census 117 → 123 suites.

**What the migration cost that the plan did not predict**, all recorded in `FOUND.md`:

- Three defects in the condition-based waits introduced to replace fixed durations. The worst
  observed a node that `innerHTML =` replaces, so it **failed by succeeding** — reporting quiet
  while the panel churned. It also masked the third defect by keeping the frame budget from
  ever being exercised.
- A byte-identical verify comparison turned out to be undecidable here: commit 3's unchanged
  code produced 2, 7, 2 and 4 failures across four runs. Rule 36 records what equivalence has
  to mean instead.
- **Neither of P3's two named fixtures exists.** `ScoredInput.weight: number` makes the
  relations case unreachable; San Marino already refuses via the multi-holder guard. Both had
  been asserted across sessions without anyone checking the types (P13).

**Next:** `NEXT-GOAL.md` — hardware GL as default, mutation parallelism, then FIRMS and the
remaining Phase A sources.

## 2026-08-15 — NEXT-GOAL launched: FIRMS + Phase A batch

**Goal state: RUNNING.** The Fact-model migration is closed administratively per S7, with
question 14 as its amendment record.

### Done this checkpoint

| Item | Evidence |
| --- | --- |
| `--only` on verify (Part 1.3, the last harness item) | `5165d67` — 17 assertions/10.4s vs 287/98.4s |
| FIRMS registered, licence read, probed | `322841c` — 200, KEY-GATED, transport worker |
| Path-embedded keys expressible | `keyIn`/`keyPlaceholder`, 5 planted cases |
| Transport declared after the guard caught its absence | `6d9f682` |

**718 tests / 145 suites, all passing. Typecheck exit 0. Tree clean.**

### Next, in order

1. FIRMS adapter — precision bound to `scan`/`track`, thermal-anomalies-only labelling,
   instrument-aware `confidence`, `acq_time` as HHMM
2. FIRMS live fixture through the app's own builder, run through `parse` first
3. FIRMS contract test, then `verifiedAgainst: live` in its own commit
4. Phase A batch: Cloudflare Radar, IODA/OONI, IOM DTM, ReliefWeb/HDX, FEWS NET, IFES,
   UN voting, Feodo — each through the gate, adapter-only where no surface exists
5. #20's Comtrade experiment when the budget resets

### Open, needing nothing from anyone

19a (verdict ladder orders `keyRequired` before reachability) and 18 (`npm run probe` on
Windows) are both shaped and both change behaviour beyond their own source, so each waits for
its own commit rather than riding along.

## 2026-08-15 — Phase A survey, and the first gate table

FIRMS is through (`3d094d6`). The batch was surveyed before any adapter was written, because
five consecutive sources this session had a hazard that was cheaper to find with one request
than with an adapter.

### Per-source gate table — Phase A, as surveyed

| Source | Reachable | Auth | Licence read | State |
| --- | --- | --- | --- | --- |
| Cloudflare Radar | 400 without a token | token, **not in `.env`** | not yet | **blocked on a credential** — Ember precedent |
| IODA | 200 | keyless | not yet | convertible |
| OONI | 200 | keyless | not yet | convertible |
| IOM DTM | not surveyed | — | — | queued |
| **ReliefWeb** | **410 Gone** | keyless | not yet | **endpoint stale in the plan**: *"API version 'v1' has been decommissioned. Please use version 'v2'"* — a version bump, not a dead source |
| HDX HAPI | **429** rate limited | keyless | not yet | retry later |
| FEWS NET | **timeout** | — | not yet | unreachable from this machine; needs a second attempt before it is called blocked (rule 35) |
| IFES ElectionGuide | not surveyed | credentials requested | — | queued |
| UN voting data | not surveyed | — | — | queued |
| **Feodo Tracker** | 200, no ACAO → Worker | keyless | **READ** | **held on `OPEN-QUESTIONS` 22** — the plan said CC0; the terms say all rights reserved, attribution mandatory, no commercial use |

### What the survey changed about the plan

**The licence column in `NEXT-GOAL.md` is a research lead, not a record.** Feodo was the first
one read and it was wrong — CC0 in the plan, copyright-reserved and non-commercial in the terms.
Every remaining source's terms get read before its adapter.

**Two sources are cheaper than they look**: ReliefWeb needs `v2` rather than `v1`, and HDX HAPI
answered 429 rather than anything structural. Neither is a blocker.

**One needs a second measurement before any verdict**: FEWS NET timed out once, and rule 35
requires proving a mechanism is environmental before recording it as such.

**740 tests / 150 suites, typecheck exit 0, tree clean.**

### Phase A gate table — updated 2026-08-15

| Source | Licence read | Probed | Adapter | Fixture | Contract | Flipped | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **FIRMS** | ✅ NASA open, citation urged | ✅ | ✅ | ✅ live | ✅ | ✅ | **through** |
| **OONI** | ✅ CC BY-NC-SA 4.0 | ✅ | ✅ | ✅ live | ✅ | ✅ | **through** |
| Cloudflare Radar | — | 400 | — | — | — | — | blocked: token not in `.env` |
| IODA | ❌ unreadable (SPA) | 200 | — | — | — | — | **blocked: `OPEN-QUESTIONS` 23** |
| IOM DTM | — | not surveyed | — | — | — | — | queued |
| ReliefWeb | — | 403 on v2 | — | — | — | — | **blocked: approved appname, `OPEN-QUESTIONS` 23** |
| HDX HAPI | — | 429 | — | — | — | — | retry |
| FEWS NET | — | timeout | — | — | — | — | needs a second measurement (rule 35) |
| IFES ElectionGuide | — | not surveyed | — | — | — | — | queued |
| UN voting | — | not surveyed | — | — | — | — | queued |
| Feodo Tracker | ✅ **not CC0** — all rights reserved, NC | 200 | — | — | — | — | held: `OPEN-QUESTIONS` 22 |

**2 of 10 through. 4 blocked on things this machine cannot supply, each with a named blocker
and a stated remedy. 4 still to survey.**

Every licence read so far has contradicted the plan's column: Feodo was "CC0" and reserves all
rights; OONI had no entry and is the most restrictive CC variant this project can use.

### Phase A gate table — 2026-08-15, three through

| Source | Licence | Probed | Adapter | Fixture | Contract | Flipped | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **FIRMS** | NASA open, citation urged | ✅ | ✅ | ✅ | ✅ | ✅ | **through** |
| **OONI** | CC BY-NC-SA 4.0 | ✅ | ✅ | ✅ | ✅ | ✅ | **through** |
| **Feodo Tracker** | **`nc`** — not CC0 | ✅ | ✅ | ✅ | ✅ | ✅ | **through** |
| Cloudflare Radar | — | 400 | — | — | — | — | token not in `.env` |
| IODA | **unreadable** | 200 | — | — | — | — | `OPEN-QUESTIONS` 24 |
| IOM DTM | — | 404 | — | — | — | — | endpoint unknown |
| ReliefWeb | not read | 403 | — | — | — | — | `OPEN-QUESTIONS` 23b — appname |
| HDX HAPI | — | 429 bot block | — | — | — | — | contact `hdx@un.org` |
| FEWS NET | — | timeout ×2 | — | — | — | — | needs another vantage point |
| IFES ElectionGuide | — | 401 | — | — | — | — | request access |
| UN voting | — | 202 async | — | — | — | — | confirm the intended API |

**3 of 10 through. 7 blocked, every one on something outside this machine, every one with its
remedy recorded.**

**774 tests / 157 suites, typecheck 0, verify 287 assertions with only the known L9 cluster
failing, tree clean.**

### What the three conversions have in common

Each carried a hazard that a plausible adapter would have shipped:

- **FIRMS** — five-decimal coordinates for a 400 m pixel, which for this source reads as a
  strike location
- **OONI** — a field named `day` that means hour, and a total sitting beside its own components
- **Feodo** — a plan entry saying CC0 over terms reserving all rights, and offline C2 records
  that would have counted as present threats

None was visible from the documentation. All three came from measuring the response.

### Verification battery — 2026-08-15, at the close of the Phase A goal

| Check | Result |
| --- | --- |
| `npm run typecheck` | **exit 0**, both projects |
| `npm test` | **777 tests / 157 suites, 0 fail**, census re-recorded |
| `npm run verify` | **287 assertions across 10 steps, 0 skipped** — 5 failures, all the known-open L9 marker-click cluster in step 7 |
| `npm run mutate` | **11 mutations, 11 CAUGHT by the named assertion, 0 SURVIVED, 0 caught elsewhere, 0 inconclusive** |
| `git status --porcelain` | empty, nothing unpushed |

**Mutation timing, measured under the run lock on the GPU harness (rule 20a):** 1169s wall
clock, fastest 93s, median 100s, slowest 125s. S4a's arithmetic holds — a full suite before a
goal close is affordable at ~20 minutes where it was 65.

**Every mutation was caught by the assertion named for it**, which is the distinction rule 34
exists for: a mutation caught by a neighbour proves the suite noticed something, not that the
intended check works.

### Goal outcome, stated plainly

| Item | State |
| --- | --- |
| (1) FIRMS through the full gate | **complete** |
| (2) Phase A batch, each through the gate | **3 of 10 — NOT satisfied** |
| (3) Comtrade experiment | **complete**, and it corrected a shipped tier |

**Item 2 is not satisfied and is not being reinterpreted.** Seven sources are blocked on
credentials, endpoints, licence text and a vantage point that do not exist on this machine; each
is recorded with its blocker and the single action that clears it (`OPEN-QUESTIONS` 22–26).

### Phase A final standing — 2026-08-15

| Source | Licence | Gate state | Blocker |
| --- | --- | --- | --- |
| **FIRMS** | read: NASA open | **through** | — |
| **OONI** | read: CC BY-NC-SA 4.0 | **through** | — |
| **Feodo Tracker** | read: `nc`, not CC0 | **through** | — |
| FEWS NET | **read from the API**: CC BY 3.0 IGO | registered, excluded | IPC endpoints time out / 404 / 500 |
| ReliefWeb | not read | registered, excluded | approved appname (23b) |
| Cloudflare Radar | not read | not registered | token |
| IODA | **unreadable** | not registered | licence text (24) |
| HDX HAPI | not read | not registered | bot block — email `hdx@un.org` |
| IFES ElectionGuide | not read | not registered | access request |
| IOM DTM | not read | not registered | **endpoint unknown — I inferred it (27)** |
| UN voting | not read | not registered | **endpoint unknown — I inferred it (27)** |

**3 through the gate. 2 registered and parked. 6 blocked before registration.**

Five licences were read: three permitted conversion, one (FEWS NET) revealed a per-record
policy the source-level licence does not cover, and one (IODA) could not be found at all.
**Every licence read contradicted the plan document** — always in the permissive direction.

## 2026-08-15 — Step 8 closed: the Military tab

**Every specced element built, and every hard case asserted in a browser.**

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **798 tests / 165 suites, 0 fail**, census clean |
| `npm run verify` | **338 assertions across 11 steps, 0 skipped** — failures only in the known-open L9 cluster |
| `npm run mutate` | **12 mutations, 12 CAUGHT by the named assertion, 0 SURVIVED, 0 caught elsewhere** |
| `git status --porcelain` | empty, nothing unpushed |

### What step 8 shipped

| Specced element | State |
| --- | --- |
| A country with no armed forces | abolished ≠ absent, asserted (Costa Rica) |
| Expenditure without personnel, and the reverse | independent, asserted (Iceland, Eritrea) |
| C-in-C is the head of government | one person, said once |
| Ceremonial vs operational command | ceremonial marked; undeclared fails closed to ceremonial |
| Non-NPT and undeclared nuclear states | the estimate named as the entire claim (Israel) |
| **Zero recorded overseas presence → "none recorded"** | **the step's acceptance criterion, asserted in a browser** |
| The generated no-equipment-data card | rendered where it corrects an impression, withheld where it would create one |

### The idiom that hardened during this step

**Every disclosure ships with the case where it must appear AND the case where it must not.**
Either alone passes on a mechanism that fires always or never:

| Disclosure | Must appear | Must not |
| --- | --- | --- |
| "None recorded" | Costa Rica, empty list | New Zealand, real deployment |
| No-equipment card | New Zealand, has forces | Costa Rica, abolished |
| P3 shortfall caveat (earlier) | contributing input empty | required input empty |

The step-8 mutation exists to prove that pairing: it makes the card render everywhere, and was
**caught by the card-ABSENCE half**, not by its presence check.

## Item 4e — per-panel live conversion: status, measured — 2026-08-16

`CORE-GOAL.md` item 4e requires every panel converted to live per 20b, each in its own commit.
**It is partially achievable, and the reasons are measured rather than estimated.**

| Panel | State | Evidence |
| --- | --- | --- |
| **economy** | **converted** | `loadEconomyLive` + the scenario harness. 20b's worked example, already shipped |
| **legislature** | convertible, harness not ready | `wikidata-sparql` is CLIENT-FETCH with a 146-byte probe response; the queries are fixed, bounded and measured at 1–2s |
| **government** | convertible, harness not ready | same source, same verdict |
| **dossier header** | convertible, harness not ready | Wikidata + Wikipedia + Commons, all CLIENT-FETCH |
| **tv** | **blocked — payload** | `channels.json` is **1,274,245 bytes gzipped, 9.8 MB raw**; `streams.json` 548,960 gzipped. Not fetchable per panel view |
| **military** | **blocked — no source** | `hasArmedForces` has none that works. OPEN-QUESTIONS 31: the Wikidata route is wrong for Costa Rica, Panama and Iceland |
| **news** | **blocked — source unreachable** | GDELT: 6 of 6 attempts failed across a full session. `SPEC-BREAKING-NEWS` orders the curated RSS fallback first |

### The harness is the actual blocker for the three convertible panels

`ScenarioFetcher.request` reads `spec.path.split('/indicator/')` and branches on
`NY.GDP` — **it is World-Bank-shaped**, because it was built for the one panel that needed it.
Converting a Wikidata panel through it means generalising the scenario harness first, and that
is its own piece of work with its own gate: scenarios per source, fixtures per scenario, and the
four fetch states asserted for each.

**Forcing a conversion through a harness that is not ready would manufacture the completion at
the cost of what the conversion is for.** That is the Phase A lesson verbatim — six sources were
recorded with their blockers rather than pushed through guessed endpoints, and the goal's
amendment clause covered it.

### What the TV blocker actually needs

Not a fetch. A **build-time extract**, the way `scripts/extract-ucdp.mjs` already handles
417,968 events: pull the index at build time, keep the fields the panel uses, ship a small
artefact. The measurement says so plainly — no amount of caching makes a 9.8 MB index a
per-view fetch, and the blocklist must be applied at extract time so the excluded channels never
reach the bundle at all.

### Disposition

Recorded, not forced. The next concrete step for 4e is **generalising the scenario harness**,
after which legislature, government and the dossier header convert in three commits against a
source already verified CLIENT-FETCH.

---

## V2 section 3 — SPEC-WARWATCH: Phase 0 first, and a reorder it forces

**Phase 0 for the market ticker is done and its report is `docs/PHASE0-MARKETS.md`.**
SPEC-WARWATCH §1 required it before a provider was chosen, and it reached the same class of
conclusion Phase 0 reached for WorldPop: **the surface as specified cannot be built honestly.**

Three findings drive everything downstream:

1. **No free, keyless, redistribution-permitted live quote feed exists.** FRED's terms reserve
   third-party series and forbid extraction; Stooq publishes no terms at all, and L15 makes
   silence a refusal rather than a grant; every commercial free tier restricts redisplay.
2. **What is usable is EIA (public domain) and the World Bank Pink Sheet (CC BY, monthly).**
   Between them: Brent, WTI, natural gas, gold, wheat. **Major indices and defence-sector
   equities have no redistributable source at all** and become an app-owned gap in decision
   #32's wording.
3. **It is therefore not a ticker.** EIA publishes daily spot prices with a lag; Pink Sheet
   publishes monthly averages. Ticker chrome is itself a claim about freshness, and §1's own
   rules — permanent delay disclosure, "market closed is a state, not a stale number" — already
   forbid putting a monthly average under a scrolling tape.

### The reorder

**§1 moves to the end of section 3, after the edge Worker exists.** EIA is key-gated, and
`src/fetch/compose.ts` already refuses to route a secret key without `transport: "worker"` —
it throws rather than leaking. The Worker is not built; 18 sources in `CORS-VERDICT.md` are
waiting on the same thing, and it belongs with deployment in V2-GOAL section 5.

This is a dependency the spec did not name. What it *did* name — "the ticker exercises the
fetch layer, and the fetch layer does not exist" — **is out of date**: `src/fetch/` exists and
step 7b asserts its four states.

**New order for section 3:** intel feed → dashboard → prediction markets → biohazard →
public cameras → conflict presets → broadcast traffic and Hormuz → market strip (post-Worker).
The intel feed leads because it needs no new source: it reuses `src/news/significance.ts`
whole, which is what §3 demands anyway — *"a second ranking mechanism would drift from the
first."*

### 3.1 — the intel feed: shipped, with one requirement named as outstanding

Built and gated: chronological cross-source feed, search, sort, 24h/7d/30d/all range,
header counters, per-card severity band, "why this severity" inspector walking down to the
source articles, pagination with a stated total. Verify step **8e**, 21 assertions.

**Severity is banded as a share of what ANSWERED, not of a fixed maximum.** An input the
app could not consult is excluded from the denominator as well as the numerator, so
failing to look lowers confidence and never the band. `tests/intel.test.ts` carries the
planted case (rule 27): it recomputes the boundary the naive way and shows the same story
falling out of `high` purely because the app did not check its event linkage.

**Outstanding, and not silently dropped:** §3 also requires **user-adjustable severity
weights**. The engine already takes a weights argument — `severityOf(story, weights)` and
`significanceOf(story, weights)` both accept one — so this is a control surface, not a
model change. It is not built, and the feed currently renders
`DEFAULT_SIGNIFICANCE_WEIGHTS`. Named here rather than left for a reader to notice.

**Corpus limit, stated on the surface:** the feed reads the captured article fixtures.
GDELT is recorded UNREACHABLE after six of six attempts, so a live cross-source feed is
blocked on the same thing the breaking board is. Both caveats render above the cards.

---

## The session's closing observation

**The best catches came from the machinery rather than the operator.**

Four, from one session:

- A **planted test overturned security reasoning**. The Worker's origin check rejected
  paths beginning `//`, and a test was written to confirm that `/\evil.test/x` was
  therefore safe. It is not: WHATWG parsing normalises the backslash and the path
  resolves to a different host entirely. The test failed, the belief was wrong, and the
  second defence — comparing the composed URL's origin against the registry's — is the
  only thing that stood between this Worker and being an open relay. Written before it
  shipped, not after an incident.
- The **fact discipline refused untiered facts**. A tier assertion built on synthetic
  facts rendered `UNTRACEABLE`, because a fact with no provenance cannot claim a tier.
  The fixture was wrong, not the code, and the assertion now runs against a real capture.
- The **coverage scanner caught a masquerading homepage**. `portwatch.imf.org` was
  hardcoded as an attribution link; it is the homepage, not the registered origin, and so
  it was a host in `src/` that nobody had registered.
- An **eight-word comment deleted its own obsolete check by failing loudly**. It had said:
  *"when NO tab is unbuilt, delete the second check rather than weakening it."* Building
  the Risk tab removed the last pending card, the check that read it aborted a step on a
  90-second timeout pointing straight at the line, and it went out exactly as instructed.

**That is the green being real, which is the only thing worth having.** A suite that only
ever agrees with the person who wrote it has been illustrated, not tested. Every one of
these contradicted the operator — and each was cheaper to hear then than to discover from
a reader who had trusted a number.
