# Found while doing something else

Findings surfaced mid-item during autonomous work. **Recorded here and not acted on** —
they do not reprioritise the queue.

Each entry says what was found, where, and what it would take to act on it. Nothing here
is a decision for the reader; decisions go to `OPEN-QUESTIONS.md`.

---

## The legislature SPARQL query never completes against live Wikidata

Found while capturing contract-test fixtures for the six query builders (queue item 2).

| Query | Country | Result |
| --- | --- | --- |
| `buildLegislatureQuery` | GBR | **HTTP 504** |
| `buildLegislatureQuery` | ISL (Iceland) | **HTTP 500 after 60.6s** |
| `buildLegislatureQuery` | VAT (Vatican City) | **HTTP 504 after 65.5s** |
| `buildCabinetQuery` | GBR | **HTTP 504** |
| `buildCabinetQuery` | ISL | 200 — **52.6s**, 33 rows |
| `buildCabinetQuery` | TUV | 200 — fast, 17 rows |

**It is not country size.** Vatican City has one legislative body and Iceland has one
chamber; both fail at the ~60s mark, which is WDQS's server-side query timeout. The
legislature query does not complete for *any* country tried.

The cabinet query is not failing but is not healthy either: **52.6 seconds for Iceland**
against a 60s ceiling, and a 504 for the United Kingdom. It works today for small
countries and will fail for large ones.

**Consequence.** The government tab's legislature section can never load live data as
written, and its cabinet section will fail for exactly the countries most users open
first. Both are latent rather than user-visible, because the app makes no runtime fetches
(`UNEXERCISED-PATHS.md` §8) — which is the only reason this is not an emergency under the
`OPEN-QUESTIONS.md` criteria.

### This is a defect in the query, not a flaky source — and it blocks step 9

Reclassified deliberately. "WDQS is slow" invites retry-and-hope, which is the wrong
treatment and would burn the step-9 legislature tab's budget on requests that cannot
succeed. The evidence says the problem is ours:

- it fails for **every** country tried, including Vatican City (one legislative body) and
  Iceland (one chamber) — so it is not data volume at the country level
- it fails at the **~60s mark**, which is WDQS's server-side timeout, not a network fault
- the sibling cabinet query against the same endpoint returns in 52.6s for Iceland and is
  fast for Tuvalu — same service, same moment, different query

A query that exceeds a public endpoint's documented timeout for all inputs is a query that
was never viable, and no amount of retry, backoff or caching makes it complete. **Step 9
cannot be built on it**, and the design work — narrowing the OPTIONAL clauses that produce
the cross-product, splitting the round trip per chamber, or precomputing at build time the
way UCDP is — belongs before step 9 starts, not inside it.

The same measurement puts the cabinet query on notice: 52.6s against a 60s ceiling is not a
pass, it is the same defect one country larger.

**Not acted on.** Fixing it means rewriting two SPARQL queries — narrowing the optional
clauses, splitting the round trip, or moving the work to the Worker — which is query
design, not queue work. It also means the legislature contract test in item 2 cannot be
written against a real capture, which is recorded as deliberately-not-done rather than
silently skipped.

---

## The mutation suite could report a clean gate over zero executed assertions

Found while running `npm run mutate` for the queue's closing gate.

**Acted on, unlike everything else in this file.** The standing rule is that a finding is
recorded and does not reprioritise the queue. This one is the exception, and the reason is
narrow: it is a defect in the instrument that produces *the gate condition for the item in
flight*. "Zero SURVIVED and zero unclassified" was the thing being measured, and this is
the bug that lets a run print exactly that having measured nothing. Deferring it would
have meant closing the item on a number I had just proved could be fabricated.

**What happens.** `verify-render.mjs` aborts before any assertion when it cannot launch a
browser — an unset `PLAYWRIGHT_CHROMIUM_PATH` on a machine that ships Chromium out of band
does it. The abort is reported honestly: every step skipped, `0 assertions across 9 steps`,
non-zero exit.

`mutation-check.mjs` scored that **CAUGHT-ELSEWHERE**. That verdict was absent from the
list gating the exit code, so:

```
9 mutation(s): 0 caught by the named assertion, 9 caught elsewhere, 0 SURVIVED, 0 inconclusive
exit 0
```

A green mutation gate over an empty run.

