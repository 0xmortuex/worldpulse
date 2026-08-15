# Proposed next goal — step 8, the Military tab

Written per S6 at the close of the Phase A goal: approving the next goal should be an edit, not
a reconstruction. Sized for 8+ hours unattended (S5).

## The previous goal, and how it closed

**Item 2's condition was AMENDED BY DECISION** — recorded in `OPEN-QUESTIONS` 26, per S7.

| | |
| --- | --- |
| **As originally written** | *"The remaining Phase A batch… each through the full gate"* — **unsatisfied**, and not reinterpreted |
| **As amended** | *"every Phase A source is through the gate OR recorded with its blocker per the riksdagen/Ember precedent"* — **satisfied** |

Of the ten sources listed in that batch, **two went through the gate** (OONI, Feodo Tracker);
FIRMS went through as item 1, listed separately. Two more are registered and parked, six are
blocked before registration, and every blocker is one action deep in `OPEN-QUESTIONS` 22–27.

**Those actions are the reviewer's and do not gate this goal.** The reviewer's stated reasoning
for amending rather than pressing on: *forcing six conversions through guessed endpoints and
inferred licences would have manufactured the conjunction at the cost of everything the gate
means.*

---

## Part 0 — what carries forward

| Item | State |
| --- | --- |
| Four unguarded live flags | **closed** — `LIVE WITHOUT COVERAGE` in the deploy gate is 0 |
| `--only` on verify | **built** — 17 assertions in 10.4s against 287 in 98.4s |
| Mutation suite | **clean** — 11 caught by name, 0 survived, ~20 min |
| `OPEN-QUESTIONS` 22–27 | reviewer's actions; none blocks step 8 |
| FEWS NET | **unblocked after this goal closed** — `ipcpopulation` works; four hazards recorded, adapter unwritten |

**FEWS NET is the one loose thread from Phase A that needs no human action.** Its endpoint is
found and its hazards are measured; it is an adapter's worth of work whenever it is wanted.

---

## Part 1 — Step 8, the Military tab

`BUILD-ORDER.md` step 8: personnel and expenditure (World Bank / SIPRI-derived), FAS warhead
estimates, chain of command, force posture from DMDC and UN Peacekeeping, and the generated
no-equipment-data card.

### The fixture hard cases come FIRST, as originally specced

Not as a test pass after the panel renders. Each is a claim about what the panel must not say:

| Hard case | What it prevents |
| --- | --- |
| A country with **no armed forces** | an empty panel reading as missing data rather than as a fact about the country |
| **Expenditure without personnel**, and the reverse | a partially-answered panel rendering as though complete |
| **C-in-C is the same person as the head of government** | the same person rendered twice as two offices, or one silently dropped |
| **Ceremonial vs operational** command | a constitutional figurehead presented as an operational commander |
| **Non-NPT and undeclared** nuclear states | an estimate rendered with the confidence of a declaration |
| **Zero recorded overseas presence** → **"none recorded"**, never "none" | rule 30 in its sharpest form: no answer is not an answer of no |

**The last one is the acceptance criterion for the whole step.** "None recorded" and "none" are
different claims about the world, and the panel must be incapable of the second.

### What the Phase A batch taught that applies here

The sources behind this tab are the ones already registered — World Bank, and whatever SIPRI
and FAS derivations get built. **The five hazards from the conversion queue apply unchanged**,
and two are especially live for military data:

- **Aggregate discriminators** (rule 38) — NATO totals beside member states is the same
  double-count as Ember's series and Comtrade's HS lines.
- **A tier follows what the source declares.** FAS warhead figures are *estimates* and say so;
  rendering them as `OFFICIAL` would be authoring confidence, and rendering a declared figure
  as `ESTIMATE` would be authoring doubt. Both were live errors this session (Ember, Comtrade).

---

## Part 2 — FEWS NET, if the hard cases land early

Adapter only, no surface — the PortWatch precedent. Its four hazards are already measured:

1. `data_usage_policy` is **per record**; `Restricted` exists and must be filtered, not assumed
2. `scenario` — **150 of 207 rows are forecasts** (`ML`, `PN`); `CS` is current status
3. `phase: "3+"` is a **threshold**, not a phase
4. `admin_0…admin_4` is the aggregate discriminator

---

## Acceptance criteria

- Every step-8 fixture hard case exists as a fixture and is asserted, hard cases before panel
- "None recorded" versus "none" asserted in the browser, per P12
- Tier decisions commented at each construction site, with the source's own declaration named
- `npm run typecheck` exit 0; `npm test` exit 0 with count and census clean
- `npm run verify` full-run per-step table, no failure outside the known L9 cluster
- `npm run mutate` per S4 before the close
- `git status --porcelain` empty, nothing unpushed
- `OPEN-QUESTIONS.md` holds every deferred judgement with context

## Constraints

No Fact-model changes. No steps 9–14. No WarWatch. Nothing fixed by widening a type, adding
`any` or a cast, loosening an assertion or tolerance, adding a skip, or deleting a failing
check. No fixture edited to match live data without recording the contradiction first. **File
content through Edit/Write, never shell interpolation** (rule 41). Findings to `FOUND.md`
without reprioritising.

## Launch condition

**Nothing here needs a decision.** Step 8's hard cases are already specced in `BUILD-ORDER.md`,
the sources are registered, and every open question is either the reviewer's to action or
carries a guard that fires on its own. Step 9 is separately blocked and explicitly out of scope.
