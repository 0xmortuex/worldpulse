# Open questions

Decisions that are not mine to make, surfaced during autonomous work so that work does not
stop for them.

## The protocol

During a long-running goal I **append here and keep going** whenever I hit:

- **a decision that isn't mine** — which of two defensible behaviours the app should have,
  what a policy should be, what something is called in the UI
- **a tradeoff with no clearly correct answer** — where both options cost something real
  and the choice depends on priorities I don't set
- **a defect whose fix would change specced behaviour** — the fix is clear, but shipping it
  means the app no longer does what a decision said it should

Each entry carries **enough context to answer without reading the code**: what was found,
why it needs a decision rather than a judgement call, the options with their costs, and my
recommendation where I have one. An entry that cannot be answered without opening the repo
is an entry I have written badly.

## What stops work immediately

Four things, and only four. Everything else gets appended and the work continues.

| # | Emergency | Why it cannot wait |
| --- | --- | --- |
| 1 | **Destructive or irreversible** | Deleting data, force-pushing over history, dropping a source's only copy. The cost of asking is a pause; the cost of proceeding cannot be undone. |
| 2 | **Licence violation** | Redistributing data a licence forbids, or shipping content whose terms we have not read. This project's non-commercial standing (decision 3) and its per-feed restrictions are load-bearing, and a violation is not fixed by a later commit — it has already happened. |
| 3 | **The app would assert a false fact to a user** | A wrong value rendered with confidence. Rule 7's category: absent provenance is loud and self-correcting, wrong provenance is silent and self-justifying. This is the failure the whole project is built to prevent, so it outranks finishing the task it was found during. |
| 4 | **A fix that would change specced behaviour** | **Upgraded from append-and-continue on 2026-08-14.** Shipping it means the app no longer does what a decision said it should, and a spec silently overtaken by a fix is a spec nobody can trust to describe the app. It stops instead of being recorded — the decision to change what was specced belongs to whoever specced it. |

> Item 4 previously sat in the append-and-continue list above and was moved here by explicit
> instruction. Both lists are kept in sync deliberately: a protocol that lives in one
> conversation while the file says something else is the failure this file exists to prevent.

A defect that is *latent* — real but not reachable by a user today, like the form-of-government
coin flip while the app makes no runtime fetches — is **not** an emergency. It is recorded
here or fixed in place, and the work continues.

## Status

**Eight open, one answered.** Questions 1, 2, 3, 5 and 6 remain open from the queue run and
the fetch-layer build of 2026-08-12. **Question 4 (P3) was answered on 2026-08-14** and is
kept with its answer rather than deleted. **Questions 7, 8 and 9 were raised on 2026-08-14**
during the overnight run: the goal statement that arrived without its content, whether to
register disease.sh with data frozen since March 2023, and the absence of a licence class
expressing non-commercial *and* share-alike together.

*(This line said "Five" while six were listed below it — a document asserting a false fact
about itself, which is the same category of defect as a panel asserting a false fact about a
country, in the one file whose job is to be read instead of the code. It is now written as a
breakdown rather than a single number, because a bare count is the thing that drifts.)*

---

## 1. UCDP slice storage — bundled dataset or Worker extract?

**Context.** The build-time extraction is written, pinned and fully accounted
(`scripts/extract-ucdp.mjs`, 417,968 events, 0 dropped). What it writes is undecided.
Measured, not estimated: naive per-country JSON is **134.0 MB** with Syria alone at
**28.0 MB**. A lossless dictionary + positional-array encoding takes it to **27.5 MB**
total, Syria to **5.8 MB**.

**Why it needs you.** You directed a two-product shape — per-country conflict summaries
plus a binned globe point set — which is not yet built. But the encoding question survives
that decision: even summaries need a storage form, and 5.8 MB for one country is either
acceptable as an on-demand fetch or it is not. That is a product judgement about what a
visitor should be asked to download.

**Options.** (a) Encoded per-country slices, 27.5 MB total, worst case 5.8 MB on selection.
(b) Per-country-per-year, worst case ~1.2 MB — Syria's busiest year is 18,649 events.
(c) Summaries only, with event detail deferred to a Worker endpoint.

**My recommendation:** (c), because nothing in the spec renders individual events and two
things render derivations of them. **Not built either way** — writing 134 MB, or picking a
threshold and burying it, are both worse than asking.

