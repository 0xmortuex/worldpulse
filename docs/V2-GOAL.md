# V2 — the committed plan, to project completion

**S1's scope freeze is lifted by reviewer decision, 2026-08-16.** v1.0.1 is tagged and
complete; this file is v2's full scope and the definition of done for the project.

**On conflict, `DECISIONS.md` wins and the conflict is recorded here.** This file is a plan;
that file is the ruling record, and a plan that quietly overrides a decision is how a
decision stops meaning anything.

---

## How to read this file

| Part | What it is | When it changes |
| --- | --- | --- |
| **The five sections** | the work, in the order it runs | when the reviewer re-sequences |
| **The battery** | the same checks at every boundary | when the harness changes cost (S4a) |
| **Standing constraints** | how the work is done, everywhere | rarely; each has a measured failure behind it |
| **Standing prohibitions** | what must never be built, verbatim | never — these are the project's identity |
| **The report format** | how completion is declared | never |

Per S7, conditions are stated against **documents that can absorb an amendment** — a gate
table, the battery, `OPEN-QUESTIONS.md` — rather than against named artefacts a later decision
might strike.

---

# Section 1 — The two features the blink fix queued

These came from first real user testing and go first because they were found by using the
app, which is the evidence this project trusts most.

## 1.1 First-run guided tour

Walks a new user through **every surface**: the globe (selection, multi-select, relations mode
and what the colours mean), the dossier tabs, layer toggles and the time window, the
choropleth, the time scrub, the watchlist, the news board — and, **critically, the provenance
system**: what tier badges mean, how to open the inspector, why some panels say "no data
ingested" and why that is honesty rather than an omission.

| Requirement | Detail |
| --- | --- |
| Shows once | `localStorage` flag |
| Skippable | at every step, not only at the start |
| Relaunchable | from a help button in an obvious place |
| Keyboard-navigable | complete, not partial |
| Reduced motion | respects `prefers-reduced-motion` |
| Data-driven | steps in a data file, so a new panel extends the tour rather than orphaning it |

**Every claim the tour makes is asserted in a browser test against the real UI.** A tour
describing a feature that moved is a doc-versus-tree defect with a spotlight on it — the worst
version of that class, because a new user meets it first and has no way to know it is wrong.

## 1.2 Universal list views

**Every collection the app renders visually must also exist as a clear, complete, browsable
list**: all events across all layers (filterable, sortable), all countries with their key
facts, all sources with their status and licence, all watchlist entries, all news items.

This is the accessibility parallel-table requirement (B6) promoted to a **first-class
feature**. The lists are not a fallback for the globe — they are an equal surface, reachable
from an obvious place in the UI.

| Requirement | Detail |
| --- | --- |
| Provenance | the same badges the panels carry |
| Deep links | each row links to its subject, and the URL is shareable per B2 |
| Keyboard | complete |
| Seeds | the existing event feed and country list; the feature is making the pattern universal |

**A note on framing that changed under us.** These lists were specified partly as L9's standing
mitigation. L9 is now RESOLVED-BY-CAUSE-REMOVAL, so they are **no longer load-bearing for that
defect** — they are a second equal surface on their own merits, and the tour and the lists
should say so rather than inheriting language about a defect that no longer reproduces.

---

# Section 2 — SPEC-EXPANSION Phase C, all six

## 2.1 2D flat-map fallback
Shares **layer data and selection state** with the globe — one source of truth, two
renderings, or they will disagree. **Auto-switches on unsustainable frame rate**, and the
switch is disclosed rather than silent: a reader who is moved to the flat map must know why.

## 2.2 Population-exposed significance
HDX/WorldPop intersected with event footprints, **added alongside** the coverage score rather
than replacing it, and **decomposable in the inspector** per the no-composite-scores rule.
Sequenced against `SPEC-BREAKING-NEWS`'s ranking — one significance concept, not two competing.

## 2.3 Humanitarian dossier tab
ReliefWeb + HAPI + FEWS NET/IPC + IOM DTM. Every figure tiered per source, per row. The
IPC/FEWS phase classification is a **stated scale**, not a number to average.

