# Handoff — 2026-08-14

Written on retirement of a remote session. The next session runs on a local machine with
GPU rendering and unrestricted egress, both of which change what is measurable here.

## Where things stand

**HEAD `b6de4bc`**, branch `claude/worldpulse-globe-dashboard-n3984g-0oxido`, tree clean,
nothing unpushed.

| Check | Result on `b6de4bc` |
| --- | --- |
| `npm run typecheck` | exit 0 (both configs) |
| `npm test` | 476 passing, 0 failing |
| `npm run verify` | 273 assertions, 0 skipped, only the known marker-click failure |
| `npm run mutate` | **incomplete — 8 of 11, all CAUGHT** (run stopped on retirement) |
| `npm run check:deploy` | blocks; 7 of 49 active sources are live or bundled |

The fetch layer is complete per `SPEC-FETCH-LAYER.md` and the economy panel renders live
World Bank data. Everything in that goal is verified except the mutation table.

## The in-flight mutation run

Stopped deliberately at **8 of 11, every row CAUGHT**, on `b6de4bc`. Its worktree, lock and
ports were released cleanly by the SIGTERM handler.

`.mutation-journal.jsonl` holds those eight verdicts keyed to `b6de4bc`. **Re-running
without committing anything resumes them and runs only the remaining three** — roughly 20
minutes rather than 65. Committing first invalidates the journal by design: reusing verdicts
across trees would assemble one table from several trees.

Rows still unmeasured on this commit: the second `7b` mutation, and both cross-cutting
mutations (rules 9 and 8).

### Do not read the history as "the suite cannot see these"

Every one of the eleven mutations has been observed CAUGHT on some run. There is no
mutation the suite is blind to. What kept failing was a harness that died before reaching
the last steps, and each fix moved that death later:

| Fix | Abort moved to |
| --- | --- |
| `clickOrFail` on step 7 toggles | step 7b, tab clicks |
| `clickOrFail` on 7b tab clicks | step 7b, partway |
| `textOrFail` on `.econ` innerText | step 7b, `innerHTML` one line later |
| `textOrFail` covering innerHTML | (8 of 11 clean when stopped) |

**Four distinct throwing calls at the same boundary, each visible only after the previous
was removed.** `grep -nE "await page\.locator\([^)]*\)\.(innerText|innerHTML|textContent|inputValue)\(\)" scripts/verify-render.mjs`
still reports **35 unwrapped waiting reads** elsewhere. They are less dangerous — an abort
in an early step only costs later steps — but "I fixed the one I tripped on" was wrong four
times, so wrapping them in one pass is the cheaper bet than discovering a fifth.

## Acceptance criteria that still stand

**Rule 34: a mutation whose named assertion did not execute is invalid regardless of the
arithmetic.** Concretely, reject any row that is:

- `SURVIVED` — the suite could not see the behaviour
- `NOT-EXERCISED` — the named assertion never ran
- `CAUGHT-ELSEWHERE` — something else failed; this mutation proved nothing

A table reading `0 SURVIVED, 0 inconclusive` is **not** sufficient on its own.
`CAUGHT-ELSEWHERE` is a classification, so it satisfies that arithmetic while proving
nothing — the run on `f0bede3` met the written gate exactly that way and was rejected.

## The six vacuity mechanisms removed

Each was found by a run failing, not by reading code. Each is now a pure function with
planted cases, and each would have let the gate certify something never measured.

| # | Mechanism | Guard |
| --- | --- | --- |
| 1 | A harness abort scored as a catch — a run with **zero** executed assertions printed `0 SURVIVED, 0 inconclusive` and exited 0 | `assertionsRun`, verdict `NOT-EXERCISED` checked before `exit === 0` |
| 2 | A mutation scored from **another step's** failures after its own step was skipped | `stepWasExercised` |
| 3 | A step-level count passing over a step that ran **3 of its 11** assertions | `namedAssertionRan` — scans executed `ok` and `FAIL` labels |
| 4 | An **inconclusive verdict resumed from cache** as though it were an answer | `isResumable`, deferring to `INCONCLUSIVE` |
| 5 | An **ambiguous anchor** silently editing a different code path than the mutation names | `anchorProblem`, CRLF-normalised on both sides, plus `--check-anchors` |
| 6 | Verdicts **assembled across commits** into one table | journal entries keyed on commit, discarded otherwise |

Rules 32, 32a, 32b, 33 and 34 in `TESTING.md` are the generalisations of these.

## Environment facts a fresh session should not rediscover

- **`PLAYWRIGHT_CHROMIUM_PATH` must be exported** here — documented but not set. Unset, the
  harness aborts before any assertion, which is how mechanism 1 was found.
- **Chromium cannot reach any live origin in this container** (`FOUND.md`). The live path is
  proven in Node under `PROBE_LIVE=1`; the browser drives deterministic scenarios.
  **On a machine with real egress this constraint lifts** — `UNEXERCISED-PATHS.md` §10 is
  the row to revisit first, and its wording must never become "live end-to-end in the app"
  without a browser actually doing it.
- **GPU rendering changes the flake.** The marker-click check is frame-rate sensitive and
  every recorded flake number came from software rasterisation (`--use-angle=swiftshader`).
  Rule 20a: a flake rate is a property of the app **under a harness configuration**. Re-measure
  rather than carrying any number in this repo forward. `WORLDPULSE_HARDWARE_GL=1` opts in,
  and was previously observed to change marker-pick behaviour — treat old results as void.
- **This container rebooted three times in one session**, losing `/tmp` and rolling the
  filesystem back to an older snapshot. Only pushed commits survived. The journal lives in
  the repo root to survive `/tmp` being cleared and **still did not survive a rollback**.
- **Liveness:** use `ps -eo args | grep -q "[s]cripts/mutation-check"`. `pgrep -f
  mutation-check` matches its own shell and reports a dead run as alive; that cost about
  forty minutes. The same self-match makes `pkill -f "vite preview"` kill the calling shell.
- **Measured on this box** (4-core Xeon 2.10GHz, software rasteriser, under the run lock):
  fastest 313s, median ~332s, slowest 510s per mutation; a full run ~3900s. Not transferable.

## Open decisions

`OPEN-QUESTIONS.md` holds six, all needing a human: UCDP slice storage (measured — 134 MB
naive, 27.5 MB encoded), San Marino's flat refusal, Commonwealth-realm wording, P3's
fact-model change, whether to ship an unvalidated marker-click mitigation, and whether
`nodata` carries an "as of" date.

`FOUND.md` holds five findings, of which two block later work: `buildLegislatureQuery` never
completes against WDQS for any country tried — a **query defect, not a slow source**, and it
blocks step 9 — and the browser-egress limit above.

## Suggested first moves

1. Export `PLAYWRIGHT_CHROMIUM_PATH`, then **re-run `npm run mutate` without committing** to
   resume the eight and finish the three.
2. If a row comes back unexercised, read the `FAIL <step> aborted:` line **before** retrying.
   Four times running, that line named the exact call to fix; retrying without reading it is
   what made this take eight runs.
3. Re-measure the marker-click flake under GPU rendering and record the configuration
   beside the number.