---

## 2. San Marino renders a flat refusal

**Context.** San Marino returns **six** concurrent heads of state where its constitution
provides **two** Captains Regent. The multi-holder guard refuses rather than picking, which
is honest but not maximally useful: "six holders" is a fact about Wikidata's data quality,
not about San Marino.

**Why it needs you.** Rendering it as a *discrepancy* — six observed against a cited two —
requires an override recording the constitutionally expected count with a citation. That is
the rule-1 override mechanism, and O1 requires a constitutional or statutory citation, not a
consensus. Supplying that citation is a judgement about sources, not a parsing decision.

**Explicitly not done:** inferring the expected count from the data. That is the post-hoc
rule this project already refused, in a smaller costume.

---

## 3. Commonwealth realms render a shared monarch with no indication it is shared

**Context.** Charles III is head of state of 24 states and territories, Willem-Alexander of
4, Frederik X of 3. Each renders correctly today — he genuinely is their head of state — but
a reader of Jamaica's dossier sees the same portrait as Canada's with nothing connecting
them.

**Why it needs you.** D8 records the decision to render the relation. What it does not settle
is the *wording*, and the wording carries the meaning: "one of 24 states and territories"
counts crown dependencies alongside sovereign states, which rule 22 says must be made
explicit. Andorra is a different arrangement entirely (D7) and must not share phrasing.

**Not built** — it is rendering work, and the queue excluded feature work.

---

## 4. P3 — missing-data propagation through derived facts

**Context.** `DerivedProvenance.inputs` is `Provenance[]`, not `Fact[]`, so a derivation
cannot see that an input came back empty. Recorded since step 7 as a modelling gap rather
than an oversight.

**Why it needs you.** Closing it changes the shape **every adapter emits** — either
`inputs: AnyFact[]` or a per-input state recorded beside each provenance. That is a
breaking change to the fact model, affecting every source, and it is scheduled to land with
the step-12 choropleth. Doing it now inside a queue that excludes feature work would be a
large uninstructed refactor.

**Recommendation:** leave until step 12 forces it, as recorded. Raised here only so the
deferral is a decision rather than an omission.

### ANSWERED — 2026-08-14

**`DerivedProvenance.inputs` changes from `Provenance[]` to `Fact[]`**, as part of the
batched `Fact`-model migration in `SPEC-EXPANSION.md` Phase B.

The recommendation above was right about the trade and wrong about the moment. The
objection was that this is a large uninstructed refactor mid-build — but B3 (the
`UNVERIFIED` tier) and B4 (coordinate precision binding) each migrate the same model, and
**three migrations of one model batched into one is precisely when the trade flips.** One
migration, one test sweep, all three gaps closed. Shipping B3 alone would migrate the model
twice.

**The rule as originally written stands:** missing data propagates through required inputs;
a shortfall among contributing inputs renders as a **caveat, never silently absorbed**.

**The relations panel's disclosure caveat comes off only when the propagation actually
works**, not when the code lands. The **San Marino** case (question 2 above) and the
relations-score cases become its **first test fixtures** — so the caveat's removal is
evidence-gated rather than asserted.

---

## 5. The marker-click mechanism is located but unexplained

**Context.** The DOM click reaches the canvas every time; globe.gl's `onPointClick` never
fires on a failure; `facesCamera` is `true` in all 12 instrumented trials. The loss is
inside globe.gl's raycast. Three hypotheses were tested and refuted — camera damping,
marker drift, stale tooltip.

**Why it needs you.** L11 records a cheap defence (resolve from the last hovered point) as
noted-and-not-built, because a fix without a mechanism would be a fourth guess after three
refutations. Whether to ship an unvalidated mitigation for a check that fails ~40% of runs
is a judgement about tolerance for an unexplained fix, not a technical one.

**The suite stays red on it**, which is the honest state and was directed.

---

---

## 6. Does `nodata` carry an "as of" date?

**Context.** `asOf` dates the data. Four states now suppress it — `broken` (a confident date
lends legitimacy to a value that must not be trusted), `unconfigured` and `unavailable` (no
data was received for a date to describe). `nodata` still shows it, and that is a judgement
call rather than an oversight.

**Why it needs you.** Both readings are defensible and they render identically:

