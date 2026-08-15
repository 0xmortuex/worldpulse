# Proposed next goal — the WDQS query redesign, which unblocks step 9

Written per S6 at the close of step 8. Sized for 8+ hours unattended (S5).

**Step 8 closed clean**: 798 tests / 165 suites, verify 338 assertions across 11 steps, mutate
12 caught by name with 0 survived, tree clean. Every specced element shipped and every hard
case asserted in a browser.

---

## Why this and not step 9 itself

`BUILD-ORDER.md` marks step 9 **BLOCKED**, and `FOUND.md` records why with measurements rather
than an impression:

| Query | Country | Result |
| --- | --- | --- |
| `buildLegislatureQuery` | GBR | **HTTP 504** |
| `buildLegislatureQuery` | ISL — one chamber | **HTTP 500 after 60.6s** |
| `buildLegislatureQuery` | VAT — one legislative body | **HTTP 504 after 65.5s** |
| `buildCabinetQuery` | GBR | **HTTP 504** |
| `buildCabinetQuery` | ISL | 200 — **52.6s**, 33 rows |
| `buildCabinetQuery` | TUV | 200 — fast, 17 rows |

**It is not country size.** Vatican City has one legislative body; Iceland has one chamber. Both
fail at the ~60s mark, which is WDQS's server-side timeout. The legislature query completes for
**no country tried**.

**And the cabinet query is on notice, not passing.** 52.6s against a 60s ceiling is the same
defect one country larger, and it already 504s for the United Kingdom.

`BUILD-ORDER` states the disposition: *"The redesign is its own item and belongs before step 9
starts, not inside it."* Building step 9 on a query that cannot complete would spend the step's
budget on requests that cannot succeed.

---

## Part 1 — Establish what actually makes it time out

**Measurement before redesign.** The finding names three candidate causes and does not choose
between them, because nothing has isolated one:

1. OPTIONAL clauses producing a cross-product
2. the round trip fetching every chamber at once
3. work that belongs at build time, as UCDP already is

**The first task is to distinguish them**, not to pick the most plausible. A rewrite that
happens to work teaches nothing about which clause was the problem, and the cabinet query — the
one still passing — needs the same answer.

Suggested method, since WDQS reports its own timings: strip the query to its smallest
completing form, then add clauses back one at a time, recording the response time of each. That
turns "the query is slow" into a table naming the clause that costs the most.

**Rule 20a applies to every timing here**: a duration is a property of the query *under
WDQS's current load*, so each measurement records when it was taken, and a comparison uses
measurements from one sitting.

## Part 2 — Redesign against what the measurement says

Whichever cause the measurement names, the redesign has the same acceptance criterion:
**every query completes for the countries that currently fail** — GBR and VAT at minimum, since
those are the recorded failures.

**The cabinet query is in scope.** Fixing only the legislature query would leave a known defect
one country larger, and both queries share the endpoint, the pattern and probably the cause.

## Part 3 — A guard, so this cannot recur silently

The defect was found by hand while capturing fixtures. Nothing in the suite would have caught
it, and nothing would catch its return.

**What a guard can honestly check:** that every shipped SPARQL query completes within a stated
budget against live WDQS, run under `PROBE_LIVE` so it does not make the ordinary suite depend
on a public endpoint's weather. An unreachable endpoint reports INCONCLUSIVE, per the contract
path's existing rule — a timeout is a different question from a query defect, which is exactly
the distinction this finding had to make by hand.

---

## Acceptance criteria

- The timing table from Part 1, naming which clause costs what
- `buildLegislatureQuery` completes for GBR and VAT; `buildCabinetQuery` completes for GBR
- A guard that fails when a query exceeds its budget, with a planted case proving it fires
- `FOUND.md` records what the cause turned out to be, including if it was none of the three
- `npm run typecheck` exit 0; `npm test` exit 0 with count and census clean
- `npm run verify` full-run per-step table, no failure outside the known L9 cluster
- `npm run mutate` per S4 before the close
- `git status --porcelain` empty, nothing unpushed

## Constraints

No Fact-model changes. No new surfaces. **Step 9 itself is out of scope** — this goal unblocks
it and stops. No WarWatch. Nothing fixed by widening a type, adding `any` or a cast, loosening
an assertion or tolerance, adding a skip, or deleting a failing check. **File content through
Edit/Write, never shell interpolation** (rule 41). Findings to `FOUND.md` without reprioritising.

## Open questions this goal will run into

None of `OPEN-QUESTIONS` 13, 17–18, 19a, 20–27 touch SPARQL. **22–27 are all reviewer actions**
— credentials, endpoints, licence text — and none gates this work.

## Launch condition

**Nothing here needs a decision.** The blocker is measured and recorded, the disposition is
already written in `BUILD-ORDER`, and the scope stops short of step 9 deliberately.