## 2.4 Governance layers
UN voting alignment, election calendar, CIVICUS, press freedom. **Press freedom displays
as-is** under its ND licence — no derivation, no recombination, no recomputation into another
index.

## 2.5 Freshness monitor
**Generated from the registry**, not hand-maintained, so a new source appears in it
automatically. A monitor that has to be updated by hand is one that will silently stop
covering things.

## 2.6 Command palette
Keyboard-first navigation to every surface. Reuses the list views' data.

---

# Section 3 — SPEC-WARWATCH, all eight, in its build order

## 3.1 Market ticker
**Phase-0-style source survey first, licence before provider.** Symbol list is a registry file
per the spec's data-driven requirement, never hardcoded.

## 3.2 Intel feed
**Reuses the news-board scoring engine** — one ranking concept for the project.
**Severity computed, never authored.** Future timestamps render as **unavailable**, never as
"in 2 hours"; the spec notes the reference implementation gets this wrong and says explicitly
not to copy it.

## 3.3 Dashboard
**Local-only, no accounts.** No server-side user state of any kind.

## 3.4 Biohazard mode
disease.sh / WHO. **"No reported cases" and "no surveillance data" are distinct renderings** —
rule 30 in the place where conflating them is most dangerous.

## 3.5 Polymarket
**Labelled as prices, never as probabilities.** A price is what someone paid; a probability is
a claim about the world, and the two are not the same fact.

## 3.6 Public cameras
**LINK-OUT ONLY**, per the amended spec. Titled **"Public Cameras"**, never "war cams" (W1): a
camera pointed at a city is not a view of a conflict, and framing it as one invites viewers to
read ordinary footage as combat.

## 3.7 Conflict-mode presets
**Reuses the relations palette.** **No composite threat score, ever** — the prohibition below
is absolute and this is the surface most likely to tempt it.

## 3.8 Broadcast-traffic mode — LAST, and deliberately so
The Hormuz view on IMF PortWatch. **The panel the adapter has waited for since P1/P2.** Carries
its five inherited requirements from the spec amendment, and this disclosure **verbatim**:

> ### THIS IS NOT MILITARY TRACKING AND IS NEVER LABELLED AS SUCH.
>
> Military vessels and aircraft routinely disable or spoof AIS and ADS-B. A tracker built
> on these shows the traffic that is **broadcasting** and silently omits the traffic that
> matters — the empty-cabinet bug in the highest-consequence place it could occur.

**Built without time pressure, as the spec demands.** It is last because it is the one where
haste would do the most damage.

---

# Section 4 — The parked-source sweep

Each entry is a source or gap already measured and recorded; none is new speculation.

| # | Item | What it needs |
| --- | --- | --- |
| 4.1 | **theyvoteforyou** | retry past the Cloudflare block with the literal-slash key form |
| 4.2 | **opensanctions** | the dataset decision, then an adapter |
| 4.3 | **IODA** | the licence dig through its JS bundle — reachable-but-licence-unreadable, parked at #24 |
| 4.4 | **ReliefWeb** | the appname, once the reviewer provides it |
| 4.5 | **IOM DTM + UN voting** | endpoint research to replace guessed URLs — recorded at #27 as a SPEC DEFECT, not an access problem |
| 4.6 | **§14's live-empty provider** | so `contributingShortfall` gets a real caller and `p3-reachability` flips |
| 4.7 | **SAU's `P194`** | documented upstream to Wikidata if fixable there — its entry points at the government, which reaches no chamber type at any depth including unbounded |

---

# Section 5 — The finish

1. **A final full sweep**: doc-versus-tree audit, accessibility, bundle budget, **the mutation
   suite extended to every new surface under rule 34**, and contract tests for every new
   source.
2. **Deployment** per the Cloudflare plan already drafted.
3. **Probe re-run from the deployed origin**, per rule 20a — a CORS verdict measured from a
   developer's laptop is a property of that laptop, not of the deployment.
4. **A final `=== FOR THE REVIEWER ===` section declaring the project COMPLETE**, with every
   remaining limitation disclosed.

---

# The battery, at every goal boundary