- *"no data, as of 2024"* dates **the release we queried** — true and useful. The World Bank
  published its 2024 series and this country has no value in it.
- Or it dates **an absence**, which is the same objection that removed it from the other
  three states.

The distinction is whether `asOf` describes the *query* or the *value*, and the fact model
does not currently say. `Fact.asOf` is documented as "the date the DATA refers to", which
leans toward the second reading and therefore toward suppressing it.

**Behaviour is unchanged pending a decision** — `stateCarriesAsOf('nodata')` returns `true`
with the reasoning recorded inline. I did not change it, because it is shipped behaviour on
every panel and the queue's rule is that a finding does not become a silent behaviour change.

**My recommendation:** keep it, and clarify `Fact.asOf`'s contract to say it dates the source
release rather than the individual value — which makes the current behaviour correct and the
other three suppressions still correct, since in those cases there was no release consulted.

---

## 7. The overnight goal was set without its content

**Raised 2026-08-14, overnight run.** The instruction establishing the overnight protocol —
no human available, judgement calls recorded here and worked past, four emergency stops —
did not state the goal itself.

**Assumption taken, so work could continue rather than stall until morning:** the standing
approved sequence from `SPEC-EXPANSION.md`,

> disease.sh/WHO → UNHCR → KEV → Ember → batched `Fact`-model migration (B1+B3+B4+P3) →
> FIRMS → rest of Phase A

which was approved explicitly and was the next item when the instruction arrived.

**Why this is the safe reading.** It continues work already sanctioned rather than opening
anything new, every item passes the same gate, and nothing in it touches the four emergency
categories. If a different goal was intended, the cost is one night on approved work rather
than a night on the wrong thing.

**What would change it:** any statement of the intended goal. Recorded here rather than
assumed silently, because a session that invents its own objective and reports progress
against it is indistinguishable from one that was told to do it.

---

## 8. disease.sh: register a source whose data froze in March 2023?

**Raised 2026-08-14, overnight run.** `SPEC-EXPANSION.md` Phase A2 pairs disease.sh with WHO
Disease Outbreak News as "the foundation of biohazard mode". Measured, the two are in
completely different states, so they cannot enter the gate as one item.

**WHO DON is live** — OData, `ACAO: *`, newest entry dated the day it was checked. Taken
through the gate on its own.

**disease.sh is frozen.** Its cumulative COVID series ends **2023-03-09**; `todayCases` is `0`
for all 231 countries simultaneously; its `updated` field reports "0 hours ago" regardless;
and the influenza endpoints its homepage advertises return 404. Full measurement in
`FOUND.md`.

**Why this needs you rather than a judgement call.** It is a question about what the app is
for, not about parsing:

| Option | Cost |
| --- | --- |
| **(a) Do not register it.** | Loses nothing that is current, but the spec named it, so declining is a spec change. |
| **(b) Register with hard staleness labelling** — every value carries `as of 2023-03-09` and renders through the existing stale treatment, `todayCases` never rendered at all. | Honest, and the app already has the machinery. But it ships a panel of three-year-old numbers whose only honest reading is "this is history", which may not be what "biohazard mode" was meant to be. |
| **(c) Register as historical-only**, explicitly framed as the 2020–2023 pandemic record rather than current surveillance. | Truthful and possibly useful, but it is a different feature from the one specced. |

**My recommendation: (b) or (c), not (a)** — the data is real and the app's staleness
treatment exists precisely so old data can be shown honestly rather than hidden. But **the
`updated` field must never reach a badge**, under any option: it is a fresh timestamp over
frozen data, which is the wrong-provenance failure rule 7 calls worse than no provenance.

**What I did in the meantime:** took WHO DON through the gate alone and left disease.sh
unregistered. Registering a source is cheap to do later and expensive to undo once a panel
depends on it.

**Also unresolved by this question:** the item's acceptance criterion — that "no reported
cases" and "no surveillance data" render differently — was written for disease.sh, and this
source cannot express a true reported zero. If disease.sh is dropped, that criterion needs a
different source to land against (UNHCR and FEWS NET both have genuine zero-versus-absent
distinctions).

---

## 9. No licence class expresses "non-commercial AND share-alike"

**Raised 2026-08-14, overnight run, while registering WHO Disease Outbreak News.**

