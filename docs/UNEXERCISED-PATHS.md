# Unexercised paths — enumeration

Code paths, categories, branches and states that may never have run against real data.

**The list is the deliverable, not the gaps in it.** The shipped-but-unvalidated sources
were found by enumerating everything and reading the result, not by anything failing —
so rows are reported here even where they look fine, because a row that looks fine and a
row nobody checked are indistinguishable until someone writes both down.

Generated 2026-08-12 by `scripts/`-adjacent scanning plus manual verification. Where a
row says "unverified", that is a statement about our knowledge, not about the code.

---

## 1. Globe layers — declared versus exercised

| Layer | Declared | Exercised by in-app fixtures | Seen in live data |
| --- | --- | --- | --- |
| `usgs:earthquakes` | yes | yes | yes |
| `eonet:volcanoes` | yes | yes | yes (5 on request) |
| `eonet:wildfires` | yes | yes | yes (191 of 200) |
| `eonet:severe-storms` | yes | yes | yes (3 of 200) |
| `eonet:floods` | yes | **yes — added by this sweep** | yes (6 of 200) |

`eonet:floods` was registered under decision L12 and had **no fixture event**, so its
category mapping, marker, tooltip, click and provenance had never run in the app. Found
by this enumeration within minutes of being introduced — the same class as the three
shipped-but-unvalidated sources, created and caught in the same session. A fixture event
now exercises it.

### EONET categories deliberately unregistered

Nine, each with a recorded reason under L12a. These are **not** unexercised paths — they
are phenomena we have decided a point marker misrepresents. `unregisteredLayers()`
surfaces them in the rail rather than dropping them.

---

## 2. Fact states

| State | Referenced in `src/` | Rendered in the app by a fixture |
| --- | --- | --- |
| `ok` | 6 | yes — every populated panel |
| `nodata` | 11 | yes — gallery and economy no-data cards |
| `broken` | 9 | yes — gallery untraceable case |
| `unconfigured` | 11 | yes — gallery key-gated case |

All four render in the component gallery, which is why the gallery exists: a branch that
never renders in the running app is a branch nobody has looked at.

---

## 3. Provenance kinds

| Kind | Constructed in `src/` | Notes |
| --- | --- | --- |
| `fetch` | 10 | the ordinary path |
| `derived` | 4 | relations score, EONET centroid, tone |
| `seed` | 2 | relations seed data |
| `unconfigured` | 2 | key-gated sources |
| `fixture` | **0** | **not a provenance kind — fixture-ness is a flag on `FetchContext`** |

