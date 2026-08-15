# The core goal — v1 to done, in eight items

**Written 2026-08-16, at the close of the WDQS redesign.** This is the plan the reviewer's
goal statement references. It exists so that the goal can be set by naming this file rather
than by restating a plan, and so that nothing load-bearing lives in scrollback — the failure
`BUILD-ORDER.md` was written to end.

**Scope is S1's definition of done**, unchanged: remaining Phase A + steps 8–14 + all panels
live + the breaking-news board + Phase B leftovers. Step 8 is closed. This file carries what
remains.

---

## How to read this file

Three things are separated deliberately, because they change at different rates:

| Part | What it is | When it changes |
| --- | --- | --- |
| **The eight items** | the work, in the order it runs | when the reviewer re-sequences |
| **The battery** | the same checks at every boundary | when the harness changes cost (S4a) |
| **The standing constraints** | how the work is done, everywhere | rarely; each has a finding behind it |

Per S7, **conditions here are stated against documents that can absorb an amendment** — a
gate table, the battery, `OPEN-QUESTIONS.md` — rather than against named artefacts a later
decision might strike. S7 exists because a goal whose condition became unsatisfiable burned
an evaluator's turns proving the impossibility, correctly, for the rest of a session.

---

## The order, and why item 11 precedes item 10

The reviewer's sequence is **9 → 11 → 10 → 12 → 13 → breaking news → 14**, and the one
inversion in it is deliberate rather than a slip, so it is recorded as such: **step 11 (live
TV) runs before step 10 (the ingest pipeline).**

The reason it works: step 11 is self-contained. It ingests one catalogue (iptv-org), needs
per-stream health checks, and touches no panel's Fact model. Step 10 rewrites how every panel
gets its data and carries five recorded inheritances plus two open questions. Putting the
small independent ingest first means the ingest muscle is exercised on a surface whose
failure mode is visible and local before it is applied to all nine panels at once.

**If that reasoning stops holding — if step 11 turns out to need pipeline machinery that only
step 10 builds — that is a finding, recorded, and the order is the reviewer's to revisit.**
It is not mine to silently swap back.

---

# The eight items

## Item 1 — Close the WDQS redesign, with the Q83307 guard

**State: substantially landed; closing.** The redesign is done and measured. What closes it
is the battery plus the guard.

**What landed:**

| Change | Measurement behind it |
| --- | --- |
| `wdt:P279*` replaced by a bounded path, 4 hops | the unbounded closure was 24s of the cabinet query's 52 |
| chamber walk bounded to 2 hops | measured; 3 finds nothing 2 does not |
| court walk bounded to 1 hop | same |
| `courtOfLastResort` QID corrected | `Q1513611` was "Supreme Court of Ghana", **0 instances** — an individual used as a class |
| `CABINET_ROW_LIMIT` 300, **hit case detected** | GBR returns exactly 300/300 — a truncation the 504 had been hiding |
| truncation caveat renders first, heading says "at least N" | it changes what every number below it means |

**The Q83307 guard is the item's remaining substance.** `tests/entity-verification.test.ts`
runs the check that was already sitting in the entity table as a field: every entry carries
`expectedLabel` beside its `qid`, and nobody had ever compared them. Live half asserts the
label matches **and that instances > 0** — because a label match alone would not catch a
wrong QID that happened to share a name, and every entity here is used as a *class* in a
`wdt:P31` walk.

**The generalisation, which is the part worth keeping:** `"verified": false` in the entity
table was a recorded doubt with no expiry. Both the means to resolve it and the doubt itself
were written down, and neither did any work. That is P12's shape in a data file — a flag that
reads as diligence and functions as a comment. The offline half now requires an unverified
entry to state what would resolve it, and a verified one to be dated.

**Acceptance:** the battery, plus `courtOfLastResort` and `minister` both `verified: true`
with dates, plus the mutation table reported.

**Open questions it touches:** #28 (answered — stated below), #29 (measured rather than
judged: the QID was demonstrably an individual, not a class).

---

## Item 2 — Step 9, the Legislature tab, per spec

**Unblocked by item 1.** `BUILD-ORDER.md` marked it BLOCKED on a query that completed for no
country tried; the redesign was the precondition and it is met.