WHO publications are **CC BY-NC-SA 3.0 IGO** — attribution, non-commercial, and share-alike
together. The registry's classes treat two of those as alternatives:

| Class | Meaning |
| --- | --- |
| `nc` | Non-commercial only. Must be isolated behind its own adapter so a change in project status means swapping one module. |
| `share-alike` | Copyleft. Derived datasets inherit the licence. Must be stored separately and never merged into a general-purpose derived table. |

**Both constraints are real for this source and each class drops one.** `nc` loses the
copyleft obligation on derived tables; `share-alike` loses the isolation requirement that
exists so a change in the project's commercial standing is a one-module swap.

**What I did:** classified `who-don` as `share-alike`, because that is the constraint that
shapes *code* — where derived data may live — while non-commercial is currently satisfied by
the project's standing (decision 3) rather than by any structure. The non-commercial term is
recorded in the `license` string and in `notes`, so it is not lost, only unenforced.

**Why it needs you.** This is the same shape as the `restricted` split decided earlier today:
one name covering two postures means neither can be checked. The options:

| Option | Cost |
| --- | --- |
| **(a) Add `nc-share-alike`** | Consistent with the `restricted` split; a fourth class to keep straight, and it will want its own guard. |
| **(b) Make classes composable** — a list rather than one value | Correct in principle, and a schema change touching every source and every consumer of `licenseClass`. |
| **(c) Leave it** — classify by the stricter structural constraint, record the rest in prose | Cheapest; the isolation requirement for NC sources becomes documentation rather than a check, which is how `restricted` drifted in the first place. |

**My recommendation: (a)**, on the precedent set today — but not taken unilaterally, because
adding classes is a schema decision and the last one came with an enforcing guard, which this
would also need. Cloudflare Radar (CC BY-NC) and CIVICUS (CC BY-SA) in Phase A will land on
the same question, so it is worth settling before they arrive rather than after.

### Update 2026-08-14, later the same night — a second, independent block

disease.sh's **data licence could not be established**. `github.com/disease-sh/API` is
GPL-3.0, but that is the API's source code, not the data it serves; `disease.sh/docs/` is
JS-rendered and was not read; and the data is aggregated from third parties (JHU CSSE,
Worldometers) that disease.sh may have no standing to relicense. Full measurement in
`FOUND.md`.

So the question above now has **two independent blocks**, either sufficient on its own:

1. the series has been frozen since 2023-03-09 while the API reports a fresh timestamp
2. the terms of the data are unread

Block 2 is the harder one. Registering would ingest content whose licence nobody has read,
which this file's own emergency table calls a stop rather than a note.

**Action taken:** disease.sh remains unregistered, and the item's rule 30 acceptance
criterion — that "no reported cases" and "no surveillance data" render differently, with a
country that never reported rendering as the second — **has been moved to UNHCR**, which has
a read CC BY 4.0 licence and a genuine zero-versus-absent distinction in its own data.

**Why moving it is faithful rather than convenient.** The criterion describes a behaviour of
the app's fact layer, not of one vendor: an absence must never render as a zero. disease.sh
would have been a poor place to prove it anyway, since it has no true reported-zero state to
contrast against. What disease.sh *did* contribute is the clearest possible statement of why
the rule exists — its own 404 body reads "Country not found or doesn't have any cases",
conflating the two states at the source.

**To un-block:** a reading of the data terms (not the code licence), plus a decision on
whether three-year-old figures belong in the app at all.

---

## 10. UNHCR's licence could not be read; the spec's CC BY 4.0 is unverified

**Raised 2026-08-14, overnight run.** `SPEC-EXPANSION.md` Phase A3 records UNHCR Refugee Data
Finder as "keyless JSON, CC BY 4.0". That is a spec claim, and per **L15** a claim is not a
reading. The reading was attempted and failed:

| Where | Result |
| --- | --- |
| `unhcr.org/refugee-statistics/insights/explainers/terms-of-use.html` | **403** from this network |
| `unhcr.org/terms-and-conditions` | **403** |
| `api.unhcr.org/docs/refugee-statistics.html` | 200, 293KB of text, searched in full: **no `CC BY`, no `Creative Commons`, no copyright statement** — only the Apache licence of the OpenAPI generator that rendered the page, which is the tooling, not the data |

