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

---

## Neither of P3's two named fixtures exists in the code

**Found while implementing P3 (commit 5 of the Fact-model migration), 2026-08-15.** The plan
named two cases that would prove the rule: a relations score with a `nodata` input, and San
Marino's six-versus-two discrepancy — "both currently confident, both caveated after".
Neither holds against the code, and in opposite ways.

**The relations shortfall cannot occur.** `ScoredInput.weight` is typed `number`, never
`null`. A finding that is absent is simply not in `result.inputs` — there is no representation
for an input that was consulted and came back empty. So a relations input can never reach
`nodata`, and the contributing-shortfall caveat wired into `scoreFact` has **no reachable
instance in production code**.

**San Marino was never confident.** Its six-vs-two case is handled by the multi-holder guard
in `resolve.ts`, which returns `class: 'undetermined'` with a rule label, a reason naming the
ambiguity, and a warning that an override with a citation is needed. It is a leader-resolution
refusal, not a derivation at all — no `DerivedProvenance` is involved, so P3 has no bearing on
it. It already declines to choose, which is the behaviour the fixture wanted to produce.

**So the plan's premise inverted itself in both directions**: relations scores are confident
but cannot carry a shortfall, and San Marino carries a shortfall but was never confident.

**What was done instead of manufacturing them.** The rule is implemented and planted
(`tests/p3-propagation.test.ts`, twelve cases covering requiredness, the merged ladder and the
shortfall counter), and the browser assertion attaches to the case that *is* reachable — a
derivation whose **required** input came back empty, rendered in the component gallery and
asserted with a positive control that an ordinary derivation still shows its value.

**The contributing path stays, unexercised and recorded.** Removing it would mean deleting a
specified rule because today's data cannot reach it; keeping it silent would mean shipping
untestable code. It is kept with planted cases and listed in `UNEXERCISED-PATHS.md`, on the
same terms as every other proven-but-unrendered path in this repo.

**The general point, which is why this is a finding and not a note.** A fixture named in a
plan is a hypothesis about the code, not a fact about it. Both of these had been asserted
across several sessions — including by me, when I wrote the migration plan — without anyone
checking whether the type system permitted them. `ScoredInput.weight: number` settles the
first in one line, and it was there the whole time.

---

## "Hardware GL" was SwiftShader measuring itself — the real GPU is 46× faster

**Found 2026-08-15, because a reviewer refused to accept a 2% difference as plausible.**

`WORLDPULSE_HARDWARE_GL=1` only *removes* the swiftshader launch flags. Headless Chromium
then falls back to SwiftShader anyway, so **every measurement this project has recorded as
"hardware GL" was software rendering**, compared against software rendering. That is why the
medians came out 733ms versus 750ms: they were the same renderer twice.

Renderer strings, via `WEBGL_debug_renderer_info`:

| Launch args | Renderer that actually engaged |
| --- | --- |
| `--use-gl=angle --use-angle=swiftshader` | SwiftShader |
| *(none — what the harness called "hardware GL")* | **SwiftShader** |
| `--ignore-gpu-blocklist` | **SwiftShader** — not a blocklist problem |
| `--use-gl=angle --use-angle=d3d11` | **Intel UHD Graphics, Direct3D11** |
| `--use-gl=angle --use-angle=gl` | **Intel UHD Graphics, OpenGL 4.5** |

The GPU was never blocked. Headless Chromium simply needs an explicit ANGLE backend.

**The app's frame profile, globe idle with the US selected:**

| Configuration | median | p95 | max | fps |
| --- | --- | --- | --- | --- |
| swiftshader | 766.6ms | 1533.3ms | 2149.9ms | **1.3** |
| angle d3d11 | 16.7ms | 33.3ms | 33.4ms | **59.9** |
| **angle gl** | **16.7ms** | **16.8ms** | **16.8ms** | **59.9** |

**A 46× difference in median, and `angle gl` is flat**: p95 equal to median, so the long-tail
frames that made every frame-based wait marginal simply do not occur.

### What this invalidates

- **`TESTING.md` §15's second-configuration table.** Its "hardware GL" row is SwiftShader. The
  conclusion that hardware GL "is not roughly twice as fast" was comparing software to
  software; the real answer is 46×, in the direction the tool's own comment originally claimed.