**Scope:** the tab itself — chambers, composition, seat counts, terms, the party
breakdown — built the way every panel before it was built: **fixture hard cases first**, then
layout against them, then the live path proven separately under `PROBE_LIVE` per 20b.

**The hard cases are the specification.** At minimum: a unicameral legislature, a bicameral
one, a country whose upper chamber is appointed rather than elected, a suspended or dissolved
legislature, a chamber whose composition is genuinely unknown, and **the truncation case** —
because item 1 proved the cap bites for real countries and the panel must say so rather than
render a short list confidently.

**Two things carry forward from item 1 and must not be dropped:**

1. **The truncation disclosure is already shipped for the cabinet.** The legislature panel
   needs its own, and per rule 42 it ships with the case where it must *not* appear.
2. **The bound is six countries of evidence, not a proof.** `wdqs-budget.test.ts` compares
   4 hops against 5 and reports the difference as the bound biting. If a legislature country
   is deeper, that guard is what says so.

**Acceptance:** the battery; every hard case asserted in a browser; the live path proven
against invariants rather than values; contract test against a live capture per the standard
gate; `BUILD-ORDER.md` step 9 marked done with its evidence.

---

## Item 3 — Step 11, Live TV

Via **iptv-org**, with **per-stream health checks**.

**The specced behaviour, which is a rule-30 case in disguise:** dead streams are **marked
offline and sorted last — not hidden.** Hiding them would misreport coverage: a country whose
every stream is dead would render identically to a country with no streams catalogued, and
those are different facts about the world.

**Licence first, per L15.** iptv-org's terms are read and recorded before anything is
ingested, not inferred from it being a public GitHub repository. This project is
**five-for-five** on licences turning out *less* permissive than the plan document assumed —
Feodo declared "CC0" and reserved all rights; every licence actually read contradicted the
column, always in the same direction. A sixth optimistic guess is not a coin flip.

**Health checks are a measurement, so rule 20a applies**: a stream's liveness is a property
of the stream *under this network, at this time*, and the recorded verdict says so. A check
that cannot reach the network reports INCONCLUSIVE, not offline — unreachable answers a
different question from dead, and conflating them is exactly what let "WDQS is slow" stand in
for a query defect.

**Acceptance:** the battery; licence read and recorded with its class; per-stream health
check with a planted case proving it fires; the offline-and-sorted-last behaviour asserted in
a browser, **including the both-states case per rule 40** — the assertion reports which states
its sample actually contained, so a sample that happened to be all-live cannot pass as proof.

---

## Item 4 — Step 10, the ingest pipeline

**The largest item, and the one with the most recorded debt.** Live ingests replace the
hand-checked seed set. Phase A built the ingest muscle; this spends it.

Its acceptance criteria are **already written down** across `UNEXERCISED-PATHS.md` §15,
`OPEN-QUESTIONS.md` #13 and `DECISIONS.md` S3/L12/L13. They are promoted here to criteria
rather than restated as notes, because a requirement recorded in a findings file is a note
until something checks it — P12's whole point.

### 4a. `hasArmedForces` sourcing

**It has no source.** It is hand-set per fixture today. A live ingest must decide where it
comes from — and the difficulty is that it is a **constitutional fact, not a figure**, absent
from every statistical source this app uses.

**This is a decision, not a judgement call**, and it goes to `OPEN-QUESTIONS.md` with options
and a recommendation rather than being resolved by picking whichever source is easiest to
fetch. Inventing a source for a constitutional fact is the emergency-3 shape: a wrong value
rendered with confidence.

### 4b. Rule-30 structural preservation through the pipeline

Three distinctions exist in the model today and **a naive ingest collapses all three**:

| Distinction | How it dies |
| --- | --- |
| abolished vs absent | `forcesSummary` returns three states; a country with no rows looks identical to one with no forces |
| `overseasPresence` `null` vs `[]` | mapping "no rows returned" to `[]` converts *not consulted* into *consulted and empty* — the panel then says "None recorded" about a question nobody asked |
| tier per row vs per tab | FAS figures are `ESTIMATE` because FAS says so; a live ingest must carry that per source |

Each needs an assertion that fails if the pipeline collapses it. **Not a comment saying it
must not** — §14's whole finding is that correct, well-tested, documented code can simply
never be called, and every check in the arsenal reports green over it.

### 4c. #13 lands, and §14 closes with it