**Why the existing guard missed it.** The guard was already there, with the right reasoning
written above it — *"a non-zero exit with nothing parsed is not a catch... calling that
CAUGHT would be the same overstatement as calling a build failure a catch."* It is defeated
because the abort prints its own `FAIL harness aborted: ...` line, so something **was**
parsed. The check asked *did a FAIL line appear*; the question it meant to ask was *did any
assertion run*. Those agree on every healthy run and diverge precisely when the harness
dies — the one case the guard existed for. Third instance of the pattern behind rule 27:
the two vacuous rule-26 passes were the first two.

**Fixed.** `scripts/mutation-verdict.mjs` — classification extracted as a pure function so
planted cases can drive it, keyed on the suite's own assertion tally rather than on the
wording of a failure line. New verdict `NOT-EXERCISED`, checked **before** `exit === 0` so
a run that never looked cannot score SURVIVED either. `INCONCLUSIVE` is exported from one
place; it had been three inline literals, and the disagreement between two of them is the
whole bug. Eight planted cases in `tests/mutation-verdict.test.ts`, the first built from
the recorded output of the real failed run — verified to score CAUGHT-ELSEWHERE/exit 0
under the old logic and NOT-EXERCISED/exit 1 under the new.

**Also worth knowing:** `PLAYWRIGHT_CHROMIUM_PATH` is documented in `README.md` and
`TESTING.md` but is not set by this environment, so `npm run verify` and `npm run mutate`
both need it exported. That is a setup fact, not a defect, but it is what made the defect
observable.

---

## The browser cannot reach any live origin in this container

**Found while switching the economy panel to live World Bank data (2026-08-12).**

`fetch('https://api.worldbank.org/...')` from inside Chromium fails with
`TypeError: Failed to fetch`. Outbound HTTPS in this environment goes through an agent
proxy that Node is configured for and the browser is not. Pointing Playwright at
`HTTPS_PROXY` does not fix it either — the proxy presents its own CA, which Chromium does
not trust — and the remaining step, disabling certificate verification, is not available.

**Consequence for the suite.** The live path cannot be exercised in the browser here. It is
proven end to end in Node instead (`tests/worldbank-live.test.ts`, `PROBE_LIVE=1`), which
runs the real request through registry → compose → transport → adapter → `Fact`. The
browser suite drives the economy panel through deterministic scenarios.

**This is not a workaround for flakiness, and the distinction matters.** Even with browser
egress the scenario mechanism would still be needed: `loading`, `stale`, `degraded` and
`unavailable` are each reachable only through a specific remote failure, and demonstrating
them against a live origin means waiting for it to break.

### A second finding, measured rather than suspected

Switching scenarios by page navigation **made an existing flaky check worse**. Step 7's
marker-click check is frame-rate sensitive and is the suite's known flake. With four extra
`page.goto` reloads ahead of it:

| Harness shape | Step 7 failures |
| --- | --- |
| Before this work | 1 (the known flake) |
| Scenarios by reload, before step 6 | 5 |
| Scenarios by reload, after step 7 | 4 |
| Scenarios by in-page hook, no reload | 2, and 0 on a subsequent run |

Reordering helped and did not fix it; removing the reloads did. **An instrument that
degrades the thing it measures is not measuring it** — rule 20, arriving from the opposite
direction to the one it was written for: not an instrument that resembles the client too
little, but one whose own cost changes the client's behaviour.

---

## The app-level F6 guard is defence in depth, not the load-bearing defence

**Found while writing a mutation to break it (2026-08-12).**

The intended mutation was to remove the selection-identity check in
`src/fetch/selection.ts` and watch the browser suite catch France's data rendering into
Jamaica's dossier. It would not have been caught, and the reason is structural rather than
a gap in the assertions.

`renderEconomyTab` stores loads in a `Map` keyed by ISO3, and renders
`loads.get(currentIso3)`. A late response for France is therefore written to France's own
key; the panel showing Jamaica reads Jamaica's entry and finds it still loading. **The
keying prevents the cross-country render on its own**, and the identity check only avoids a
pointless rerender.

**Both are kept.** The guard is not redundant in general — it is load-bearing for any panel
holding a single "current load" rather than a map, which is the obvious shape and the one a
future panel is likely to reach for. What changed is my claim about it: the app is safe
because of how the loads are stored, and the guard is the second lock, not the first.

**Where the race is actually proven:** `tests/fetch-transport.test.ts`, which drives the
sequence directly — issue for France, switch to Jamaica, resolve France late, assert no
panel receives it — plus the mirror case where the user returns to France and the response
IS accepted. Those tests fail if the guard is removed, because they exercise the guard
rather than the panel's storage.

