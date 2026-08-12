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
