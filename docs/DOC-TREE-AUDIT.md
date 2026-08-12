# Doc-vs-tree audit

Every rule, assertion and mechanism that `DECISIONS.md` and `TESTING.md` claim exists,
checked against the code on `claude/worldpulse-globe-dashboard-n3984g-0oxido`
(`b549c0f`, a full clone — not shallow — of 27 commits).

**Why this exists.** Two claims have now been found asserted-but-absent, in the same
direction both times: the step-7 commit reported a green suite that was not green
(`712cd60`'s own message opens with this), and a later session reported landing a
first-attempt assertion for the marker-click check that has never existed in any commit.
The standing record of what this project contains is assembled from session reports, and
session reports have been wrong twice. This is the check on that.

**Nothing found here has been repaired.** Reporting is the whole job.

## Result

**52 claims checked. 47 present as described. 4 discrepancies. 1 stale number.**

The gap is narrower than two false reports might suggest — but three of the four
discrepancies sit in the harness's own guards, which is the worst place for them.

---

## Discrepancies

### 1. Rule 15 — the first-attempt assertion does not exist

| | |
| --- | --- |
| **Claim** | TESTING.md rule 15: "the attempt count is reported in the failure detail so a check that starts needing all three attempts is visible rather than silent" |
| **Should live in** | `scripts/verify-render.mjs`, the marker-click block (~1039–1075) |
| **Status** | **PARTIAL — the reporting exists, the visibility does not** |

`in ${attempts} attempt(s)` is present, but only inside the two `check()` *detail*
strings, which print only when the check fails. A run needing all three attempts and
succeeding prints identically to one that worked first time. The retry landed in
`712cd60`, the same commit that wrote rule 15; the assertion never accompanied it.

Searched conclusively: `git grep "first attempt"` across every commit touching
`scripts/verify-render.mjs` returns nothing, as do `-S"attempts === 1"` and
`-S"firstAttempt"` across all refs. No dangling commits, no stash, no third branch.

Measured consequence: the guard fails on **93%** of first attempts on this machine. Rule
15 describes that as a visible condition. It has never been visible.

### 2. "Both call sites consume the result" is false, and the one that doesn't is in the flake path

| | |
| --- | --- |
| **Claim** | TESTING.md, *Checked and currently clean*: "Discarded `waitFor` results … Both call sites consume the result." |
| **Should live in** | `scripts/verify-render.mjs` |
| **Status** | **STALE AND FALSE** |

There are **three** call sites now, not two:

| Line | Consumed? |
| --- | --- |
| `verify-render.mjs:674` | yes — it is the condition of a `check()` |
| `verify-render.mjs:970` | **no — result discarded** |
| `verify-render.mjs:1054` | yes — assigned to `arrived` |

Line 970 is `pickEvent`'s wait for the marker tooltip: the exact wait this session found
to be vacuous, satisfied instantly by the previous hover's leftover tooltip. The doc
recorded this failure class as checked and clean while a new instance of it was being
written into the flakiest check in the suite.

### 3. A6a's third `verifiedAgainst` value is missing from the type

| | |
| --- | --- |
| **Claim** | DECISIONS.md A6a: "`verifiedAgainst` gains a third value, `bundled`." |
| **Should live in** | `src/facts/registry.ts`, `data/sources.json`, `scripts/check-deploy-gate.mjs` |
| **Status** | **PARTIAL — data and gate have it, the type does not** |

```ts
src/facts/registry.ts:5
export type VerifiedAgainst = 'documentation' | 'live';
```

`data/sources.json` declares `bundled` in `verifiedAgainstValues` and uses it on
`naturalearth`; `check-deploy-gate.mjs` handles it, including the `BUNDLED_EVIDENCE`
registry A6a requires. Only the TypeScript type omits it — and `registry.ts` reaches the
JSON through `as unknown as Registry`, so the cast swallows the mismatch. Any code
branching on `verifiedAgainst` is type-checked against a set of values that does not
match the data, and the checker cannot say so.

This is rule 14's shape at the registry boundary: a rule enforced through a type, with a
cast standing where the enforcement should be.

### 4. Rule 3 / A2 — the INCONCLUSIVE guard has a reachable bypass

| | |
| --- | --- |
| **Claim** | TESTING.md rule 3 / DECISIONS.md A2: "Any probe or contract test that reads headers, shape or ranges off a non-2xx response must report `INCONCLUSIVE`." |
| **Should live in** | `scripts/probe-sources.mjs:154` |
| **Status** | **PARTIAL — guarded only when ACAO is also absent** |

```js
} else if (!res.ok && !allowed) {
```

An error response carrying `ACAO: *` fails the second condition and falls through to a
conclusive verdict. Demonstrated live across three probe runs: `wikidata-sparql` scored
**WORKER-REQUIRED** twice off a 403 that happened to carry `*`, and **INCONCLUSIVE** once
off a 429 that did not. Same source, same question, verdict decided by a header on an
error path.

### 5. Stale number (minor)

TESTING.md says "**33 assertions** match a regex against a whole-panel `innerText` blob."
Current count of `innerText` occurrences in `verify-render.mjs` is **32**. The caveat
stands; the figure drifted.

---

## Verified present

Checked by locating the named mechanism in code. Where a doc row names a test, the test
name was matched exactly.

| Claim | Lives in | Status |
| --- | --- | --- |
| R1 hover yields a country tooltip | `verify-render.mjs` | present |
| R2 `refuses to escalate one-way sanctions into adversary` | `tests/relations.test.ts:34` | present, named as documented |
| R4 contract shape/range assertions | `tests/contracts.test.ts` | present |
| R5 SEED banner rendered | `src/main.ts:266` | present |
| R6 `catches a planted violation, including one template deep` | `tests/fact-discipline.test.ts:185` | present |
| R7 fact ids never reused | `tests/badge.test.ts:157`, `:175` | present, both cases |
| R8 `assertLayout(page, container, children, label)` | `verify-render.mjs:247` | present |
| R8 breakpoints 360 / 900 / desktop | `verify-render.mjs:381-383` | present |
| R9 `assertTextFits` / `assertSvgTextFits` | `verify-render.mjs:329`, `:361` | present |
| R9 `scrollWidth > clientWidth`, `getComputedTextLength` | `verify-render.mjs:343`, `:364` | present |
| R9 extreme fixture per numeric surface | `fixtures/economy/inflation-hyper.json`, `fixtures/news/articles-extremes.json` | present |
| R10 positive controls | 14 `positive control` assertions | present |
| R10 every fixture country reachable | `tests/fixtures.test.ts:28` | present |
| R11 `formatAxisValue` cannot emit exponent notation | `src/economy/series.ts:227` | present |
| R12 case-insensitive text matching | `verify-render.mjs` | present |
| R13 bundle freshness guard | `verify-render.mjs:45`, `:74`; `verify` builds first | present |
| R14 render-helper registry, planted bypass | `tests/render-helpers.test.ts:210` | present |
| R16 helpers assert they examined something | `verify-render.mjs:355`, `:374` | present |
| R17 skips recorded and printed | `verify-render.mjs:157` | present |
| R18 CAUGHT / CAUGHT-ELSEWHERE / BUILD-FAILED / TIMEOUT / UNPARSED | `mutation-check.mjs:369-398` | all five present |
| R18 report on uncaught exception / rejection | `verify-render.mjs:232` | present |
| R19 clipped-content check, not zero-size | `verify-render.mjs:296` | present |
| A4 fact discipline via real type info | `tests/fact-discipline.test.ts` | present |
| A5 UNTRACEABLE renders loudly | `src/facts/badge.ts:104`, `inspector.ts:71` | present |
| A6/A6a deploy gate, bundled evidence registry | `check-deploy-gate.mjs:37`, `:54-64` | present (but see discrepancy 3) |
| A7 monotonic fact ids | `src/facts/badge.ts:33` | present |
| A8 dual-portrait overlap self-test | runs green in `verify` | present |
| A10 fixture-mapped countries exist | `tests/fixtures.test.ts` | present |
| V1 per-step table every run | `verify-render.mjs` | present |
| V2 a skipped check exits non-zero | `verify-render.mjs:216` | present |
| V4 examined-something pairing | `verify-render.mjs:355`, `:374` | present |
| V5 one mutation per step | `mutation-check.mjs` — 9 steps | present |
| P1 untraceability propagates | `src/facts/badge.ts` | present |
| P2 unconfigured propagates | `src/facts/badge.ts:108` | present |
| P4 derived tier inherits loudest caveat | `src/facts/types.ts`, `badge.ts` | present |
| P3 missing-data propagation | — | **absent, and documented as absent** — honest |
| D1 resolution rule displayed | `src/ui/header.ts` | present |
| D2 office titles not normalised | `src/dossier/resolve.ts` | present |
| D3 label-driven classification | `data/government-forms.json` | present |
| D4 override needs citation + review date | `src/dossier/resolve.ts` | present |
| D5 initials placeholder, never a substitute photo | `src/dossier/portrait.ts:7` | present |
| D6 leader fixtures as regression suite | `tests/leader-resolution.test.ts` | present |
| G1 ministry glosses verbatim from source | `src/sources/wikidata-government.ts` | present |
| G2 party bar only when seats account for the chamber | `src/ui/government.ts:224`, `tests/government.test.ts:122` | present |
| G3 untranslated portfolios keep Q-id | `src/ui/government.ts` | present |
| G5 Q-id registry | `data/wikidata-entities.json` | present |
| E1 gap / nodata / stale distinct | `src/economy/series.ts` | present |
| E2 unit and basis in the registry | `data/indicators.json` | present |
| E4 leading and trailing nulls trimmed | `src/economy/series.ts:85`, `:117-120` | present |
| E5 "not fetched" rather than omitted | `src/ui/economy.ts` | present |
| E6 compact axis formatting | `src/economy/series.ts:227` | present |
| N1 coverage is a property of the index | `src/ui/news.ts` | present |
| N3 a day with no coverage breaks the line | `src/news/tone-chart.ts:17` | present |
| N4 dedup with outlet count | `src/dossier/news-provider.ts` | present |
| N5 unusable rows counted with a reason | `src/ui/news.ts:64`, `:123`; `tests/news.test.ts:71` | present |
| N6 direction from the headline | `src/ui/news.ts` | present |
| L1 back-facing markers not pickable | `src/globe.ts` — `pointerEventsFilter` | present |
| L2 cluster sits on the strongest member | `src/layers/events.ts` | present |
| L3 polygon-derived position tagged DERIVED | `src/layers/events.ts` | present |
| L4 180-day staleness | `src/layers/events.ts` | present |
| L6 markers above the tallest polygon altitude | `src/main.ts:45`, `:148` | present |
| L7 magnitude carried twice from one field | `src/layers/events.ts:22-39` | present |
| L8 no magnitude concept, no magnitude fact | `src/layers/events.ts:36-39` | present |
| O1/O2 override registry | `data/leader-overrides.json` | present |
| Decision 5 zero-key operation, "not configured" | `src/facts/badge.ts:108-130` | present |

Two false negatives were produced and corrected during this audit — E4 and N5 were
initially scored absent because the search terms were wrong (`Leading` is capitalised;
the news parser lives in `src/ui/news.ts`, not `news-provider.ts`). Both are present.
Recorded because an audit that miscounts in the direction of alarm is as useless as one
that miscounts the other way.

---

## What to change so this cannot recur

Both confirmed false reports share a shape: **a claim about the tree with no citation
into the tree.** Neither would have survived a rule requiring one.

1. **A report claiming an assertion landed must cite the file and the assertion string.**
   "The first-attempt assertion is in place" is unfalsifiable at a glance;
   "`verify-render.mjs:1070`, `check('worked on the first attempt', attempts === 1)`" is
   checked in three seconds.
2. **A doc row describing a check must name the file it lives in.** Every row in the
   table above has a location because it was verified; rows written without one are
   claims nobody can audit later. A rule that exists only in prose is a rule nobody is
   running.
3. **A rule's own guard is subject to the rule.** Three of four discrepancies are in
   harness guards — the discarded `waitFor`, the INCONCLUSIVE bypass, the cast at the
   registry boundary. The suite audits the app; nothing audits the suite except this.