`ScoredInput.weight` is `number`, never `null`, and a finding with no value is *absent from
the array* — so the relations engine stores "we never consulted this" and "we consulted it
and it was empty" **identically**. That is rule 30 conflated by omission, in the app's own
scoring engine, which is the one place the app does not enforce the distinction it enforces
everywhere else.

It does not bite today because relations run on a seed table where every entry has a weight
by construction. **It bites the moment relations move to live ingests** — this item — because
a source that answers with no value becomes possible and the engine will score around it
silently, producing a confident classification from fewer inputs than it consulted.

**This is why #13 was armed rather than pulled forward**, and the reasoning stands: fixing it
earlier would have built a second mechanism waiting for a caller, which is precisely the
finding that session produced. One dead branch documented as waiting beats two.

`tests/p3-reachability.test.ts` **fails when this question is answered**, naming the gallery
stand-in to replace — the reminder is attached to the condition that makes it actionable
rather than to a step number someone has to remember. Closing §14 means a real construction
site can express consulted-and-empty, and the caveat in `provenance.ts` plus the shortfall
block in `inspector.ts:220` stop being unreachable in production.

### 4d. L9's keyboard path, and MITIGATED closure per S3/21a

**The measurement that changed this from an accessibility nicety to the load-bearing item:**
L9 was recorded as a ~20% flake under SwiftShader at 1.3fps. Under a renderer that actually
engages the GPU, the same machine runs at 59.9fps and **every marker click fails — 100%,
deterministically.** Most users' machines are 60fps machines. Clicking a marker on the globe
does not work at all for real visitors, while our own measurements called it intermittent,
because they ran on a software rasteriser that made the failure rare and the guard vacuous.

**S3's closure conditions, verbatim in substance:** every marker-reachable event reachable
without a click; the first-attempt assertion **retained as a canary**; the mechanism
documented as globe.gl's rather than ours.

**Per rule 21a, MITIGATED is not CLOSED.** L9 stays open — the raycast mechanism is still
unexplained, and one clean run is not a closed flake. What ships here is the route around it,
with the route asserted. S3 is explicit that this does not gate "done": a dependency defect
routed around, with the route asserted, is closed; waiting on an upstream explanation that
may never come would hold v1 hostage to someone else's raycast.

**L13's timeboxed diagnostic is available and is not a gate.** A 100%-reproducible failure
can be bisected where a 20% one cannot, so instrumenting the click frame is now worth one
session — but the keyboard path ships either way, so the diagnostic can only save work.

### 4e. Per-panel conversion, per 20b, each in its own commit

The economy panel is the worked example and the pattern is standing:

1. **Keep the fixtures** — they become the contract test's input and the browser suite's
   deterministic input; they stop being the app's data source.
2. **Add a `fixtures` scenario** serving exactly what the panel's fixture provider served.
3. **Point every hard-case assertion at that scenario**, and say in the harness why.
4. **Point the state assertions** — loading, stale, degraded, unavailable — at their own
   scenarios, since each is reachable only through a specific remote failure.
5. **Prove the live path separately** under `PROBE_LIVE=1`, **against invariants rather than
   values** — a live figure that changes yearly must not be pinned, or the test fails every
   spring for the wrong reason.

**Why one commit per panel:** the same reason each `verifiedAgainst` flip got its own commit
during Phase A. A conversion that breaks something must be attributable to the panel that
broke it, and a batch of nine is a bisect nobody can run.

**The danger 20b exists to name:** left pointing at the live path, hard-case assertions
**quietly stop testing the branch they were written for and start testing whatever the API
returned that morning. They keep passing, which is what makes it dangerous.**

**Acceptance for item 4:** the battery at each panel commit and at the item's close; 4a
answered or in `OPEN-QUESTIONS.md` with options and a recommendation; 4b's three distinctions
each carrying a failing-if-collapsed assertion; #13 landed and §14 closed with
`p3-reachability.test.ts` updated rather than deleted; L9 MITIGATED per S3 with the canary
retained; every panel converted in its own commit with its 20b scenario.

---

## Item 5 — Step 12, the coverage-gap choropleth and arcs

**The choropleth's subject is our own coverage**, which makes it the one surface where a
missing value is the *point* rather than an embarrassment.

