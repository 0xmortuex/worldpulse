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
