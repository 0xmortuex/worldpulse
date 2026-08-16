# Proposed next goal — the closing goal: 4e, the news board, and the sweep

Written per S6 at the close of the core goal. Sized for 8+ hours unattended (S5).

**Seven of eight `CORE-GOAL.md` items are done.** This goal is the remainder, in the order
the reviewer set, and it is the last one before v1 is complete per S1.

**The queue is clear.** OPEN-QUESTIONS 30 and 25 were both answered at the close of the
previous goal, and nothing below waits on a decision.

---

## Item 1 — 4e, per-panel live conversion

**The harness generalisation comes first, because it gates every panel.**

`ScenarioFetcher.request` reads `spec.path.split('/indicator/')` and branches on `NY.GDP` —
it is World-Bank-shaped, because it was built for the one panel that needed it. Three panels
are otherwise ready: `wikidata-sparql` is CLIENT-FETCH with a 146-byte probe response, and its
queries are bounded and measured at 1–2s.

**Order, and each part's own gate:**

1. **Generalise the scenario harness** — scenarios per source, fixtures per scenario, and the
   four fetch states (loading, stale, degraded, unavailable) asserted for each. Its own commit,
   its own browser assertions.
2. **Convert legislature, government and the dossier header**, one commit each, per 20b: keep
   the fixtures as the contract test's input, add a `fixtures` scenario, point every hard-case
   assertion at it, and prove the live path separately under `PROBE_LIVE` against invariants
   rather than values.
3. **TV: a build-time extract, not a fetch.** `channels.json` is **1,274,245 bytes gzipped,
   9.8 MB raw**. No amount of caching makes that a per-view fetch, and
   `scripts/extract-ucdp.mjs` is the precedent — it already handles 417,968 events. **The
   blocklist must be applied at extract time**, so the 1,578 excluded channels never reach the
   bundle at all.
4. **Military and news convert to honestly stating no source**, rather than waiting for
   sources that do not exist. `hasArmedForces` now has a committed, reviewed table (question
   31), so the military panel's live path is that table plus an honest gap for its figures.
   GDELT is UNREACHABLE and the news panel says so.

**Acceptance:** the battery at each commit; the harness generalisation with its four states
asserted; three panels converted in three commits; the TV extract shipped with the blocklist
applied before bundling; military and news stating their gaps in the app-owned wording.

---

## Item 2 — The breaking-news board, per `SPEC-BREAKING-NEWS.md` as amended

**The blocking dependency is the build order.** GDELT failed **six of six** attempts across a
full session and is recorded UNREACHABLE. A ranking engine built on a source that has never
once responded is a ranking engine nobody has seen rank anything.

**So the order inside this item is fixed:**

1. **The curated RSS fallback lands first** — the fifteen named feeds.
2. **The card layout is built against fixtures.** The ranking engine already exists:
   `src/news/significance.ts` shipped with the previous goal, normalised per rule 22, with
   ties as bands and unconsulted inputs as null rather than zero.
3. **Then they wire to real feeds.**

The fixtures are **not a placeholder for the feed — they are the regression suite**, per D6.

**Four time horizons** — Today, This Week, This Month, This Year.

**What must reach the surface**, and these are the parts most likely to be dropped under time
pressure:

- the `[DERIVED]` tag on the surface as a whole
- **the caveat as the headline, not a footnote**: this ranks coverage volume, not importance,
  and it ranks *fifteen English-language feeds' coverage* — `SIGNIFICANCE_CAVEAT` already
  carries all three clauses
- a **"why this ranked here" inspector** on every card, showing each input's raw measurement
  beside its normalised contribution, walking down to the source articles
- **user-adjustable weights with live re-ranking**, as in the relations panel
- **ties as a band**, never ranks 4, 5, 6

**Acceptance:** the battery; the RSS fallback proven before any ranking work; the caveat
asserted in a browser; the inspector showing raw beside normalised; a tied band asserted with
a planted case; GDELT not a dependency of anything that must work.

---

## Item 3 — Step 14, the closing sweep with the doc-versus-tree audit

Contract-test completion, accessibility pass, performance pass — over whatever landed after
B1/B5/B6 pulled most of the accessibility work earlier.

**The doc-versus-tree audit is the part specific to this project**, and it exists because of a
measured failure: for four days every reference to "the caveat on the panel" described
something that had never been built. `DOC-TREE-AUDIT.md` is the standing instrument.

**What it checks, at minimum:**

- every user-visible behaviour a doc asserts has an assertion behind it (P12)
- every "done" in `BUILD-ORDER.md` matches the tree
- every open question's status line matches its entries
- every `verified: true` carries a date, and every recorded doubt has an expiry
- every unexercised path is still unexercised, **or is closed with its construction site
  named** — §14 in particular, whose blocker moved from the model to the data and will move
  again the first time a live ingest answers empty

**Acceptance:** the battery; the audit run and its table recorded; `BUILD-ORDER.md` showing
14 of 14; every doc asserting user-visible behaviour either backed by an assertion or struck.

---

## The battery, at every boundary

Unchanged from `CORE-GOAL.md`, and stated there rather than repeated here so an amendment
lands in one place. In short: `typecheck` exit 0 · `npm test` exit 0 with count and census
clean · `verify` full-run per-step table with no failure outside the known L9 cluster ·
`mutate` per S4a before a push or a close · `git status --porcelain` empty · nothing unpushed.

**Read it bare, never through a pipe** (rule 44). **Run the full suite, not `--only`**, before
concluding anything about a regression — a filtered run misled this project three times in one
session, twice by matching nothing and running everything.

---

## Constraints

`CORE-GOAL.md`'s standing constraints apply unchanged: S1's scope freeze, the full gate for
every source, nothing fixed by widening a type or loosening an assertion, D6's
fixture-contradiction rule, route-around-and-record for judgement calls, S7 for amended
criteria, and rule 41's four clauses on command shape — **including 41d, the newest: no quoted
parentheses or braces, and no compound chains.**

**New UI goes after existing UI in a container.** Twice in the last goal, inserting a control
above an existing one broke that one's assertions.

---

## Open questions this goal will run into

**None gating.** 30 and 25 are answered. 22–27 are reviewer actions on credentials, endpoints
and licence text, and none blocks this work. Question 13 stays armed until a live ingest first
answers empty — which item 1 may well cause, and `tests/p3-reachability.test.ts` will fail
when it does, by design.

## Launch condition

**Nothing here needs a decision.** The blockers are measured, the order is the reviewer's, and
the two open questions in the way were answered before this was drafted.