| # | Check | Passing means |
| --- | --- | --- |
| 1 | `npm run typecheck` | exit 0, both projects |
| 2 | `npm test` | exit 0, count and census clean |
| 3 | `npm run verify` | full-run per-step table, no unexplained failure |
| 4 | `npm run audit` | doc-versus-tree, all checks |
| 5 | bundle budget | every chunk within its stated budget |
| 6 | `npm run mutate` | per S4a — full suite before a push or a goal close |
| 7 | `git status --porcelain` | empty |
| 8 | nothing unpushed | `git log @{u}..` empty |

**Read every gate bare, never through a pipe** (rule 44) — `gate | tail && commit` is
`commit`. **Run the full suite, not `--only`**, before concluding anything about a regression:
a filtered run misled this project three times in one session, twice by matching nothing and
running everything.

**L9's canaries now pass and stay in place.** A failure there is a regression, not the known
defect.

---

# Standing constraints

- **The full gate, always**: licence actually read per **L15** → probed → live fixture captured
  via the app's own builder → contract test with planted cases → adapter with tier decisions
  commented → the `verifiedAgainst` flip in its own commit. **A source that cannot pass is
  recorded with its blocker, not forced** — the riksdagen and Ember precedents.
- **Nothing is fixed by weakening the check.** No widening a type, no `any`, no cast, no
  loosening an assertion or tolerance, no adding a skip, no deleting a failing check.
- **The fixture-contradiction rule (D6)**: fixtures are a permanent regression suite; a live
  contradiction is a finding to investigate, not a fixture to update.
- **Route around and record**: a decision that is not mine, a tradeoff with no clearly correct
  answer, or a fix that would change specced behaviour goes to `OPEN-QUESTIONS.md` **with
  enough context to answer without opening the repo**, and the work continues. **Four things
  stop work immediately** — destructive or irreversible actions, a licence violation, the app
  asserting a false fact to a user, and a fix that would change specced behaviour.
- **Amended criteria (S7)**: when a decision amends a criterion a live goal depends on, the
  goal text is amended in the same breath.
- **Command shape (rule 41, four clauses)**: file content through Edit/Write never shell
  interpolation; scratch scripts written to a file then run with a short `node <path>`; never
  prefix a command with `cd` into the repo the shell is already in; **no quoted parentheses or
  braces, and no compound chains** — and never echo a summary the command already proves.
- **The tree guard (rule 45)**: the run lock protects the measurement's tree, not just its CPU.
  It starts itself; do not disable it.
- **Assert your own denominator**: every new check states that its input set is non-empty.
  Seven vacuous guards were caught by this reflex in one session.

---

# Standing prohibitions — verbatim, and absolute

From `SPEC-EXPANSION.md`'s invariants table:

| Invariant | Rule |
| --- | --- |
| **No authored content** | no summaries, no editorial framing, no invented prose |
| **No composite scores** | no derived score without visible, decomposable arithmetic |

And, carried from `SPEC-WARWATCH.md` and the reviewer's standing decisions:

- **No AI summaries.** Not of news, not of conflicts, not of countries, not anywhere.
- **No composite scores without visible arithmetic.** Including — especially — any
  instability, threat or risk index.
- **No military tracking**, and nothing labelled as such. The broadcast-traffic mode carries
  its disclosure verbatim.
- **No embedded conflict streams.** Public cameras are link-out only.
- **No casualty tickers.**
- **No single-source breaking elevation** — one outlet is not a finding.

These are not preferences to be traded against scope. They are what the project is.

---

# The final report format

The project's completion is declared in a single self-contained section, delimited exactly:

```
=== FOR THE REVIEWER ===
```

Everything below it must be answerable **without opening the repository**.

1. **Every `OPEN-QUESTIONS` entry needing an answer, quoted in full** — context, options with
   their costs, and a recommendation where there is one.
2. **Every goal condition marked** `MET` / `AMENDED` / `UNMET`, with evidence, the amending
   decision, or what it would take. **No fourth category and no unmarked rows.**
3. **Everything routed around** — every judgement call taken rather than escalated, every
   blocker recorded rather than forced.
4. **The final battery numbers** — actual figures, not adjectives, including why each skip
   was skipped and any survivor named.
5. **What the project does not include**, so "complete" means something checkable.