- **"This machine is slower than the sandbox."** 750ms/frame is what this machine does *under
  SwiftShader*. It renders the globe at 60fps. The comparison was between two software
  rasterisers on different CPUs, which says nothing about the hardware.
- **Every flake rate measured to date** — L9's 20%/50%/30%, the click-actionability class — was
  measured at 1.3fps. Rule 20a: those numbers belong to a configuration nobody needs to use.
- **Every frame budget.** `waitForStableNode` and `waitForDomQuiet` use `maxFrames: 24`, sized
  when a frame cost 750ms. At 16.7ms that budget is 0.4 seconds.

### The instrument mislabelling itself

This is the sharpest instance yet of the class rule 35 was written for. The configuration was
*named* "hardware GL" in an environment variable, a code comment, a decision log and a
`TESTING.md` table — and the name was the only thing making it hardware. Nothing measured what
renderer was in the process, so four sessions of numbers accumulated under a label that was
false from the first commit.

**A configuration must be identified by what it reports, not by the flag that requested it.**
The renderer string costs one `getParameter` call and would have caught this immediately.

### Closure: the reverted fix was right, the revert was right, and the condition was named

The `pickEvent` two-round-trip fix in this file was written, measured green, and **reverted on
purpose** four sessions ago. It has now landed unchanged. The sequence is worth keeping intact,
because it is the disposal discipline working end to end rather than an argument for either
side of it:

| Step | What happened |
| --- | --- |
| **Fix written** | presence and identity read in one evaluation; three step-7 failures went green |
| **Reverted** | rule 15 recorded that the `.evt`-exists wait was *vacuous* — the previous hover's tooltip satisfied it instantly — so a fix that removed failures without removing that vacuity was rule 34's forbidden shape, and it had been measured on an 11-commit-stale tree at a frame rate that no longer applied |
| **Condition named** | this entry: "fix the vacuity first, then measure the read race separately, under a stated configuration" |
| **Condition met** | the GPU clears the stale tooltip, so the guard became real for the first time |
| **Fix landed** | hover-missed 22-of-30 → **0-of-30**, measured under a renderer that reports itself |

**The argument this settles:** writing down *why* something was reverted, not merely that it
was, is what made this recoverable. A revert recorded as "didn't work" would have buried a
correct fix for good. A revert recorded with its unmet condition turned into a specification
that something else later satisfied — and the fix landed without anyone re-deriving it.

---

## The 46× deleted the parallel-worker work item

**Measured 2026-08-15, immediately after the GPU became the default.** Worker count for a
parallel mutation harness was to be sized from this machine's cores. The arithmetic was redone
first, and it removed the reason for the work.

| | SwiftShader | GPU (angle gl) |
| --- | --- | --- |
| Full `npm run verify` | **~1050–1250s** | **103s** |
| One mutation (build + verify) | ~330–510s | **~115s** |
| Full 11-mutation suite | **~65 min** | **~21 min** |

**A ten-fold speedup on the thing parallelism was meant to accelerate.** Two workers on a
2-physical-core machine could save perhaps ten minutes off twenty-one, and would cost: a
worktree per worker, port allocation, a run-lock that admits N workers of one run while still
refusing a second run, per-worker duration accounting, and a contention measurement to know
whether any of it helped. On 3.79GB of RAM with one worker's browser tree measured at ~408MB,
two workers is also near the memory ceiling.

**So it is not built.** The complexity was justified by a 65-minute run; it is not justified by
a 21-minute one, and the run discipline in S4 — full suite only before a push or a goal close —
already covers the remaining cost.

**Recorded because the reasoning matters more than the conclusion.** The item was not dropped
because it was hard; it was dropped because the measurement that was supposed to *size* it
showed there was nothing left to size. Doing the arithmetic before the build is what turned a
week of plausible work into a paragraph.

---

## A disclosure mechanism whose only caller cannot trigger it

**Found 2026-08-15**, re-deriving a claim from the tree rather than from my own earlier note,
after a check insisted two named P3 fixtures be shown rendering.

Neither fixture became producible — `ScoredInput.weight` is `number`, and San Marino refuses at
`resolve.ts:209` with `primary: null`, before any Fact exists. That much was already recorded.
What the re-derivation added is the part I had understated:

```
$ grep -rn "required: false" src/ --include=*.ts
src/relations/provenance.ts:65:      required: false,
```

**One site. The other two derived inputs are `required: true`.** So no fact in the shipped app
can satisfy `contributingShortfall`, and both the caveat in `provenance.ts` and the shortfall
block in `inspector.ts:220` are **unreachable in production**. Commit 5 shipped a disclosure
that nothing can reach — correct, unit-tested twelve ways, and dead.

**The finding is about how it looked green.** Twelve planted tests pass, typecheck passes, the
browser assertion for P3 passes. Every one of those is honest about what it covers, and none of
them can see that the covered branch has no live caller. A test proves a function works; only
counting the construction sites proves anything calls it.

**What was wrong with the browser evidence, separately.** The gallery's P3 entry covered the
*required*-input case, where the value is suppressed. An app that rendered every derivation as
"no data" would pass that assertion. The distinguishing case — a value that SURVIVES with a
caveat — had no browser demonstration at all, only unit tests. It has one now, asserted against
its opposite so neither can pass alone.

**A guard caught the first attempt at the demonstration.** It invented three citation hosts
(`nato.int`, `treaties.un.org`, `sipri.org`) to look like a relations score;
`registry-coverage.test.ts` failed it for hosts in `src/` that resolve through no registered
source. That guard was right and the entry was rebuilt over a source the app knows. Worth
recording because the fixture was being written *to demonstrate honesty about data*, and it
still needed a check to stop it inventing sources.

---

## Rule 36's assertion count is not deterministic, because a dropped click changes control flow

**Measured 2026-08-15**, comparing migration commit 4 (`540f5c7`, P3 mechanical) against commit
3 (`f5ce92e`) as the goal required. Both re-run from worktrees under each commit's OWN harness —
they predate the GPU default, so both ran SwiftShader, the configuration they were written
under.

| Step | commit 3 | commit 4 |
| --- | --- | --- |
| 1–6, layout (rule 8) | 17, 19, 23, 24, 20, 17, 80 | **identical** |
| 7 — globe event layers | **34** / 31 / 3 | **33** / 32 / 1 |
| 7b — economy fetch states | **12** / 11 / 1 | **11** / 11 / 0 |
| text fidelity (rule 9) | **36** / 35 / 1 | **35** / 35 / 0 |
| total | **282**, 5 failed | **279**, 1 failed |

**The failure-set half of rule 36 passes.** Every failure on both sides is the documented L9
click-drop class — dropped clicks and their downstream consequences. The difference excluding
documented flakes is empty.

**The assertion-identity half fails, and the reason is the finding.** The three steps that
differ are exactly the three where a click flake fired, and each differs by precisely the number
of flakes in it. A dropped click changes what the harness does next, so **it changes how many
assertions run.** The count is not a stable property of the commit under a flaky configuration.

**Rule 36 assumed the count was deterministic and only pass/fail moved.** That assumption held
while it was written — on a machine where the flake happened to leave counts alone — and it does
not hold here. A criterion that cannot distinguish "the refactor changed behaviour" from "a
click was dropped" is not usable as stated.

**Deliberately unresolved as of this entry.** The decisive experiment is commit 3 against
ITSELF: if a second run of the same commit yields a different count, the count is flake-driven
and the comparison resolves in the refactor's favour. If commit 3 reproduces 282/5 exactly, the
difference tracks the commit and is a real diff to stop on. Running; disposition in
`OPEN-QUESTIONS.md` 16.

**What is deterministic, and worth stating beside it:** commits 3 and 4 produce identical unit
results — 571 tests, 119 suites, both green. Whatever the browser count does, the two commits
agree everywhere the measurement is stable.

---

## Two reporting rules, both earned the same afternoon

### A results table may contain only what the measurement produced

A key-inventory table reported `OPENSANCTIONS_KEY` as "empty by choice". The check that produced
the table read **names only** — it discarded everything after the `=` — so it had measured no
value at all. The phrase came from the request that asked for the table, and acquired measured
status by sitting in a column beside measured things. The key was in fact filled.

**This is not the stale-data class.** Stale data is a wrong answer to a question that was asked;
this was an answer to a question never asked at all. The `.env` file was current and correctly
parsed for what it was asked.