P3's missing-data propagation was originally scheduled here and has since been **re-scheduled
forward** into the batched Fact-model migration, which landed. So what step 12 carries is the
rendering, not the model.

**Arcs** land with it: the relation edges drawn on the globe, which are `DERIVED` and must say
so — per rule 22, an aggregation across kinds carries its normalisation on the surface, and
the whole surface says `[DERIVED]`.

**The colour work is not optional and is not cosmetic.** Phase B1 requires colourblind-safe,
**dual-encoded** output: a choropleth that encodes coverage in hue alone is unreadable to a
material fraction of users, and "unreadable" for a surface whose entire job is to communicate
absence means it communicates nothing to them.

**Acceptance:** the battery; the coverage figure is a `Fact` with a tier and provenance like
any other number; the "no coverage" case rendering distinctly from the "zero coverage" case
(rule 30, again, at map scale); dual-encoded per B1; arcs labelled `DERIVED` with their
inputs inspectable.

---

## Item 6 — Step 13, time scrub, watchlist, URL state

Three pieces, one step:

**URL state.** `state.ts` holds selection and weights; the URL gets them here. **Phase B2 is
the same work and discharges it — do it once**, per the coupling table in `BUILD-ORDER.md`.

**Time scrub.** The hard constraint is architectural and specced: **the scrub must score a
pair as of a past date without the scoring module knowing about time.** A scoring engine that
takes a date is a scoring engine that has to be re-verified for every date; the time
dimension belongs in what is *fed* to it.

**Watchlist.** `WATCHLIST.md` and `WATCHLIST-RESULTS.md` already hold the predictions and
their outcomes. This surfaces them. **P13 governs:** a watchlist prediction is checked against
the tree before it is built, never assumed because several sessions repeated it — which is the
failure the watchlist exists to catch about the world, turned on ourselves.

**Acceptance:** the battery; a URL round-trip asserted (state → URL → state, including the
empty and maximal cases); the scoring module's signature proving it has no time parameter;
watchlist entries rendering their outcome, including the ones that were *wrong*, because a
watchlist that only shows its hits is an advertisement.

---

## Item 7 — The breaking-news board, per SPEC-BREAKING-NEWS as amended

**The blocking dependency is stated first in the spec and is restated here because it is the
whole build order:** this **must not be built against GDELT**. GDELT failed **six of six**
attempts across a full session — 429, 429, connection error, connect timeout, `fetch failed`,
429 — and is recorded UNREACHABLE. *A ranking engine built on a source that has never once
responded is a ranking engine nobody has seen rank anything.*

**So the order inside this item is fixed:**

1. the **curated RSS fallback** lands first;
2. the **ranking engine and card layout** are built against fixtures;
3. **then** they wire to real feeds.

The fixtures are **not a placeholder for the feed — they are the regression suite**, per D6.

**Four time horizons** — Today, This Week, This Month, This Year — each a ranked board.

**Significance ranking is `[DERIVED]` and the whole surface says so.** Rule 22 makes the
normalisation mandatory rather than optional: the inputs are of different kinds and an
aggregation across kinds without a stated normalisation is a number whose meaning nobody can
reconstruct. Two of the inputs are **bounded by the curated feed list**, which is a property
of our curation and not of the world, and the surface says that too.

**Missing inputs are an instance of the P3 class** — which is now a shipped mechanism rather
than a plan, and item 4c gives it a real construction site. A story ranked from fewer inputs
than were consulted carries the shortfall caveat.

**C2 (population-exposed significance) is sequenced against this spec's ranking**, per the
coupling table — one ranking, not two competing ones.

**Acceptance:** the battery; the RSS fallback landing and proven before any ranking work;
ranking built against fixtures with the hard cases the spec already enumerates; the
normalisation stated on the surface; the feed-list bound disclosed; GDELT not a dependency of
anything that must work.

---

## Item 8 — Step 14, the closing sweep, with the doc-versus-tree audit

**Contract tests completion, accessibility pass, performance pass** — over whatever landed
after B1/B5/B6 pulled most of the accessibility work earlier.

**The doc-versus-tree audit is the part that is specific to this project**, and it exists
because of a measured failure: for four days every reference to "the caveat on the panel"
described **something that had never been built**. The documentation was not merely stale — it
asserted a user-visible behaviour that did not exist. `DOC-TREE-AUDIT.md` is the standing
instrument.

