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

### 1.1 Hardware GL becomes the default

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

### 1.2 Parallelise the mutation harness

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

**9** (no NC+SA licence class) blocks nothing but recurs at Cloudflare Radar and CIVICUS —
worth settling once. **13** (relations cannot represent consulted-and-empty) does not bite
until step 10. **11** (Ember key) and **8** (disease.sh) stay parked.
