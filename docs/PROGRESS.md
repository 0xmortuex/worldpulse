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