**The rule:** anything inherited from the request is measured before it is printed, or is marked
as the requester's claim. It needs to be a rule rather than vigilance because the unmeasured
claim came from the reviewer — the class catches whoever is trusted most, which is exactly the
input least likely to be checked.

**Second instance, same day, worse:** a report stated a background run had been launched when no
such run existed — no worktree created, no process started. Same class, self-inflicted: an
assertion about an action, printed without the action. Caught by a checker asking where the
result was.

### A wrapper reports the wrapper; only the process reports the process

Three background runs were reported **killed** while both their shells and their
`verify-render.mjs` children kept running. One shell reached its second loop iteration and
checked out a different commit in the MAIN repository; one child held the harness run lock for
25 minutes and refused the two runs that followed it.

The lock behaved perfectly — it refused a second measuring run and named its holder by pid and
age. The `0 assertions, 10 skipped` table it produced was the honest output of a refused run,
not a broken one.

**Second instance of a misdiagnosis this project already recorded, in the opposite direction.**
The earlier one read a live detached process as dead; this one read dead wrapper statuses as
covering dead processes. Both are the same mistake: treating the wrapper's summary as evidence
about the process.

**The rule:** a run records its own pid and its own done marker, and those are what get
believed. Process inspection, not wrapper status, answers "is it still going".

---

## Four sources have claimed "live" without live coverage, and the gate has been saying so

**Found 2026-08-15** while taking Ember to `verifiedAgainst: live`. The deploy gate refused, and
naming Ember was the least of what it said:

```
[ BLOCK] portwatch-chokepoints  LIVE WITHOUT COVERAGE — no contract test names it
[ BLOCK] who-don                LIVE WITHOUT COVERAGE — no contract test names it
[ BLOCK] unhcr-population       LIVE WITHOUT COVERAGE — no contract test names it
[ BLOCK] cisa-kev               LIVE WITHOUT COVERAGE — no contract test names it
```

**My first hypothesis was that the guard was looking in the wrong place** — it scans only
`tests/contracts.test.ts`, while these four have their own per-source test files. That would
have made it a bookkeeping failure and the fix a wider glob.

**It is not.** `liveOrInconclusive` appears in exactly one test file and names seven sources,
none of them these four. Their per-source tests read the COMMITTED FIXTURE and never fetch. So
each of them asserts `verifiedAgainst: "live"` — "confirmed against a live response" — while
nothing re-confirms it, and a schema drift upstream would be invisible until a panel rendered
wrong.

**The guard is right and has been right since they were flipped.** Deployment is blocked, which
is the gate working exactly as designed: nothing ships while a source claims more than its
evidence supports.

**Recorded, not fixed, and not reprioritised.** Giving four sources live contract checks is its
own piece of work; folding it into an Ember commit would bury four decisions inside one. Ember
is not made a fifth instance — it got a real live contract check in `contracts.test.ts` before
its flag was flipped.

**What the fix needs, beyond adding calls:** `who-don` and `cisa-kev` are keyless and
straightforward. `portwatch-chokepoints` and `unhcr-population` need the same treatment Ember
just got if their fixture URLs are parameterised, and `unhcr-population`'s fixture is a
500-row page whose live equivalent is large. None of that is hard; all of it is decisions.

---

## A key-gated source needed the key in three places, and the third was a leak

Ember is the first key-gated source with a live contract test, which surfaced that
`loadSample` fetches `fixture.requestUrl` directly. For Ember that URL deliberately carries no
key — the builder omits it because the key is a query parameter and would otherwise ship in the
bundle — so the live fetch would have received `403 {"detail":"No API key set"}` and reported a
contract failure that was really an authentication failure.

`loadSample` now applies the key through the same pure function the prober uses, so one place
knows how a key reaches a request. A missing key is **INCONCLUSIVE**, never a contract failure:
"could we ask" is a different question from "has the shape drifted", and conflating them is how
`verifiedAgainst: live` decays into "passed because nothing ran".

**The leak was in the return value, not the fetch.** The first version recorded the keyed URL in
`ctx.requestUrl` — which flows into `FetchProvenance` and is RENDERED IN THE INSPECTOR. A secret
would have been put on screen by the subsystem whose entire job is showing where a number came
from. The keyed URL now exists only for the duration of the fetch call; `ctx` keeps the unkeyed
form.