**What the audit checks, at minimum:**

- every user-visible behaviour a doc asserts has an assertion behind it (P12);
- every "done" in `BUILD-ORDER.md` matches the tree;
- every open question's status line matches its entries — *this file's own status line once
  said "Five" while six were listed*, a document asserting a false fact about itself, in the
  one file whose job is to be read instead of the code;
- every `verified: true` carries a date, and every recorded doubt has an expiry (item 1's
  generalisation, applied beyond the entity table);
- every unexercised path in `UNEXERCISED-PATHS.md` is still unexercised, **or is closed with
  its construction site named**.

**Acceptance:** the battery; the audit run and its table recorded; `BUILD-ORDER.md` showing
14 of 14; every doc asserting user-visible behaviour either backed by an assertion or struck.

---

# The battery, at every boundary

**The same six checks, run at every item boundary and at every commit point within an item.**
They are listed once here and referenced by name, so that amending them amends every item at
once — S7's corollary about stating conditions against documents that can absorb an
amendment.

| # | Check | Passing means |
| --- | --- | --- |
| 1 | `npm run typecheck` | exit 0, both projects |
| 2 | `npm test` | exit 0, **with the count and census clean** |
| 3 | `npm run verify` | full-run per-step table, no failure outside the known L9 cluster |
| 4 | `npm run mutate` | per S4/S4a — full suite before a push or a goal close |
| 5 | `git status --porcelain` | empty |
| 6 | nothing unpushed | `git log @{u}..` empty |

**Reading the battery honestly — three lessons that are part of it:**

- **The failure line is the verdict; the counts are commentary.** A red suite was once
  committed after reading `tests 718 pass 717`, because the failing line printed *first* and
  the summary looked fine.
- **A run measures the tree it ran against.** The tree stays untouched while a measurement is
  in flight. A mutation run was voided by edits made during it, and the harness caught it:
  *"treat the results above as suspect."* Background work does not make the repository free.
- **A wrapper reports the wrapper; only the process reports the process.** A killed waiter says
  nothing about whether the run it was waiting on is alive. Check the process's own artifacts.

**S4a governs cost, and is re-read whenever the harness gets materially faster or slower.**
S4 was written when a verify cost ~18 minutes and a full mutation suite ~65; under the GPU
they cost ~103 seconds and ~21 minutes, which turned "full mutation before every push" from
unaffordable into a floor. The reason stands — *a check nobody can afford to run stops being
run* — and it bites at a different threshold now. The discipline follows the cost, not the
other way round.

---

# Standing constraints

These apply to every item, and each has a measured failure behind it rather than a preference.

### S1 — the scope freeze

Core is **remaining Phase A + steps 8–14 + all panels live + the breaking-news board + Phase
B leftovers**. That is v1. **WarWatch surfaces and Phase C are v2** (S2) — sequenced, not
deferred indefinitely. The PortWatch adapter stays live-without-surface per P1/P2; its panel
arrives with WarWatch.

**Nothing is added to core during the run.** A good idea found mid-item goes to `FOUND.md`
**without reprioritising** — recording it is the whole response.

### The full gate, always

Every source conversion goes through the whole gate, in order: **licence actually read per
L15** → probed → live fixture captured **via the app's own builder** → contract test with
**planted cases** → adapter with its **tier decisions commented** → the `verifiedAgainst` flip
**in its own commit**.

**A source that cannot pass is recorded with its blocker, not forced** — the riksdagen and
Ember precedents. Phase A closed with six of ten converted and four recorded, and that was the
correct outcome: forcing six conversions through guessed endpoints and inferred licences would
have manufactured the conjunction at the cost of everything the gate means.

### Nothing is fixed by weakening the check

**No widening a type, no `any`, no cast, no loosening an assertion or tolerance, no adding a
skip, no deleting a failing check.** If the check is wrong, the fix is a better check with the
reason recorded — not a quieter one.

### The fixture-contradiction rule (D6)

**Fixtures are a permanent regression suite. A live contradiction is a finding to
investigate, not a fixture to update.** The people in leader fixtures are synthetic; the
invariant is *which rule fires*. A fixture updated to match live data has stopped testing the
branch it was written for — 20b's danger, arriving through a different door.

### Route around and record, for judgement calls