**Worth stating plainly:** I would have shipped a mutation that passed vacuously and read
it as evidence the race was covered in the browser. It was caught by asking what the
mutation would actually change before running it, which is the habit rule 27 is really
about.

---

## The marker-click flake invalidates mutations, not just its own check

**Found in a full mutation run on `e95ca67` (2026-08-13).**

Step 7's marker-click failure is recorded as a known flake — one assertion, ~40% of runs. That
understates it. In this run the flake escalated: three dropped clicks in a row, then a
`locator.click` timeout at 90s, which threw and **aborted step 7 and every step after it**.

    7 — globe event layers                       23  19  4   -
    7b — economy fetch states                     0   0  0   1
    cross-cutting — text fidelity (rule 9)        0   0  0   1
    cross-cutting — layout geometry (rule 8)      0   0  0   1

    141 assertions across 10 steps, 3 skipped

**Consequence.** Two mutations target those steps. Both were scored `CAUGHT-ELSEWHERE` from
step 7's failing labels, having never been exercised — and `CAUGHT-ELSEWHERE` is not in the
inconclusive set, so the run printed `0 SURVIVED, 0 inconclusive` with two mutations
unmeasured.

**Classifier fixed.** `stepWasExercised` reads the per-step table and scores a mutation whose
own step never ran as `NOT-EXERCISED`. Replayed against the recorded output: old logic
`CAUGHT-ELSEWHERE` and gated as a pass, new logic `NOT-EXERCISED` and blocks. Same shape as
the bug that produced this module — the check asked a question about the RUN when the
principle is about the MUTATION, and the two agree on every healthy run.

**Not fixed: step isolation.** One step's exception ends the suite. Each step is top-level
`await` code in a 1400-line script rather than a function, so making steps independently
recoverable is a real refactor and is recorded rather than attempted mid-run. The journal
limits the damage — a re-run resumes the verdicts already recorded and re-runs only the
unexercised ones — but the underlying fault stands: **a flaky assertion in one step can
silently invalidate measurements of unrelated steps.**

**Reclassification.** L9 describes marker clicks as a user-facing risk on slow devices. It is
also a *measurement* risk: it is the only known fault in this project that can make other
checks report verdicts they did not earn.

## `pickEvent` reads the tooltip twice, and the gap between the reads is a false negative

Recorded because the fix was written, measured, and then reverted on purpose — so the next
session finds the reasoning rather than rediscovering the idea and landing it.

**Mechanism.** `pickEvent` asks two questions in two round-trips: `waitFor(… '.evt' !== null)`,
then a separate `page.evaluate` reading `data-event-id` off that element. globe.gl rewrites
the tooltip container on every raycast frame, so a re-render landing between the two calls
returns `settled: true, id: null` — a marker that resolved correctly, reported as one that did
not resolve at all.

**Observed** 2026-08-14 under swiftshader: three step-7 failures, all cascading from a single
such read (`the pick resolves to…` compares against `null`, and the camera positive control
then calls `eventById('')`). `artifacts/23-globe-layers.png`, captured immediately after,
shows the correct tooltip for the aimed-at event on screen — the app had resolved the marker;
the harness failed to read it.

**The edit.** Merging both reads into one `page.evaluate`, returning `{id}` from the same
evaluation that finds the element, removes the gap. Presence and identity stay separately
reportable, so "no tooltip" remains distinguishable from "wrong id", and timeout behaviour is
unchanged — which matters for the occlusion check, which requires a null pick.

**Why it was reverted.** Rule 15 already records that the `.evt`-existence wait is *vacuous*:
the previous hover's tooltip satisfies it instantly, so the guard can pass without a fresh
hover ever happening. Merging the reads does not touch that. **It removes the failures without
removing their cause**, which is what rule 34 exists to prevent — and it was measured on an
11-commit-stale tree under a frame rate that no longer applies to this machine, so "it fixed
the three failures" is uninterpretable as evidence.

**What would make it landable.** Fix the vacuity first — require the tooltip to clear and a
fresh hover to be observed, which `measure-frame-profile.mjs` already implements as its
`cleared` mode — then measure the read race on its own under a stated harness configuration
per rule 20a. Two defects, fixed and measured in the order that lets each be seen.

---

