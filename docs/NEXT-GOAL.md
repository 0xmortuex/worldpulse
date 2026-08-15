# Proposed next goal — draft for approval

Written at the close of the Fact-model migration, per `DECISIONS.md` S6: approving the next
goal should be an edit, not a reconstruction.

**Scope:** speed and run discipline first, then FIRMS, then the remaining Phase A sources.
Sized for 8+ hours unattended (S5).

---

## Part 1 — make the harness fast enough to run often

The suite currently costs ~18 minutes per verify and ~65 minutes per full mutation run on this
machine. That cost is why run discipline (S4) had to be written down at all: a check nobody
can afford to run is a check that stops being run.

### 1.1 — ANSWERED AND DONE, 2026-08-15

**Scenario (b), and worse than predicted.** The renderer string settled it before anything was
flipped: `WORLDPULSE_HARDWARE_GL=1` had never engaged the GPU. It only removed the swiftshader
flags, and headless Chromium falls back to software without an explicit ANGLE backend — so four
sessions of "hardware GL" numbers were SwiftShader compared against SwiftShader. Not a
blocklist: `--ignore-gpu-blocklist` changed nothing.

| | SwiftShader | GPU (`--use-angle=gl`) |
| --- | --- | --- |
| Globe idle, US selected | 766.6ms / 1.3fps | **16.7ms / 59.9fps** |
| p95 frame | 1533.3ms | **16.8ms** |
| Full verify | ~1050–1250s | **103s** |

**My prediction was wrong and the reviewer's instinct was right.** This document originally
said the win would be "variance, not speed". It is 46× on frame time and 10× on the suite. The
prediction was drawn from a measurement of a mislabelled configuration — which is rule 35a's
entire point, arriving one paragraph after I wrote the rule.

Landed: GPU default, `WORLDPULSE_SOFTWARE_GL=1` opt-out, renderer printed every run, and a run
that requests the GPU and gets software **fails** naming both strings. Frame budgets re-based
from 750ms to 16.7ms. The camera-settle and atomic-tooltip-read conditions the speed exposed
are in, and L9's two tangled mechanisms are separated.

### 1.2 — STRUCK, with the arithmetic that struck it

Worker count was to be sized from this machine's cores. The sizing measurement removed the
reason for the work:

| | SwiftShader | GPU |
| --- | --- | --- |
| One mutation | ~330–510s | **~115s** |
| Full 11-mutation suite | **~65 min** | **~21 min** |

Two workers on 2 physical cores might save ten minutes off twenty-one, against a worktree per
worker, port allocation, an N-of-one-run lock, per-worker accounting and a contention
measurement — and at ~408MB per browser tree on 3.79GB, near the memory ceiling anyway. **Not
built.** Recorded in `FOUND.md`: dropped because the measurement meant to size it showed there
was nothing left to size.

### 1.1 (superseded) — the plan as originally written

**Change:** `verify-render.mjs` and `mutation-check.mjs` default to hardware GL;
`WORLDPULSE_SOFTWARE_GL=1` becomes the opt-in fallback. This inverts today's default.

**What must be measured before the flip, not after:**

| Measurement | Why |
| --- | --- |
| Frame profile under hardware GL | Recorded as a new configuration per 20a. The only figures we have are idle 733.3ms median / p95 750ms, from a single run that was interrupted. |
| L9 flake rate under hardware GL | `measure-frame-profile.mjs`, all three modes. The current 20%/50%/30% belongs to swiftshader and does not transfer. |
| Every frame-dependent wait re-baselined | `waitForStableNode` and `waitForDomQuiet` budget in frames (`maxFrames: 24`). At a different frame rate that budget means a different wall-clock, and rule 36's whole lesson is that these are not interchangeable. |
| Per-verify and per-mutation durations, before and after | The point of the exercise. |

**Known risk, recorded so it is not rediscovered:** hardware-GL runs appeared to be "killed"
three times in an earlier session. That was misdiagnosed — the task wrapper's tracking ended
while the process detached and continued. Runs should be launched detached with output to a
file from the start.