**What I did:** registered as **`restricted-minimal`**, not `open`. That class permits exactly
what this app does with the data — figures rendered with attribution and a link back, never
bulk redistribution — so it costs nothing today while over-claiming nothing.

**The asymmetry is the argument.** Under-claiming rights is recoverable: if CC BY 4.0 is
confirmed the class is upgraded and more becomes permissible. Over-claiming is a licence
violation that has already happened by the time anyone notices. Same reasoning as the
PortWatch reading, and the same as attributing a caveat to ourselves rather than to the IMF.

**What would settle it:** reading the terms from a network UNHCR does not 403, or a statement
in the Refugee Data Finder's own download UI. If CC BY 4.0 holds, change `licenseClass` to
`open` and drop the `restricted-minimal` note — nothing else in the adapter depends on it.

**Note for whoever answers this:** two of Phase A's remaining sources (Ember, CC BY 4.0; and
Cloudflare Radar, CC BY-NC) arrive with the same shape of claim. It is worth deciding once
whether a spec-asserted licence may be trusted when the terms page is unreachable, rather
than three times separately.

---

## 11. Ember needs an API key that cannot be provisioned autonomously

**Raised 2026-08-14, overnight run.** `SPEC-EXPANSION.md` Phase A7 records Ember as "CC BY 4.0,
free key, 215 countries". Everything about that is accurate, and the key is the block.

**What was completed without it:** registered with the licence **read and verified** (CC BY
4.0, from `ember-energy.org/creative-commons/` — a genuine reading, not a spec claim and not
rule-derived per L15), probed with a verdict (**KEY-GATED**, HTTP 403 `{"detail":"No API key
set"}`), transport declared `worker`, and the shape hazards documented in `FOUND.md`.

**What could not be completed:** a live fixture, a contract test against real bytes, and an
adapter. `verifiedAgainst` is therefore **`documentation`**, which blocks deployment by design
(A6) and is the honest state — no response from this source has ever been seen by this repo.

**Why the keyless path does not rescue it.** Ember publishes bulk CSVs without a key, but
neither sends `access-control-allow-origin`, so a browser cannot read them, and they are 16.0MB
and 4.1MB. Worker-required, and the Worker does not exist. Full measurement in `FOUND.md`.

**What is needed from you:** a key at `api.ember-energy.org`, placed in `EMBER_API_KEY`. The
registry entry already names that variable, so the remaining gate steps are mechanical once it
exists.

**One judgement inside this, if you would rather not issue a key:** the app could take Ember
through the Worker from the public CSVs instead, which needs no key but does need the Worker
built and a 16MB file handled server-side. That is a different piece of work from "register a
source", and it is not obviously the right trade for a generation-mix row.

---

## 12. How should the globe encode low confidence, given it has only one channel?

**Raised 2026-08-15 during B1.** The relations layer encodes two things in hue — tier (5) and
confidence (2) — and ten colours cannot all be distinguished under dichromacy. Measured:
`adversary` base collides with `strained` low-confidence at **ΔE 9.7 under protanopia**. Full
measurement in `FOUND.md`.

**Everywhere except the globe this is already solved**: the relations list carries glyph, label
and the `low conf.` tag, so hue is decorative there. A polygon fill has no second channel.

| Option | Cost |
| --- | --- |
| **(a) Accept it.** The popover names the tier, so nothing is knowable only from the fill. | A reader scanning without hovering can misread confident-adversary as unconfident-strained. Cheapest, and honest only because the popover exists. |
| **(b) Drop the low-confidence hues; encode confidence as a pattern or stroke.** | globe.gl polygon fills do not take patterns; this likely means a stroke treatment or an overlay layer, which is real work and may not read at small polygon sizes. |
| **(c) Drop low-confidence from the globe entirely**, keeping it in the list. | Loses a signal decision 8a called load-bearing: "a classification resting mostly on stale inputs renders in a distinct low-confidence treatment". Changing that is a spec change, not an implementation choice. |

**My recommendation is (a) for now and (b) when the globe next gets work**, because the
information is not lost — it is one hover away — and (c) contradicts a standing decision.

**Why this is yours and not mine:** (c) would overturn decision 8a, and (b) trades a real
amount of rendering work against a defect that only affects one of ten colour pairs for one of
three dichromacies. Neither is a judgement I should make silently while implementing a palette.