## disease.sh reports a fresh timestamp over data frozen in March 2023

**Found while taking disease.sh + WHO through the gate (SPEC-EXPANSION Phase A2), 2026-08-14.**

| Check | Result |
| --- | --- |
| `/v3/covid-19/countries` | 231 countries, HTTP 200, `ACAO: *` |
| `updated` field on every row | **0 hours ago** |
| `todayCases` on every row | **0, for all 231** |
| `/v3/covid-19/historical/USA?lastdays=all` | 1143 points, `1/22/20` → **`3/9/23`** |
| `/v3/influenza`, `/v3/influenza/countries` | **404**, though the homepage advertises influenza |

**The `updated` field is the API's own refresh time, not the date the data refers to.** It
reads "0h ago" on a cumulative series that has not moved since **9 March 2023** — three and a
half years. Rule 4's "as of" is the date the DATA refers to, and `updated` is not it.

**`todayCases: 0` is not a reported zero.** All 231 countries report it simultaneously, which
is not 231 countries observing no cases; it is the absence of any new figure. Rendering it as
"no new cases reported today" would assert a false fact to a user — the emergency category
this project stops for — and it would do so with a fresh-looking timestamp beside it, which is
rule 7's *wrong provenance is worse than absent provenance* exactly.

**Consequence for the rule 30 acceptance criterion.** The criterion for this item was that
"no reported cases" and "no surveillance data" must render differently. Against this source
the distinction is not the one it looks like:

| Apparent state | What it actually is |
| --- | --- |
| `todayCases: 0` | no new figure published since 2023-03-09 — **not** a reported zero |
| country absent from the 231 | no row in this source at all — 21 ISO3 codes, including `PRI` and `GUM`, which are folded into `USA` rather than unmeasured |

So this source has **no true "reported zero" state at all**, and its "absent" state conflates
"never covered" with "aggregated into a parent". Neither maps cleanly onto the criterion, and
building the distinction on top of it would encode a third meaning it cannot support.

**The WHO half is unaffected and live.** `https://www.who.int/api/news/diseaseoutbreaknews` —
OData, `ACAO: *`, newest entry dated the day it was checked. The two halves of this Phase A
item are in completely different states, which is why they are separated in
`OPEN-QUESTIONS.md` question 8 rather than registered together.

### disease.sh's data licence is unestablished, and the API's GPL-3.0 is not it

Measured 2026-08-14, alongside the frozen-data finding above.

| Where a licence would be | What is there |
| --- | --- |
| `github.com/disease-sh/API` | **GPL-3.0** — the licence of the API's *source code* |
| `disease.sh/docs/` | JS-rendered; 15 characters of text without a browser. Not read. |
| the data itself | aggregated from third parties (JHU CSSE, Worldometers), which disease.sh may have no standing to relicense |

**GPL-3.0 on the server code says nothing about the terms of the data it serves**, and
treating it as the data licence would be a reading I did not do. Combined with the frozen
series, disease.sh has two independent blocks, either of which is enough to hold it:
registering it would ingest content whose terms are unread, which this project treats as an
emergency rather than a note.

**The 404 body is the most useful thing this source produced.** Asking for a country it does
not carry returns:

```
{"message":"Country not found or doesn't have any cases"}
```

**The source conflates the two states in its own error message** — "not found *or* doesn't
have any cases". Any app propagating that as a zero would assert a false fact on the source's
behalf. It is a clean statement of why rule 30's distinction has to be enforced by the
consumer: the producer here cannot make it, and says so.

---

## Ember's keyless bulk CSVs cannot be read by a browser

**Found while taking Ember through the gate (SPEC-EXPANSION Phase A7), 2026-08-14.**

The spec records Ember as "CC BY 4.0, free key". The key is genuinely free and genuinely
blocking: `api.ember-energy.org` returns `403 {"detail":"No API key set"}` and issuing one
needs a signup. But Ember also publishes bulk CSVs with no key at all, which looked like a way
round it. Measured:

| File | Size | `access-control-allow-origin` |
| --- | --- | --- |
| `release_generation_yearly_global.csv` | **16.0 MB** | **absent** |
| `release_generation_yearly_lower.csv` | **4.1 MB** | **absent** |

**Neither is browser-readable.** No ACAO header means a page cannot read the response, so both
are worker-required — and the Worker does not exist yet. Their size independently rules them
out as fixtures.