The `fixture` row is a false alarm from the scan, recorded rather than deleted: it is
`fromFixture` on the context, not a provenance kind. Left visible so the next person
running this scan does not re-investigate it (rule 23's disposal rule).

---

## 4. Position kinds

| Kind | Exercised |
| --- | --- |
| `measured` | yes — USGS points and EONET Point geometries |
| `derived-centroid` | yes — EONET Polygon geometries, 6 present in live data and 2 in the captured fixture |

---

## 5. Source adapters

Ten modules. Coverage after this session's conversions:

| Adapter | Contract test | Live |
| --- | --- | --- |
| `worldbank.ts` | yes | yes |
| `usgs.ts` | yes | yes |
| `eonet.ts` | yes | yes |
| `wikipedia.ts` | yes | yes |
| `wikidata.ts` | yes | no — awaiting three consecutive clean runs |
| `wikidata-dossier.ts` | **yes** — `tests/wikidata-queries.test.ts` | no |
| `wikidata-government.ts` | **partial** — cabinet, judiciary, timeline, person-history covered; **legislature has none** | no |
| `gdelt.ts` | yes | **no — source unusable** |
| `gdelt-tone.ts` | **no** | **no — source unusable** |
| `adapter.ts` | n/a — shared helpers | n/a |

**Closed for five of the six queries.** `tests/wikidata-queries.test.ts` now covers the
dossier, cabinet, judiciary, leadership-timeline and person-history builders against live
captures from real countries.

**`buildLegislatureQuery` remains uncovered, and not for want of trying.** It does not
complete against live Wikidata for any country tested — 504 for the UK, 500 after 60.6s
for Iceland, 504 after 65.5s for Vatican City, all at WDQS's ~60s server timeout. There is
no real capture to write a contract against, and hand-writing one would be a prediction
about a response nobody has seen. See `FOUND.md`.

---

## 6. Known-unexercised, by explicit decision

Recorded so they are not mistaken for oversights:

| Path | Why |
| --- | --- |
| Nine EONET categories | L12a — a point marker misrepresents the phenomenon |
| GDELT tone timeline | source unusable; the panel is to be removed, not approximated |
| Rule-6 collective leadership | O2 — not built until live data confirms the shape |
| P3 missing-data propagation | modelling gap, recorded, lands with step 12 |
| Equipment inventories | decision 2 — no licensable source exists |

---

## 7. What this sweep could not see

Stated so the enumeration is not mistaken for complete:

- **Branches inside adapters.** This counts modules and states, not every `if`. A parser
  branch that has never taken its else path would not appear here.
- **Responsive breakpoints.** Rule 8 asserts three; whether every panel has been rendered
  at each is not enumerated.
- **Error paths in the browser harness.** The skip machinery is exercised, but not every
  guarded branch.
- **Anything keyed on a string the scan did not know to look for** — the same limitation
  that made the source-coverage grid a lower bound.

---

## 8. The fetch layer — the largest unexercised path, and this sweep did not catch it

**There is not a single runtime `fetch` anywhere in `src/`.** Every panel in the
application renders hand-authored fixtures. Verified by search, not assumed:

```
grep -rn "await fetch(\|fetch(" src/ --include=*.ts   →   no results outside src/dev
```

This is not dishonest — the SEED banner is up, every fixture-backed fact carries
`fromFixture: true`, and the inspector renders *"Served from a hand-authored fixture, not a
captured response."* But it reframes what the rest of this document, and the deploy gate,
actually mean.

### Why the sweep missed it

Sections 1–7 look for unexercised **branches inside code that runs**. This is a whole
**layer that does not exist**, and an enumeration of what exists cannot find what was never
written. Section 7 stated the sweep's limits and did not include this one — the honest
conclusion is that "what could this sweep not see" is itself a question that needs
enumerating, not just answering once.

### What `verifiedAgainst: "live"` actually means

**It means a contract test fetched the source and its shape matched.** It does *not* mean
the application has ever fetched anything. Five sources marked `live` and seven clearing
the gate describe **the test suite**, not the app.

That label will mislead someone, and the most likely someone is us. It is recorded here
rather than renamed unilaterally, because the gate's semantics are a decision.

### What exists

| Piece | State |
| --- | --- |
| Response **parsing** per source | built and tested — `expectObject`, `expectArray`, `expectInRange`, `ShapeError` |
| **Provenance** capture (`FetchContext`, `fetchProvenance`) | built; every fixture supplies one by hand |
| **URL construction** | built and now exported per source, used by fixtures |
| Contract tests against live sources | built, 5 sources |
| `ttlMs` in the registry | **declared, never read** — no code consumes it |
| `cache` on `FetchContext` | a *field* every fixture sets to `'miss'`; no cache exists |

### What does not exist

- **Any runtime request.** No fetch call, no request wrapper, no per-source client.
- **Error handling at runtime.** `ShapeError` is thrown by parsers under test; nothing
  catches it in a rendering path, because no rendering path fetches.
- **Retries, backoff, request queueing, per-source concurrency limits** — features 38 in
  the Phase 0 list. None present.
- **Caching or IndexedDB.** `ttlMs` is registry metadata nothing reads; `cache: 'miss'` is
  a literal in fixtures.
- **The Worker proxy.** Needed by 4 sources per the CORS verdicts. Not started.
- **Loading and degraded states.** Every panel renders synchronously from an import, so
  there is no pending state, no partial state, and no error state in the UI — for any
  panel.

### What one panel rendering live data end-to-end would require

Stated as a gap, not a plan:

1. A request wrapper that fetches, times out, and returns a real `FetchContext` — status,
   fetch time, cache state — rather than a hand-written one.
2. Somewhere for the response to be parsed by the existing adapter and for `ShapeError` to
   be *caught*, mapping to the panel's degraded state rather than an exception.
3. Three UI states per panel that today has one: loading, loaded, failed. Rule 8 and rule 9
   apply to each, and none has ever been laid out.
4. A cache honouring `ttlMs`, or a decision that the first version has none — either is
   fine, but silently having none while the registry declares TTLs is the gap that
   matters.
5. For the four WORKER-REQUIRED sources, the proxy, before they can be fetched at all.

**None of this contradicts the contract tests.** They prove the real sources match the
shapes the fixtures predict. They do not prove the app can consume them, because nothing
in the app has ever tried.

## 9. Guards that cannot be called directly — the rule 32 audit

Standing audit. Every guard, gate, scanner and harness in the repository, scored on whether
its decision logic can be invoked with a synthetic input.

### Passing — logic is a pure function with planted cases

| Guard | Module | Cases |
| --- | --- | --- |
| Deploy gate verdict | `scripts/deploy-gate-rules.mjs` | 13 |
| Unexercised-path check | `scripts/unexercised-check.mjs` | in `gate-rules.test.ts` |
| Mutation classifier | `scripts/mutation-verdict.mjs` | 8 |
| Chromium resolution | `scripts/chromium-path.mjs` | 7 |
| Source-scanning guards | `tests/guards.ts` | planted, incl. two regression cases |
| Registry validator | `parseRegistry` in `src/facts/registry.ts` | planted |

### FAILING — logic is unreachable except by running the thing

*(Item 1 below has since been fixed; kept in place with its record, because the defect history is the reason the rule exists.)*

**1. `scripts/probe-sources.mjs` — the CORS verdict ladder. FIXED 2026-08-12.**

Extracted to `scripts/probe-verdict.mjs` as `verdictForResponse({status, ok, cors, origin,
source})`. The probe keeps the I/O and none of the deciding. 14 planted cases, including all
three historical defects as permanent regression tests, plus a replay of all 32 recorded
observations in `data/probe-results.json` — 30 of 30 decidable rows reproduce their recorded
verdict, the other 2 being transport failures decided before the ladder runs.

Fixed first because it is the fetch layer's routing input: `CORS-VERDICT.md` decides which
sources the browser may call directly and which must go through the Worker, and that table
could not be trusted while the logic producing it was unreachable.

**2. `scripts/extract-ucdp.mjs` — the RFC 4180 parser. FIXED.** `makeCsvParser` is exported with planted cases, including the chunk-boundary case that reproduces the 14-record loss in two lines. The deeper finding recorded with the fix: the parser was unreachable not because it was unexported but because importing the module ran `main()` and cost 129 MB.

`makeCsvParser` and `slimEvent` are module-private; nothing imports them and no test
references the file. The parser has had **two** defects, both found by cross-checking output
against Python's `csv` module:

- a line-based reader dropped 102,409 of 487,358 rows (21%) on embedded newlines
- a `chunk[i+1]` peek read `undefined` at chunk boundaries, losing 14 records

The second is the exact defect class a synthetic input reproduces trivially — feed the
parser a quoted field split across two chunks — and that a live run hides, because 14
records in 487,358 do not show up in any total anyone eyeballs. The read/kept/dropped
accounting must balance, which is a good invariant, and it balanced while the parser was
losing records, because the loss happened before counting.

*Fix:* export `makeCsvParser`; planted cases for embedded newlines, escaped quotes, quotes
spanning a chunk boundary, and a CRLF terminator.

**3. `scripts/run-tests.mjs` — the "glob matched nothing" guard. FIXED.** Extracted to `test-count.mjs` with planted cases, and it now distinguishes "no count reported" from "reported zero" — a crash before the summary is not a report of zero tests (rule 30).

Inline, low stakes, and worth naming only because it is the guard protecting every other
test from vacuously passing. A malformed glob reports success over zero tests.

*Fix:* extract the count predicate. Small.

### FIXED — rule 8's judgement is now directly callable

`layoutProblems` in `scripts/layout-rules.mjs`, with 10 planted cases.

The measuring genuinely needs a DOM; the deciding never did, and while it sat inline in
`assertLayout` the only way to exercise it was to run the browser suite. Every threshold now
has a case, because every threshold is somewhere a real defect once hid — including the
2px one, where a row with `height: 0` plus 1px of padding each side is *not* zero and passed
as healthy while its text was clipped entirely away.

Both self-tests remain. They prove the predicate can fail on every run; the planted cases
prove it fires on each specific geometry it claims to detect. Those are different claims and
the audit needed both.

### Neither — covered by a permanent live planted case

`scripts/verify-render.mjs`'s geometry predicates run in the browser via `page.evaluate` and
cannot be unit-called without a DOM. They are not unreachable, though: two **self-tests run
on every single run**, deliberately breaking the page and asserting the predicate fires.
That is rule 27 satisfied by a different mechanism.

**The residual gap named here is now closed** — see the section above: the overlap
arithmetic is called with synthetic rectangles, including the two cases that would make the
check useless if it got them wrong (stacked rows and side-by-side columns must NOT report as
overlapping).

What remains in the browser is the measurement itself: `getBoundingClientRect`,
`getComputedStyle`, `scrollHeight`. Those cannot be unit-called and are covered by the
self-tests, which is the right division — a browser is the only thing that knows where a box
actually landed.

## 10. The live fetch path is unexercised in a browser

| Path | Exercised by | NOT exercised by |
| --- | --- | --- |
| registry → compose → transport → adapter → `Fact`, against a real origin | `tests/worldbank-live.test.ts` under `PROBE_LIVE=1`, in **Node** | any browser check |

**Browser egress — measured in two environments, with opposite results.**

| Environment | `fetch('https://api.worldbank.org/…')` from inside the page |
| --- | --- |
| Cloud sandbox, through 2026-08-13 | `TypeError: Failed to fetch`, with and without the proxy |
| Local Windows box, 2026-08-14, `cf62bcd` | **HTTP 200**, 513 bytes of real JSON (`"lastupdated":"2026-07-13"`), 1184ms |

In the sandbox, outbound HTTPS went through an agent proxy the browser was not configured
for; pointing Playwright at it still failed because the proxy's CA was not in Chromium's
trust store, and disabling certificate verification was not available. On the local box
there is no proxy and the fetch simply succeeds. `earthquake.usgs.gov` answers the same way
(200, 9650 bytes of GeoJSON, 1279ms), so this is egress in general rather than one lenient
origin.

**The environmental blocker is lifted. The row above still stands**, because that row names
a *check*, not a capability: no browser check exercises the live path. "Not possible here"
has been replaced by "not written yet", which is progress and is not the same as coverage.

**What this means for the four rendered states.** `loading`, `stale`, `degraded` and
`unavailable` are demonstrated in the browser against **fixtures and a stub**, not against a
real response in a real browser. The assertions are real and the states are really computed
from real row outcomes — but the responses feeding them did not cross a network.

> **This must never be recorded as "live end-to-end in the app".** The app's live path is
> proven in Node. In the environment the app actually runs in — a browser — it is unproven,
> and the honest statement is that the panel is *wired* to live data and *verified* against
> a stub.

**What would close it:** a browser check that drives registry → compose → transport → adapter
against a real origin and asserts on what renders. That is now possible on this machine and
was not before; it is not yet written. Until it exists and passes, this row stays.

**What it is not.** Egress does not make the four states live, and the blockquote above is
unchanged by it. A machine-dependent capability is also not a property of the project: the
same run found `riksdagen` reset at the TCP level from this network while the sandbox
reached it fine, so "the browser can reach live origins" is true of this box on this day,
which is exactly the claim rule 20a says to record with its configuration.

Note that even with egress the scenario mechanism would remain necessary: the four states
are each reachable only through a specific remote failure, and demonstrating them against a
live origin means waiting for it to break.

## 11. PortWatch's adapter is proven; its rendering path does not exist

| Path | Exercised by | NOT exercised by |
| --- | --- | --- |
| registry → request → parse → `Fact`, for `portwatch-chokepoints` | `tests/portwatch-contract.test.ts` against a **real captured fixture**, and the fixture manifest, which builds its URL from `buildChokepointQueryUrl` | any browser check — **nothing renders it** |

**This is deliberate, not an omission.** PortWatch replaces the AIS-based Hormuz monitor in
`SPEC-WARWATCH.md`, which schedules that monitor **last** of its eight items "because its
disclosure requirements are the strictest and it must not be built under time pressure".
Building an interim surface to satisfy the gate would rush exactly that. Recorded in
`DECISIONS.md` as P1/P2.

**What is therefore unproven.** The tier split reaches no badge; the `metric tons` unit
reaches no rendered value; and **the AIS caveat reaches no reader**. The caveat is the one
that matters most, because a figure rendered without it is a claim we did not intend to make
— so its browser assertion is written into SPEC-WARWATCH's item-8 requirements rather than
left to be remembered.

**What would close it:** the item-8 panel, with the assertions listed in that spec. Until
then this row stays, on the same terms as §10: the environmental blocker is gone and the
check is simply not written.

> The distinction §10 draws applies here too. `verifiedAgainst: "live"` says the **data
> path** is proven. It does not say a user can see any of it, and it must never be read that
> way.

## 12. WHO DON and UNHCR adapters are proven; nothing renders them

| Path | Exercised by | NOT exercised by |
| --- | --- | --- |
| registry → request → parse → `Fact`, for `who-don` | `tests/who-don-contract.test.ts` + the fixture manifest | any browser check |
| registry → request → parse → `Fact`, for `unhcr-population` | `tests/unhcr-contract.test.ts` + the fixture manifest | any browser check |

Same terms as §11 (PortWatch). Both were specced into **Risk & Stability**, which is step 10
work and does not exist, so there is no surface to render into and none was invented
(`DECISIONS.md` P4/P5).

**What is therefore unproven.** For WHO DON: that headlines render as WHO's wording with a
link back. For UNHCR: **that a reported zero and an absence look different to a reader.** The
second is the one that matters — the distinction is enforced in the fact layer and asserted in
tests, but no human has yet seen `0` and *no data* side by side on a screen, and rule 8's
whole argument is that passing assertions are not the same as a working panel.

**What would close it:** the step-10 Risk & Stability panel, with a browser assertion that a
counted zero and a no-data field render distinguishably.

### 12a. CISA KEV, on the same terms

`cisa-kev` joins §12: registry → request → parse → `Fact` is exercised by
`tests/cisa-kev-contract.test.ts` and the fixture manifest; **no browser check renders it**,
because its cyber row in Risk & Stability is step 10 work that does not exist
(`DECISIONS.md` P6).

**What is therefore unproven:** that `Unknown` renders visibly differently from `Known`. The
three-state is enforced in the adapter and asserted in tests, and its caveat travels on the
fact — but no reader has yet seen the two side by side, and a panel that renders `Unknown` as
a bare dash or an empty cell would undo the whole point at the last step.

## 13. B4's resolution row renders nothing, because no fact declares a resolution yet

| Path | Exercised by | NOT exercised by |
| --- | --- | --- |
| `resolutionClaim` — all four states including undeclared | `tests/resolution.test.ts`, planted | — |
| The inspector's **Resolution** row | nothing | any browser check, because no fact sets `resolution` |

**This is commit 1 of the batched migration being honestly additive.** The field, the claim
function and its fail-closed default all exist and are planted; the row that renders them is
reachable only once a source declares a resolution, which no source does yet. Asserting it in
the browser today would mean constructing a fact purely to prove the assertion can pass —
which proves the assertion, not the app.

**Recorded rather than skipped, per P12**: a decision specifying user-visible behaviour needs
an assertion or it is a note. This *is* the note, and it names what would convert it: the first
source to plot a coordinate — FIRMS, which is gated behind this migration and whose thermal
anomalies are precisely the case where false precision reads as a strike location.

**What would close it:** a browser assertion that a fact carrying `resolution: 'country'`
renders the centroid wording, and one carrying `'point'` does not. It lands with the first
plotted source, not before.

## 14. P3's contributing-shortfall caveat has no reachable instance

| Path | Exercised by | NOT exercised by |
| --- | --- | --- |
| `contributingShortfall` — counting empty contributing inputs | `tests/p3-propagation.test.ts`, planted | any production derivation |
| The caveat it produces on a relation score | — | nothing; it cannot currently fire |

**Why.** `ScoredInput.weight` is `number`, never `null`, and an absent finding is absent from
the array rather than present-and-empty. So the only derivation with contributing inputs
cannot produce one that came back empty. Full measurement in `FOUND.md`.

**The required-input path IS exercised**: `provenanceState` returns `nodata` when a required
input is empty, planted in the same test file and asserted in the browser on the component
gallery per P12.

**What would close it:** a derivation whose inputs can legitimately be empty while the result
stays computable. The economy panel's derived indicators are the likely first — a ratio over
several series where one series has a gap is exactly the shape the rule was written for.

**San Marino is not a candidate and should not be re-attempted.** Its six-versus-two case was
named as a P3 fixture across several sessions, but the multi-holder guard in `resolve.ts`
already returns `undetermined` with a reason and a warning — it refuses, and did so before P3
existed. That is the system having worked without the rule, not a gap the rule fills. See
`DECISIONS.md` P13.

> Kept rather than deleted. Removing a specified rule because today's data cannot reach it
> would mean re-deriving it the first time data can, and P3 took three sessions to specify.

### The general class this belongs to — BUILT, TESTED, UNCALLED

**Added 2026-08-15.** §14 above was written as one path's problem. It is an instance of a
coverage class worth naming, because everything in this project's arsenal reported green over
it:

| Check | Verdict | What it could not see |
| --- | --- | --- |
| 12 planted unit tests | pass | whether anything calls the function |
| `tsc --noEmit`, both projects | exit 0 | a correct branch is still correct when unreachable |
| P3 browser assertion (P12) | pass | it pointed at the *required*-input case, a different branch |
| `npm run verify`, 287 assertions | only the known L9 failures | same |

**This is not vacuity, and the distinction matters.** A vacuous test does not exercise its
subject — the mutation scored from another step's failures, the guard watching a detached node,
the wait that returned true early. Here the tests genuinely exercise the code and would catch a
regression in it. **The tests run the branch; the app never does.** Vacuity is a defect in the
check. This is a defect in nothing at all — every part is correct — and it is invisible
precisely because each check is honest about its own scope.

**What sees it: counting the construction sites.** A test proves a function works. Only
enumerating its callers proves anything calls it.

```
$ grep -rn "required: false" src/ --include=*.ts
src/relations/provenance.ts:65      <- the only production site
src/dev/gallery.ts                  <- the demonstration, added afterwards
```

`tests/p3-reachability.test.ts` now holds that enumeration, and it fires in three directions:
an undeclared contributing site fails it, a declared site that disappears fails it, and — the
unusual one — **it fails when the situation improves.** The moment a production input can be
empty, `contributingShortfall` goes live and the assertion says so, naming the gallery entry as
the stand-in to replace. The reminder is attached to the condition that makes it actionable
rather than to a step number someone has to remember, which is the same reasoning as
re-recording the suite census whenever the suites change instead of on a schedule.

**For step 10.** The mechanism is built, tested and waiting. It goes live the moment relations
inputs can represent consulted-and-empty — `OPEN-QUESTIONS` 13, deliberately still armed rather
than pulled forward: relations run on seed data, so implementing the representation now would
produce a *second* mechanism waiting for a caller. One dead branch, written down as waiting, is
better than two.

**Where to look for other instances.** Any rule specified ahead of the data that motivates it:
§11, §12 and §13 above are all "adapter proven, nothing renders it", which is this class seen
from the other end. The question to ask of each is not "is it tested" but "what calls it".

---

## 15. The Military tab renders six countries; every other country is honestly blank

**Added 2026-08-15 with step 8.** The economy tab's precedent, applied deliberately rather than
by accident.

| Path | Exercised by | NOT exercised by |
| --- | --- | --- |
| Every rendering branch | six hand-checked profiles in `data/military-seed.json` | live data — there is none |
| `loadMilitary` returning null | the 190-odd countries with no fixture | anything that proves the null branch is *rare* rather than typical |

**The six exist because each carries a specced hard case**, not because they are representative:
Costa Rica (no armed forces, zero recorded presence), Iceland (expenditure without personnel),
Eritrea (personnel without expenditure), Israel (non-NPT undeclared), New Zealand (ceremonial
command, a recorded deployment), France (operational command, NPT state, basing).

**Every other country renders "No military data … while the ingest is unconnected."** That is
honest and it is thin, and the thinness is the point: the rendering is proven against the shapes
that break it before any pipeline exists to feed it.

### What step 10 inherits, as a checklist

1. **`hasArmedForces` has no source.** It is hand-set per fixture. A live ingest must decide
   where it comes from — a constitutional fact, not a figure, and absent from every statistical
   source this app uses.
2. **The abolished/absent distinction must survive the pipeline.** `forcesSummary` returns three
   states and a naive ingest collapses two: a country with no rows looks identical to a country
   with no forces.
3. **`overseasPresence` null versus `[]` must survive it too.** The provider preserves the
   distinction today; an ingest that maps "no rows returned" to `[]` would convert *not
   consulted* into *consulted and empty*, and the panel would say "None recorded" about a
   question nobody asked.
4. **Tier follows the source, per row.** FAS figures are `ESTIMATE` because FAS says so. A live
   ingest must carry that per source rather than tiering the whole tab.
5. **The no-equipment card becomes per-country** the moment any equipment source is connected,
   and its signature changes with it — deliberately, so the change is visible rather than a
   string quietly starting to lie.

> Kept rather than deferred: the hard cases are the specification, and they are provable now.
> What is unexercised is breadth, not correctness.