---

## 13. The relations engine cannot represent "consulted and came back empty"

**Raised 2026-08-15 while implementing P3.** P3's central case — missing data propagating
through a derivation — is **structurally unreachable in the layer that motivated the whole
migration.**

`ScoredInput.weight` is `number`, never `null`, and a finding that has no value is simply
absent from `result.inputs`. So the relations engine has one representation for two different
facts:

| Fact about the world | How the engine records it |
| --- | --- |
| We never consulted this finding | not in the array |
| We consulted it and it had no value | **also not in the array** |

**That is rule 30 conflated by omission** — no answer and an answer of none, stored
identically. It is the same distinction the app enforces everywhere else and does not enforce
in its own scoring engine.

**Why it does not bite today:** relations run on a hand-checked seed table where every entry
has a weight by construction. Nothing is fetched, so nothing can come back empty.

**When it will bite: step 10**, when relations move to live ingests. At that point a source
that answers with no value becomes possible, and the engine will silently score around it —
producing a confident classification from fewer inputs than it consulted, which is precisely
what P3 was written to prevent.

**Shape of the fix, one line:** give `ScoredInput` (or the findings array) a representation for
consulted-and-empty — either `weight: number | null` with the empty entries retained, or an
explicit `consulted but no value` variant. Either makes the contributing-shortfall caveat
reachable, and `contributingShortfall` already handles it.

**Deliberately not fixed now.** Commit 5 is P3's semantics; changing the relations input model
is a change to the scoring engine and belongs with the live-data work that makes it matter.
Recorded so it is a decision waiting for you rather than a rediscovery at step 10.

---

## 14. A goal's acceptance criterion required evidence that cannot exist

**Raised 2026-08-15, at the close of the Fact-model migration.** Recorded because an
unsatisfiable acceptance criterion is a decision for the person who set it, not something to
argue with or work around.

The migration goal required **"both P3 fixtures shown rendering caveated"**: a relations score
with a `nodata` input, and San Marino's six-versus-two discrepancy. Every other criterion was
met — five commits in order and unsquashed, typecheck exit 0, 583/583 tests, commit 4 per-step
identical to commit 3, commit 5's verify at 282 assertions with only the known L9 failure, tree
clean and pushed.

**Neither fixture can be produced, for different reasons, and only one is even unblockable:**

| Fixture | Why not | Unblockable? |
| --- | --- | --- |
| Relations score with a `nodata` input | `ScoredInput.weight` is `number`; an absent finding is absent from the array rather than present-and-empty | **Yes** — by question 13's fix, which was explicitly reserved as "a decision waiting for me" |
| San Marino rendering caveated | It is a leader-resolution refusal. `resolve.ts` returns `undetermined`; there is **no `DerivedProvenance` anywhere in that path** for a P3 caveat to attach to | **No.** Not by any permission — only by inventing a derivation that does not exist |

**Why this was not worked around.** The two available routes were to change `ScoredInput`
(taking a decision reserved to the human) or to construct a derivation solely so an assertion
could pass. The second is the failure rule 6 names: a fixture manufactured to make a check go
green proves the check, not the app. This project has spent four sessions removing exactly
that class of vacuity — a mutation scored from another step's failures, a guard watching a
detached node, a wait that returned true early. Adding one deliberately to clear a checklist
would undo the argument for all of them.

**What is needed from you — any one of these closes it:**

1. **Amend the criterion** to the reachable case, which is what was actually built and asserted:
   a derivation whose *required* input came back empty, rendered in the gallery with a positive
   control. This is the honest statement of what P3 proves today.
2. **Approve question 13** — give `ScoredInput` a representation for consulted-and-empty. That
   makes fixture 1 real, and it is worth doing on its own merits before step 10 regardless.
3. **Drop fixture 2**, on the grounds that San Marino already refuses and did so before P3
   existed — the system having worked without the rule, not a gap the rule fills (P13, and
   `UNEXERCISED-PATHS.md` §14).

**My recommendation: 1 and 3 now, 2 with the step-10 live-data work.** Fixture 2 should be
struck from any future goal text rather than carried forward, because it has now been asserted
across several sessions and is the clearest instance of P13 — a planned fixture that acquired
authority by repetition and was never checked against the tree.