So the keyless path is real, is not a shortcut, and the block stands. Recorded because the
next session will find those URLs too and should not spend the discovery twice.

**Two shape hazards in the CSV, for whoever eventually lands it:**

- **Regional aggregates share the table with countries.** `Area type` is `Region` for rows
  like `ASEAN`, whose `ISO 3 code` is blank. Reading the file as a country table files
  ASEAN's generation under nothing, or worse, under whatever the parser defaults to. Same
  shape as UNHCR's world-aggregate row.
- **`Is aggregated source` marks rows that already total other rows.** Summing the column
  without respecting the flag double-counts generation.
- **An empty cell is not a zero.** `Generation (TWh)` is `0.0` for Solar in 2000 — a reported
  zero — while `Generation YoY change (TWh)` is empty in the same row, because there is no
  prior year to compare. The third instance tonight of the distinction UNHCR and CISA KEV both
  required.

---

## Reachable-and-stale is a distinct failure class from unreachable

Generalised 2026-08-14 from the disease.sh finding above, because the shape will recur and the
next instance will not look like this one.

**A source that is reachable, fast, well-formed and three years out of date passes every check
this project currently runs.** disease.sh answered HTTP 200 with `ACAO: *` in 400ms, returned
231 well-shaped country rows, and reported `updated: 0 hours ago` on every one of them. The
probe scored it CLIENT-FETCH. A contract test asserting shape and range would have passed. Its
cumulative series had not moved since **2023-03-09**.

| Failure class | How it presents | What catches it today |
| --- | --- | --- |
| Unreachable | connection error, timeout, 4xx/5xx | the probe, immediately |
| Shape drift | fields renamed, types changed | contract tests |
| **Reachable-and-stale** | **200, fast, correct shape, current-looking timestamp** | **nothing** |

**The dangerous part is the timestamp, not the staleness.** Old data honestly labelled is
useful — the app has a whole stale treatment for it. What makes this a distinct class is that
`updated` describes *the API's own refresh*, not the data, so the source actively reports
freshness it does not have. A panel built on it would render a live-looking badge over frozen
figures: rule 7's wrong-provenance failure, arriving through a source that never errored.

**The systematic answer is already specced.** `SPEC-EXPANSION.md` Phase C5, the **freshness
monitor** — every source's last successful fetch against its declared cadence, generated from
the registry. This class is precisely what it exists to surface, and disease.sh is its first
concrete test case: a source whose fetch succeeds on schedule while its *content* has not
changed in three years.

**Two things that would strengthen it, noted rather than built:**

- **Cadence is declared but never checked against observed change.** Every source carries a
  `cadence` field. Nothing compares it to when the data last actually moved, which is the
  measurement that separates this class from a healthy source.
- **A source's own freshness field must be treated as a claim, not as provenance.** `updated`,
  `lastModified`, `generated` are the source describing itself. Where a dated series exists,
  the last dated observation is the honest "as of" — which is how the PortWatch and WHO
  adapters take theirs.

---

## Ten colours over-subscribe the colourblind-safe space, and the globe pays for it

**Found while making the relation palette colourblind-safe (B1), 2026-08-15.**

The relations layer encodes **two** things in hue: which tier (5 values) and whether the
classification rests on stale evidence (2 values). That is ten colours, and ten mutually
distinguishable colours do not exist under dichromacy.

Measured with `scripts/cvd.mjs` over the shipped palette, worst cross-tier pair:

```
adversary (base)  #D55E00   vs   strained (low confidence)  #8f8a1f
ΔE 9.7 under protanopia
```

**A confident adversary and an unconfident strained are the same colour** to a protanope.

**Where this does and does not bite.** In the relations list it does not: the tier is carried
by glyph and label as well as hue, and low confidence by the `low conf.` tag. On the **globe**
it does — a polygon fill is one channel, and there is no second one. The tier is recoverable
from the popover, which names it, so nothing is knowable *only* from the fill; but a reader
scanning the globe without hovering can misread that pair.

**What was measured on the way, and is worth keeping:**

- The palette this replaced had two collisions, and the one the spec predicted was not among
  them. The spec said "relations mode leans on red/green"; it was blue/red, which is safe.
  The real collisions were `adversary`/`strained` (ΔE 13.2, deuteranopia) and
  `neutral`/`nodata` (ΔE ~14.7 under **all three**, and near-identical to normal vision too).
