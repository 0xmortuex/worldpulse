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