Worth recording because the two guards that were written first — refuse if the builder emits a
key, refuse if the response echoes one — both passed. They guarded the request and the response
and had nothing to say about what was written down afterwards.

---

## A secret has three lifecycles, and a guard is needed for each

**2026-08-15.** Ember was the first key-gated source to go through the full gate, and the key
nearly escaped once per lifecycle. Each time, the guards that existed passed.

| Lifecycle | Where it nearly went | Guard |
| --- | --- | --- |
| **SENT** | the app's URL builder emitting a key into a browser-built URL | builder emits none; the capture script refuses if it does |
| **RECEIVED** | a response or error body echoing the key back | `redactKeys`, over every registered key rather than only the one in use |
| **RECORDED** | `ctx.requestUrl` → `FetchProvenance` → **the inspector** | `secretsIn`, added here |

**The third is the one that actually happened.** `loadSample` recorded the KEYED url in
`ctx.requestUrl`, which flows into `FetchProvenance` and is rendered by the provenance
inspector — the subsystem whose entire job is showing where a number came from would have shown
the key. The first two guards passed throughout, correctly: **they watched the wire, and neither
watched the ledger.**

`secretsIn` walks any structure by containment rather than equality, because the leak was a key
EMBEDDED IN A URL, not a key stored on its own. It reads its list of secrets from the registry
so a source added tomorrow is covered without anyone extending a list, and it refuses to treat
an empty variable as a secret — an empty string matched by `includes` matches everything, which
would report every field on every run and get the guard switched off within a day.

**The guard was vacuous when first written, and said so.** `npm test` did not load `.env`, so
the scan printed "no keys configured, nothing to look for" and passed. Honest, and useless: a
guard that cannot fire on the machine where the secrets live is not a guard. The runner now
loads `.env` with `--env-file-if-exists`, and the scan runs against real values.

**The planted case is the bug itself**, reconstructed: a keyed URL written into a `FetchContext`
and carried into a real `FetchProvenance`.

---

## A 200 is not success, and I wrote a detector that assumed it was

**2026-08-15**, sweeping the key-gated sources for their authentication mechanisms. The sweep
tried each candidate and scored acceptance on `response.ok`.

`exchangerate.host` returns **HTTP 200 for errors**. Unauthenticated it answers
`{success, error}`; with `?access_key=` it answers `{success, terms, privacy, timestamp,
source}`. Same status, different shape. My detector concluded NO MECHANISM ACCEPTED for a source
whose mechanism was working in front of it, and would have concluded the same for any API that
reports failure in the body.

**This project already knows this rule.** `probe-verdict.mjs` refuses to infer a verdict from a
non-`ok` response for the mirror-image reason, and the fetch layer distinguishes states rather
than trusting status codes. I wrote a throwaway script and reached for `res.ok` anyway, because
it was a scratch tool — which is exactly where the assumption survives, since a scratch tool's
output gets read as a measurement.

The shape difference is what caught it, and only because the sweep printed shapes beside
statuses. Had it printed the verdict alone, `exchangerate-host` would have been recorded as
having no usable mechanism.

---

## A probe status of 200 is not evidence the key worked

**2026-08-15.** Re-probing the conversion queue with keys applied, the table reads well:
`congress-gov` 403 → **200**, `eia` 403 → **200**. Both are real: those APIs refuse
unauthenticated requests and answer authenticated ones.

**`exchangerate-host` also reads 200 — and read 200 before the key existed.** It returns HTTP
200 for errors, so the probe's status column cannot distinguish a working key from a missing one
for this source. Its row is not evidence about authentication in either direction.

**The verdict is unaffected**, because `KEY-GATED` is a transport decision — a secret key beats a
permissive ACAO — and is a property of the source rather than of the response. But anyone
reading the probe table to answer "did the key work" will be right for five sources and wrong
for this one, and nothing in the table says which.

**Recorded rather than fixed**, because the fix is an adapter-level judgement: only something
that knows the response shape can tell success from an error envelope, and the prober
deliberately knows nothing about shapes. It is written into the source's registry notes so the
adapter author meets it before they meet the bug.

---

## congress.gov ignores an invalid sort and answers 200

**Measured 2026-08-15** while taking congress.gov through the gate. The default `/v3/bill`
endpoint is not what a "latest activity" panel wants, and finding that out was the easy half.