**Prediction to check rather than assume** (P13): the earlier partial measurement showed
hardware GL with a *tighter* frame distribution (p95 750ms vs swiftshader's 1499.9ms) at a
near-identical median. If that holds, the win is variance rather than speed — which would
reduce flake rather than duration, and the durations may barely move. Measure before claiming
either.

### 1.2 (superseded) — the plan as originally written

**Change:** N workers, each with its own worktree, port and browser.

- **Worker count sized from the GPU re-measure**, not guessed. This machine is 2 physical
  cores / 4 logical with 3.79GB RAM, and one worker's browser tree measured ~408MB. Two
  workers is plausibly the ceiling; the measurement decides.
- **The run lock permits N workers of ONE run while still refusing a second independent run.**
  `lockDecision` already distinguishes held/stale/absent; it gains a worker count and a run id.
- **Durations recorded per worker.** Parallel runs contend, and a duration measured under
  contention is not comparable to a sequential one — 20a, applied to the harness's own output.
- **Report the contention effect rather than assuming there is none.** If two workers each take
  1.8× a sequential mutation, the parallelism is buying 10%, and that is worth knowing before
  the complexity ships.

### 1.3 Run discipline, enforced rather than remembered

S4 says full verify only at commit points and `--only` during work. Add the `--only <step>`
flag to `verify-render.mjs` (mutation-check already has one) so the discipline is available
rather than aspirational.

---

## Part 2 — FIRMS through the gate

**Now unblocked: B4 shipped**, so a thermal anomaly can plot at its declared resolution and
never finer.

Two standing rules apply and are not negotiable:

1. **"Thermal anomalies" ONLY.** Never strikes, shelling, or combat. A fire pixel is a fire
   pixel. (`SPEC-EXPANSION.md` Phase A5.)
2. **Coordinate precision bound to the source's actual resolution** (B4). FIRMS publishes a
   pixel footprint, not a point — plotting it at 6 decimals would read as a strike location,
   which violates both rules at once.

Full gate: registered with the licence **read** and recorded per L15, probed with a verdict,
live fixture captured through the app's own URL builder, contract test with planted cases,
adapter with tier decisions commented, then `verifiedAgainst: live`. Adapter-only if no surface
accepts it yet, per the PortWatch precedent.

**Needs a key** (`MAP_KEY`, free, 5000 tx/10min). If it cannot be provisioned, register/probe
what is possible and record the block — the Ember disposition.

---

## Part 3 — remaining Phase A, batched

Each through the full gate, adapter-only where no surface exists:

| Source | Note carried forward |
| --- | --- |
| Cloudflare Radar (outages) | CC BY-NC, free token. Lands on `OPEN-QUESTIONS` 9 — no licence class expresses NC **and** SA |
| IODA + OONI | corroborate Radar; a connectivity drop is factual signal, never a claim about cause |
| IOM DTM | pairs with UNHCR; same zero-versus-absent discipline |
| ReliefWeb + HDX HAPI | **headlines with source and link only, never our summaries** |
| FEWS NET | food security classifications; a genuine zero-versus-absent distinction |
| IFES ElectionGuide | free, non-commercial, credentials requested |
| UN General Assembly voting | `DERIVED` alignment, arithmetic visible in the inspector |
| abuse.ch Feodo | CC0, keyless |

---

## Acceptance criteria

- Hardware-GL frame profile and L9 flake rate recorded in `TESTING.md` as a new configuration
- Before/after durations reported for verify and for one mutation
- Mutation harness runs N workers under one lock; per-worker durations and the contention
  effect reported
- `--only` available on verify
- Per-source gate tables for FIRMS and each Phase A source attempted
- `npm run typecheck` exit 0, `npm test` exit 0 with count and census clean
- `npm run verify` per-step table, no failure other than known open checks
- `git status --porcelain` empty, nothing unpushed
- `OPEN-QUESTIONS.md` holds every deferred judgement; `PROGRESS.md` holds the checkpoints

## Constraints

No WarWatch surfaces, no Phase C, no steps 8–14 (S1/S2). No panel invented for a source whose
spec'd home does not exist. Nothing fixed by widening a type, adding `any` or a cast, loosening
an assertion or tolerance, adding a skip, or deleting a failing check. No fixture edited to
match live data without recording the contradiction as a finding first.

## Open questions this goal will run into

**9** — **SETTLED.** `share-alike-nc` exists with a fail-closed guard reading the licence text;
it fired on five sources, one of them a real misclassification (WHO). Cloudflare Radar and
CIVICUS now land on a class that carries both obligations.

**14** — **DECIDED.** Criterion amended to the reachable case, San Marino struck with its
epitaph (it was never confident; the refusal fires before any Fact exists).

**13** (relations cannot represent consulted-and-empty) **stays armed for step 10** and is not
to be pulled forward: relations run on seed data, so building the representation now would
create a second mechanism waiting for a caller. `tests/p3-reachability.test.ts` fires when the
condition changes, so it does not need remembering.

**11** (Ember key) and **8** (disease.sh) stay parked.