- `neutral` vs `nodata` is this project's own central distinction rendered in one colour:
  *evidence exists and nets out* versus *there is no evidence*. It had been near-invisible to
  everyone since the palette was written.
- `strained` is yellow rather than orange because orange measured ΔE 18.4 against vermillion
  under deuteranopia — under the bar. Yellow measures 33.4. Chosen by measurement.

**Not fixed here**, because fixing it means changing how the globe encodes confidence rather
than which colours it uses. Recorded as `OPEN-QUESTIONS.md` 12.

---

## A frame-based wait budgeted in milliseconds is the fixed-duration bug wearing a disguise

**Found across four verify runs while landing B1 (commit 3 of the Fact-model migration),
2026-08-15.** Each run found a different defect, which is why they are all recorded here
rather than only the last.

`selectCountry`'s fixed 250ms/500ms parks were replaced with condition-based waits precisely
because rule 15 forbids durations. The replacements then made three further mistakes, each
subtler than the last:

| # | Defect | How it presented |
| --- | --- | --- |
| 1 | `waitForDomQuiet` fell back to `document.body` when its selector was absent | the globe rewrites its tooltip container forever, so `body` never quiets: every call burned its budget, the suite grew 270s, step 7 went 1 → 5 failures |
| 2 | It observed `.dossier`, which `root.innerHTML =` **replaces** | a detached node never mutates again, so the observer reported quiet after three frames while the panel churned on. **It failed by succeeding** — no timeout catches that |
| 3 | Both waits budgeted in wall-clock while polling `requestAnimationFrame` | 4 frames costs 3s at the 750ms median and 9.6s at the 2400ms spike, against a 10s budget. `waitForStableNode` was timing out at its own edge and clicking anyway |

**Defect 2 is the one worth remembering.** A wait that times out is loud and gets fixed. A wait
that returns `true` early is silent, and its damage appears somewhere else entirely — in this
case as an intermittent click timeout two steps later. It also masked defect 3: while the wait
was vacuous, nothing exercised the frame budget, so the unit error could not surface.

**The rule the three share:** a wait must observe a target that survives what it is waiting
for, and must be budgeted in the units it polls in. Both are now in the helper's own comment.

**A fourth thing, not a defect but a lesson about instruments.** The `panel settled` check
added alongside these fired once, in a step where every downstream assertion passed. `#panel`
mutates about once every four frames at rest, so "three consecutive quiet frames within
twenty-four" is marginal by construction. It was measuring a proxy rather than the failure —
the failure being a node replaced under a click, which `waitForStableNode` asserts directly.
The wait was kept and the failure report dropped: a check that goes red over something that
breaks nothing teaches people that red means "run it again" (rule 15).

---

## A byte-identical verify comparison needs a deterministic baseline, and this machine has none

**Found while gating commit 4 of the Fact-model migration on "verify must be byte-identical
to commit 3", 2026-08-15.** The criterion is the right idea — a behaviour change hiding inside
a type refactor is how a regression becomes archaeology — but it cannot be evaluated as
written on this configuration.

**Measured. Identical code, repeated runs:**

| Commit | Runs | Failure counts |
| --- | --- | --- |
| 3 (unchanged across all four) | 4 | **2, 7, 2, 4** |
| 4 (unchanged across both) | 2 | **7, 1** |

Commit 3's own baseline moved by a factor of three and a half without a line changing. Commit
4's first run showed 7 failures and its second showed 1 — better than the baseline it was
being compared against.

**So a single run against a single run cannot separate "this commit regressed" from "the
harness varied".** The noise floor is larger than the signal the criterion exists to detect.
Concluding "regression" from run 1 would have been wrong; concluding "fine" from run 2 alone
would have been luck.

**What the comparison has to be instead**, and what was used here:

- **per-step assertion counts identical** — these are structural and did not vary at all across
  six runs (279 both sides, step by step)
- **every assertion outside the known-open check passing**
- **the failure set minus the known-open cluster empty**

That is decidable, and it caught nothing false in either direction.

**Why the counts are stable while the failures are not.** `clickOrFail` emits a `clickable`
check only when a click fails, so a flaky run inflates the total — 279 becomes 281 or 283. The
count is therefore a *derived* signal, not an independent one: comparing totals without
comparing failure sets would read a flaky run as a structural change.

**The two variable classes are both known and both open**: L9's marker click (`DECISIONS.md`
L9, still unexplained) and the click-actionability class documented in rule 15's second
configuration section. Neither is introduced by this migration.