| Request | What came back |
| --- | --- |
| `/v3/bill` (no sort) | 110th Congress — **bills from 2007**, out of 429,656 |
| `sort=updateDate+desc` | 119th Congress, updated the same day |
| `sort=updateDate+asc` | 105th Congress, oldest first |
| **`sort=bogus`** | **HTTP 200, arbitrary order, no error anywhere** |

**An invalid sort is ignored rather than rejected.** So a typo in that parameter produces a
successful response full of real bills in no useful order, and a panel headed "latest activity"
renders decade-old legislation while every check reports fine.

**There is a second way to reach the same failure, and it is worse because it looks correct.**
The sort value contains a `+` that the API reads as a space. `URLSearchParams` percent-encodes
it to `%2B`, which makes the sort invalid — which the API then ignores. **Correct encoding and
broken encoding are indistinguishable from the response**, so the builder constructs that
parameter by hand and a test asserts `%2B` never appears.

**The adapter checks the ordering it asked for rather than trusting the request was honoured**,
and throws when it is violated. It deliberately does NOT re-sort locally: sorting would hide the
ignored parameter, and the next symptom would be a pagination bug, because page 2 of an
unsorted result set is not the continuation of page 1. A locally-sorted page 1 would look
perfect while the sequence beneath it meant nothing.

**Third instance today of the same shape** — exchangerate.host returning 200 for errors,
`res.ok` in my own auth sweep, and now this. The pattern is not "APIs lie"; it is that **a
status code answers a question about transport, and every question worth asking here is about
content.**

---

## A 403 that was never the API: ten auth mechanisms tested against a bot challenge

**Measured 2026-08-15.** `theyvoteforyou` refused ten candidate authentication mechanisms —
five query parameter names, four header schemes, and unauthenticated — every one a 403 with an
HTML body. Recorded as `OPEN-QUESTIONS` 19 with two competing explanations: wrong mechanism, or
invalid key.

**Both were wrong. So was the third hypothesis.**

A reviewer noticed the key contains a literal `/` and proposed that `URLSearchParams` was
percent-encoding it to `%2F` — the congress.gov `%2B` trap in mirror image, where correct
encoding corrupts a valid value. A good hypothesis, and testable: send the documented `?key=`
parameter both percent-encoded and with the slash hand-built into the URL.

Both forms returned 403. **So did the keyless control** — and that is the fact that had been
sitting in every one of the eleven measurements, unread.

```
server: cloudflare
<title>Just a moment...</title>
```

**It is Cloudflare's JS challenge interstitial.** Identical for a custom User-Agent, a
browser-like one, curl, and no User-Agent at all. **None of the ten mechanisms ever reached the
application. The key has never been evaluated.**

**This is rule 37 catching its author.** I wrote that rule this morning — a status code answers
a question about transport, and every question worth asking is about content — and then read
eleven 403s as an answer about authentication. The body said `Just a moment...` every time. The
rule was in the repository before the mistake was finished.

### The verdict ladder makes this invisible for key-required sources

`verdictForResponse` checks `source.keyRequired` **first** and returns `KEY-GATED` regardless
of what came back, because a secret key beats a permissive ACAO — correct reasoning for the
transport question it is answering. But it means a key-required source that is **completely
unreachable** records as `KEY-GATED`, exactly like six healthy sources, and its unreachability
never appears.

`theyvoteforyou`'s probe row reads `403 KEY-GATED` — which parses as "needs a key, obviously",
and is really "blocked at the edge, key irrelevant". A source that cannot be fetched at all is
a different problem from a source that needs a credential, and the table cannot currently say
which.

**Not fixed here.** The fix is a decision about the ladder: either `UNREACHABLE` should be
evaluated before `KEY-GATED`, or the record should carry both. Both change how every key-gated
row reads, which is not a change to make while reporting a different finding.

### What it means for the source

`theyvoteforyou` cannot be fetched from a server without solving a JS challenge, so it cannot
be converted. **Parked with the correct reason**, which is materially different from the one
recorded an hour ago: not a credential problem, an access problem.

One thing NOT established, and worth testing before the source is written off: a Cloudflare
Worker fetching a Cloudflare-fronted origin may not receive the same challenge. That is a
question about where the fetch runs, and this app already routes this source through the
Worker.