A decision that isn't mine, a tradeoff with no clearly correct answer, or a defect whose fix
would change specced behaviour goes to `OPEN-QUESTIONS.md` **with enough context to answer
without opening the repo** — what was found, why it needs a decision, the options with their
costs, my recommendation where I have one — **and the work continues**.

**Four things stop work immediately, and only four:** destructive or irreversible actions; a
licence violation; **the app would assert a false fact to a user**; and a fix that would
change specced behaviour. Everything else is appended and the work goes on.

A defect that is *latent* — real but not reachable by a user today — is **not** an emergency.

### Amended criteria (S7)

**When a decision amends a criterion a live goal depends on, the goal text is amended in the
same breath.** The measured cost of not doing so: the Fact-model migration required "both P3
fixtures shown rendering caveated"; question 14 struck one fixture and amended the other; the
goal text was not amended with it, and the condition was re-evaluated as unmet for the rest of
the session while the work it gated was finished and verified.

**The amendment record is the decision that struck the criterion**, and the goal closes
administratively against it.

### Approval-prompt rerouting (rule 41)

Three clauses, each from a measured incident:

1. **File content goes through Edit/Write, never through shell interpolation.** Backticks got
   executed and heredocs collapsed, repeatedly.
2. **Diagnostic and scratch scripts are written to a file with Write, then run with a short
   `node <path>`** — never heredoc'd, echo'd, or inlined into bash. Inline content forces an
   approval prompt, and a prompt fired while a background loop is waiting means the loop is
   idling on a question nobody is there to answer.
3. **Never prefix a command with `cd` into the repo the shell is already in.** A compound
   command starting with `cd` defeats the auto-approval classifier; `npm`/`node`/`git` run
   bare so they match their approvals.

**The standing check when a prompt does fire:** find whether any long-running loop is blocked
on the same prompt shape elsewhere, and clear it.

---

# The final report format

**The run ends with a single self-contained report**, written so every question in it can be
answered **without opening the repository**. That is the same standard `OPEN-QUESTIONS.md`
holds itself to, applied to the whole run: *an entry that cannot be answered without opening
the repo is an entry I have written badly.*

It ends with a section delimited exactly:

```
=== FOR THE REVIEWER ===
```

**Everything below that marker is self-contained.** It contains, in this order:

### 1. Every `OPEN-QUESTIONS` entry that needs an answer, quoted in full

Not summarised, not linked — **quoted**, with its context, its options and their costs, and
my recommendation where I have one. A reviewer answering from a phone, with no checkout, must
be able to answer every one.

Each carries: what was found · why it needs a decision rather than a judgement call · the
options with what each costs · my recommendation, marked as such · what is blocked on it, and
what is not.

### 2. Every goal condition, marked

A table with one row per condition and exactly one of three verdicts:

| Verdict | Meaning |
| --- | --- |
| **MET** | with the evidence that shows it |
| **AMENDED** | with the decision that amended it, per S7 |
| **UNMET** | with why, and what it would take |

**No fourth category, and no unmarked rows.** A condition quietly dropped is the failure S7
exists to prevent.

### 3. Everything routed around

Each judgement call taken rather than escalated, each blocker recorded rather than forced,
each source parked with its reason. **This section is where the run's honesty is checkable**:
a run with no entries here either had no obstacles or is not telling.

### 4. The final battery numbers

All six checks with their actual figures — test count, pass count, skip count and *why* each
skip, verify assertion count and step count, the mutation table with survivors named, tree
state, push state. **Numbers, not adjectives.**

### 5. What v1 does not include

S1's scope boundary restated as shipped: WarWatch, Phase C, and anything recorded in
`FOUND.md` without being reprioritised. So that "done" means something checkable rather than
something felt.

---

## What this file is not

It is **not** a schedule — no item carries an estimate, because every estimate this project
has produced has been wrong in the direction of optimism, and a wrong estimate written down
acquires authority it never earned.

It is **not** a substitute for the specs. `SPEC-BREAKING-NEWS.md`, `SPEC-EXPANSION.md`,
`SPEC-FETCH-LAYER.md`, `SPEC-WARWATCH.md` and `BUILD-ORDER.md` remain the detail. This file is
the **order**, the **battery** and the **constraints** — the three things that were living in
scrollback.
