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

### Update, 2026-08-15 — the consequence is larger than first stated

Re-derived from the tree rather than from the note above, and it is worse than "does not bite
today". `src/relations/provenance.ts:65` is the **only** `required: false` construction site in
`src/` — the other two derived inputs (`eonet.ts`, `wikidata-dossier.ts`) are `required: true`.
So no fact anywhere in the shipped app can satisfy `contributingShortfall`, and **both the
caveat in `provenance.ts` and the shortfall block in `inspector.ts:220` are unreachable code in
production.**

Commit 5 shipped a disclosure mechanism whose only caller cannot trigger it. The mechanism is
correct and has 12 planted unit tests; what is missing is a construction site able to express
the state. That does not change the disposition — the fix is still question 13's, still at step
10 — but it changes what the code claims about itself, so it is written down here rather than
inferred later from a passing test count.

**Now demonstrated rather than only tested.** A gallery entry renders the caveated state with
five browser assertions (a value that survives, the caveat note, and the inspector stating the
shortfall beside the arithmetic). It is built from a registered source, and it says in its own
comment that no production path reaches it — so the demonstration cannot be mistaken for
evidence that relations produce this today.

### Disposition, 2026-08-15 — STAYS ARMED for step 10, deliberately

Confirmed as still open rather than pulled forward, and for a reason stronger than sequencing:
relations run on a seed table, so **consulted-and-empty does not genuinely occur until live
fetches do.** Giving `ScoredInput` the representation now would build a second mechanism
waiting for a caller — the precise shape of the finding this session produced. One dead branch,
documented as waiting, is better than two.

`tests/p3-reachability.test.ts` now enumerates the contributing-input sites and **fails when
this question is answered**, naming the gallery stand-in to replace. The reminder is attached to
the condition that makes it actionable rather than to a step number someone must remember.

---

## 14. A goal's acceptance criterion required evidence that cannot exist — **DECIDED 2026-08-15**

> **Decided, all three parts.**
>
> 1. **The criterion is AMENDED to the reachable case** — a value surviving with a caveat,
>    asserted against its opposite so neither passes alone. That is the demonstration the
>    criterion actually wanted. The two named fixtures were the wrong vehicles for it, and that
>    was established at source rather than argued.
> 2. **The San Marino fixture is STRUCK**, with its epitaph: *it was never confident.* The
>    refusal fires before any Fact exists, and a caveat needs a Fact to attach to. **A system
>    refusing earlier than P3 can see is correct behaviour, not a gap.** It is not to be
>    carried into any future goal text.
> 3. **13 stays armed for step 10, not pulled forward.** The temptation was that fixing 13
>    would give `contributingShortfall` a live caller — but relations still run on seed data,
>    and consulted-and-empty only genuinely occurs once live fetches do. Building the
>    representation now would create a *second* mechanism waiting for a caller, which is the
>    exact shape this session just found. **One dead branch documented is better than two.**
>
> The generalisation is recorded in `UNEXERCISED-PATHS.md` §14 as its own coverage class.



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

### Update, 2026-08-15 — option 1 is built, not merely proposed

Both refusals above were re-derived from the tree, not carried forward: `relations/types.ts:51`
types `weight` as `number`, and `dossier/resolve.ts:209` returns `class: 'undetermined'` with
`primary: null` before any Fact exists. Neither named fixture became producible.

What the criterion was *for* — watching the caveat render — was reachable, and was the genuine
gap. The **caveated** state had no browser demonstration at all: the gallery's P3 entry covered
only the *required*-input case, which suppresses the value. That is a check satisfied equally by
an app that renders everything as no data.

Now asserted, both halves against each other:

| Assertion | What it pins |
| --- | --- |
| a contributing shortfall renders as its own card | the state exists in the UI |
| **KEEPS its value — it is not "no data"** | the distinction from the required-input case |
| the shortfall is disclosed as a caveat on the fact | the disclosure reaches the reader |
| the inspector states the shortfall next to the arithmetic | it lands where the formula is |
| the shortfall inspector still shows the formula | the caveat did not replace the audit trail |

The demonstration's caveat text is produced by `contributingShortfall`, not typed out, so it
cannot keep rendering a sentence after the rule behind it changes. Step 2 is 27 assertions, all
passing.

**This does not close the question** — the criterion said *these two fixtures*, and they remain
unproducible. It removes the reason the criterion was written.

---

## 15. Two event markers overlap closely enough that the pick lands on the neighbour

**Raised 2026-08-15, exposed by the GPU.** `frontFacingClusterId()` nominates `EONET_2` as the
most central front-facing marker; hovering the coordinates `screenCoordsOf('EONET_2')` returns
resolves the tooltip to **`EONET_MEASURED`** instead.

The projection is not wrong — the probe confirms coordinates are stable and the canvas geometry
is correct. Two markers are simply close enough on screen that globe.gl's raycast returns the
neighbour.

**Why it appears now.** At 1.3fps the camera never settled to the position where the two
overlap; the harness aimed and clicked from a different vantage. At 59.9fps the camera reaches
its target, and the target happens to put these two markers adjacent.

**Why it needs you rather than a fix from me.** There are three defensible answers and they are
product decisions, not parsing ones:

| Option | Cost |
| --- | --- |
| **(a) Aim at the most ISOLATED front-facing marker**, not the most central | Harness-only change; the check keeps testing what it was written for. But it stops testing the crowded case, which is the one users meet. |
| **(b) Accept the neighbour** when both are within N pixels, asserting only that *a* marker resolved | Weakens a real assertion — the check exists because a wrong id means a wrong event flew the camera somewhere else. |
| **(c) Treat overlapping markers as a product defect** and cluster or offset them | The honest reading if two events genuinely render on top of each other: a user cannot click the one they mean either. This is the same complaint L9 makes, arriving from a different direction. |

**My recommendation: (c) is the real answer and (a) unblocks the harness meanwhile** — but (c)
changes rendering behaviour, and the clustering rules are already specced, so it is not mine to
decide while fixing a test.

**Related:** the fixture set has an `EONET_MEASURED` event precisely to prove a measured
position renders differently from a derived centroid. Its placement relative to `EONET_2` is
fixture data, so (a) could also be achieved by moving a fixture — which would be editing a
fixture to make a test pass, and is recorded here rather than done.

### ANSWERED — 2026-08-15: it is a rendering defect, and step 7 already specified the fix

Not a test problem. Step 7's original hard cases included **coincident or near-coincident
events (an aftershock sequence): overlapping points must remain individually selectable, or
cluster with a stated count. Silently stacking so only the top one is reachable is a
fact-id-class bug.**

That requirement was written and the renderer does not meet it. `EONET_2` and
`EONET_MEASURED` stack closely enough that a raycast at one returns the other — so a user
aiming at one event opens another, which is the fact-id failure rule 7 names: not an absence,
a confident wrong answer.

**The fix is the specced coincidence handling** — cluster with a count at overlap, expand on
interaction, every member reachable — and **the neighbour-pick case becomes its planted case.**

**The fixture stays exactly as it is.** Separating the two markers would make the test pass
while real coincident events stayed unclickable: editing reality to match the assertion. It is
now the regression fixture for the coincidence feature, which is the best available disposal
for a fixture that was nearly moved.

**Interim cover:** the keyboard/list path (S3/L12), which reaches every event without a click
and therefore without a raycast. One more reason the promotion was right — it covers L9 and
this defect with the same work.

---

## 16. The commit-4 verify diff — **CLOSED 2026-08-15**

> **Closed.** Commit 4 is confirmed clean: commit 3's flake-free run and commit 4 are identical
> in every step, not merely consistent within flake. The halt is lifted and the migration
> sequence is verified end to end. Rule 36 is amended in `TESTING.md` with commit-3-against-
> itself as its worked example, carrying both clauses — the observed cascade bound, and the
> statement that if the cascade could explain any plausible diff then comparisons on this
> configuration are inconclusive by construction and must say so.


**Raised 2026-08-15.** The migration goal says: *"If commit 4 produces any verify diff, stop the
sequence, report the diff as a finding, and do not proceed to commit 5 until it is explained and
resolved."*

**Commit 4 produced a diff, so the sequence is HALTED at that instruction.** Commit 5's verify
is not being run until this resolves. Recorded here rather than decided quietly, because
"proceed anyway, the diff looks like flake" is precisely the judgement the instruction exists to
prevent someone making alone.

**The diff:** 282 assertions / 5 failures at commit 3 against 279 / 1 at commit 4. Seven of ten
steps identical; the three that differ are exactly the three where a click flake fired, each by
precisely its flake count. Full table in `FOUND.md`.

**Both readings are live:**

| Reading | What it would mean |
| --- | --- |
| The count is flake-driven | The refactor is clean and rule 36's criterion is mis-specified, not the commit |
| The count tracks the commit | A genuine behavioural diff in a refactor that promised none — a bug, per the instruction |

**The experiment that separates them:** run commit 3 **against itself**. A commit compared to
itself has no refactor between the runs, so any difference in count can only be flake. If run 2
of commit 3 differs from run 1, the count is proven unstable and the commit-4 comparison
resolves in the refactor's favour. If it reproduces 282/5 exactly, the difference tracks the
commit and commit 4 has a real diff to explain.

**Why this experiment and not another.** The alternative — re-running under the GPU harness,
where L9 is deterministic — would measure a configuration neither commit ever ran under. That is
rule 20a's trap pointed backwards in time, and it would answer a question about a third
configuration rather than about these two commits.

**Status: running.** Whatever it returns, the disposition gets recorded here before anything
proceeds to commit 5.

**Standing regardless of the outcome:** rule 36 needs amending. "Per-step assertion identity"
assumes the assertion count is a property of the commit. Under a flaky configuration it is a
property of the commit AND the run, because a dropped click changes what executes next. The
criterion cannot currently distinguish a behavioural change from a dropped click, which is the
one distinction it exists to make.

### RESOLVED 2026-08-15 — the count is flake-driven, and commit 4 is clean

The discriminating experiment returned. **Commit 3 differs from itself:**

| Run | Total | Failures | Steps 7 / 7b / text |
| --- | --- | --- | --- |
| Commit 3, run 1 | 282 | 5 | 34 / 12 / 36 |
| Commit 3, **run 2** | **279** | **0 — all checks passed** | **33 / 11 / 35** |
| Commit 4, run 1 | **279** | 1 (documented L9) | **33 / 11 / 35** |

Same commit, same harness, same configuration, nothing between the two runs but flake. The
assertion count is therefore a property of the commit AND the run, exactly as diagnosed.

**Commit 4 is equivalent to commit 3, on the strongest available footing.** Not "explicable
given flake" — commit 3's flake-free run and commit 4 produce the *same vector* across all ten
steps. The apparent diff came from using commit 3's flaky run as the baseline. A flaky
configuration has a floor, and the floor is the only stable thing to compare against.

**The halt lifts.** The sequence may proceed to commit 5.

**The disposition is "rule 36 was mis-specified", NOT "diffs under flake are ignorable."** The
amended rule is in `TESTING.md` 36 and retains failing power: a count change in a click-free
step is not cascade-explicable, and neither is any reduction. Both remain genuine diffs. What is
NOT established — and is written into the rule as not established — is that the cascade can
never subtract assertions; three runs do not show that, so a reduction is treated as a real diff
until measured otherwise.

**One claim in rule 36 was falsified by this measurement** and has been struck rather than
edited quietly: it asserted per-step counts "did not vary once (279, per step, both sides)"
across six runs. They vary. The rule had already identified the mechanism — `clickOrFail` emits
an extra `clickable` check when a click fails — and had not followed it through: that check has
to land inside some step, so it inflates that step as well as the total. Six runs happened not
to expose the inconsistency.

---

## 17. Ember's tier is OFFICIAL at source level and cannot be narrowed per row

**Raised 2026-08-15 while building the Ember adapter.** Ember compiles yearly electricity
generation from national statistical publications and system operators — a primary chain, so
`OFFICIAL` rather than `ESTIMATE`.

**But the v1 API carries no per-row provenance flag.** Its rows expose `entity`, `entity_code`,
`is_aggregate_entity`, `date`, `series`, `is_aggregate_series`, `generation_twh` and
`share_of_generation_pct` — and nothing distinguishing a figure a country reported from one
Ember modelled or back-filled, which its methodology says happens for some country-years.

So the adapter marks every row `OFFICIAL`, and that is a property of the SOURCE, not a claim
about the row. Marking everything `ESTIMATE` would be equally wrong in the other direction and
would understate the reported majority.

**Why this is recorded rather than decided:** the tier system exists to stop exactly this kind
of blur, and here the blur is in the upstream data rather than in our handling. The honest
options are to leave it as-is with the limit written down, or to introduce a tier meaning
"primary source, per-row provenance unavailable" — which is close to what `UNVERIFIED` was added
for and may be its second real use.

**What would settle it:** a per-row flag from Ember, or a published list of estimated
country-years that could be joined against. Neither is in the v1 API today.

---

## 18. `npm run probe` does not run on Windows

**Raised 2026-08-15.** The script is `NODE_USE_ENV_PROXY=1 node --env-file-if-exists=.env
scripts/probe-sources.mjs`. npm spawns scripts through `cmd.exe` on this machine, which does not
understand a POSIX environment-variable prefix, so the command fails immediately with
`'NODE_USE_ENV_PROXY' is not recognized`.

**Not fixed in the commit that found it.** The tempting one-liner — moving the flag into
`probe-sources.mjs` as `process.env.NODE_USE_ENV_PROXY ??= '1'` — changes proxy behaviour for
DIRECT invocations too, and a network-semantics change should not ride along in a commit about
keys.

**Shape of the fix:** a cross-platform launcher — `cross-env` as a dev dependency, or a small
node wrapper that sets the variable and spawns the prober — in its own commit, so the change to
what the proxy does is visible as its own decision.

**Until then:** run it directly, which works —
`NODE_USE_ENV_PROXY=1 node --env-file-if-exists=.env scripts/probe-sources.mjs <id>`.

### ANSWERED — 2026-08-15

**UNVERIFIED is the wrong tier, and the reasoning is worth keeping.** `UNVERIFIED` means
*uncorroborated*. Ember's rows are corroborated — by the source's own published methodology.
What they lack is a per-row reported-versus-modelled distinction the API does not expose.

That is a **source-level limitation, not row-level doubt.** The tier stays `OFFICIAL` at source
level, and the limitation is recorded in two places a reader can reach: the registry notes, and
the panel's methodology line — *"Ember does not distinguish reported from modelled values per
row."*

**Inventing per-row doubt the source does not express would be authoring uncertainty, which is
the same sin as authoring confidence.** The tier system exists to carry what a source claims,
not to add a claim of our own in either direction.

**Outstanding:** the methodology line has no home yet. Ember is adapter-only — no surface
renders it (the PortWatch precedent) — so the line lands with the surface that first shows an
Ember figure, and this entry is what that work is checked against.

---

## 19. Two key-gated sources whose authentication cannot be established from here

**Raised 2026-08-15** while measuring auth mechanisms for the conversion queue. Four of six were
settled by measurement. These two were not, for different reasons, and neither is fixable by
guessing.

### `theyvoteforyou` — every mechanism refused

Ten candidates tried against the registered probe URL: `?api_key=`, `?apikey=`, `?key=`,
`?access_key=`, `?subscription-key=`, `Authorization: Bearer`, `Authorization: ApiKey`,
`X-Api-Key`, `Ocp-Apim-Subscription-Key`, and unauthenticated. **All ten returned 403 with an
HTML body** — not a JSON error naming the problem, which would have distinguished them.

**Two explanations fit equally and cannot be separated from here:**

| | What it would mean |
| --- | --- |
| The mechanism is none of the ten | A different parameter name or header, or a path/host that differs from the probe URL |
| **The key value is not valid** | Expired, mistyped, or issued for a different environment |

**No `keyParam` is declared.** Guessing one would send the key wrongly and fail as a plain 403 —
indistinguishable from having no key, which is the failure this project spent a day untangling
in file form.

**What would settle it:** confirmation that the key is currently valid, or the documented
parameter name from the account page. Either collapses this to a one-line registry change.

### `opensanctions` — the probe URL cannot measure authentication

Its registered `probeUrl` answers **200 unauthenticated** with `{status}` — a health check. So
every candidate mechanism "succeeds", and the sweep can prove nothing: an endpoint that never
refuses cannot tell you what it accepts.

**This is not a failure of the key.** The key is present and filled. The measurement is simply
being taken at a URL that has no authentication to exercise.

**What would settle it:** a real data endpoint to measure against, which is a decision about
which OpenSanctions dataset this app actually wants — and that is the adapter's question, not
the prober's. It should be answered when the adapter is written, not before.

**Recorded rather than worked around** because a plausible `keyParam` on either source would
look identical to a measured one in the registry, and the whole point of declaring the
mechanism was that it be measured.

### 19a. ANSWERED BY MEASUREMENT — 2026-08-15: the request never reached the API

`theyvoteforyou`'s ten 403s were **Cloudflare's JS challenge**, not the application.

The reviewer's encoding hypothesis was tested and eliminated first: the key does contain a
literal `/`, and both the percent-encoded (`%2F`) and hand-built literal forms were sent. Both
403. **So did the keyless control**, which is the fact that had been present in every
measurement and unread — along with `server: cloudflare` and `<title>Just a moment...</title>`,
identical across a custom User-Agent, a browser-like one, curl, and none.

**The key has never been evaluated.** Not a wrong mechanism, not an invalid credential, not an
encoding fault — an access block at the edge.

**Disposition: parked, with the reason corrected.** It is an access problem, not a credential
problem, and the two need different things from you. Nothing about the key needs checking.

**One thing worth testing before writing the source off:** a Cloudflare Worker fetching a
Cloudflare-fronted origin may not get the same challenge, and this app already routes this
source through the Worker. That is a question about *where the fetch runs*, and it cannot be
answered from this machine. If the Worker gets through, the source is fine and only the local
probe is blind to it.

**A separate decision this exposed** — recorded here because it changes how every key-gated row
reads: `verdictForResponse` checks `keyRequired` before looking at the response, so a source
that is completely unreachable records as `KEY-GATED`, identical to six healthy ones. Either
`UNREACHABLE` should be evaluated first, or the record should carry both. I have not changed it,
because it alters the meaning of every key-gated row in the table.

---

## 20. Every Comtrade TOTAL row is `isReported: false` — which reading is right?

**Raised 2026-08-15** capturing the Comtrade fixture. US exports 2023, `cmdCode=TOTAL`, 224
partner rows:

```
isReported true:  0      false: 224
isEstimated:      221
isAggregate:      224
```

**Every row.** So the adapter's current mapping — `isReported: false` implies `ESTIMATE` —
renders *every* Comtrade country total as an estimate, and a panel showing US trade would carry
an ESTIMATE badge on a figure most readers would call official.

**Two readings, and they differ in what they claim about the world:**

| Reading | Consequence |
| --- | --- |
| The figure is not a direct submission from the reporter, so it is genuinely not that country's official statistic | `ESTIMATE` is correct and the badge is honest |
| The reporter DID submit the underlying HS lines; `TOTAL` is Comtrade's own aggregation of reported data, and `isReported` describes the aggregated ROW rather than the data beneath it | `ESTIMATE` overstates the doubt — the data is official, the summing is Comtrade's |

**`DERIVED` is not available as a third answer.** In this project `DERIVED` means *this app
computed it* — the gallery says so explicitly. A figure Comtrade aggregated is not one we
derived, so borrowing the tier would misdescribe who did the arithmetic.

**Current handling: `ESTIMATE`, with the reason rendered.** That is the fail-closed choice — it
claims less rather than more — and the note says exactly why, so a reader is not left guessing
what the badge means. But if reading two is correct, the app is systematically understating a
primary source.

**What would settle it:** Comtrade's own documentation of `isReported`, or a comparison of a
`TOTAL` row against the sum of that reporter's HS lines for the same year. The second is
measurable here and costs two API calls against a 500/day budget with a burst limit that
already returned 429 today — worth doing deliberately rather than as part of this pass.

### Disposition, 2026-08-15 — ESTIMATE stands until one deliberate experiment decides it

**The experiment, to run when the Comtrade budget resets** (500/day, and a burst limit that
returned 429 today): pick a reporter-year where a major reporter certainly submitted HS lines,
fetch the `TOTAL` row and the HS lines, and compare.

| Outcome | What it means | Tier |
| --- | --- | --- |
| The HS lines sum to `TOTAL` within rounding | `isReported:false` describes the aggregated ROW — the UN did the addition, the data beneath is the reporter's own | `OFFICIAL` at source, with a note that the total is UN-aggregated from reported lines |
| They do not match | `ESTIMATE` was right, and the discrepancy is its own finding | `ESTIMATE` |

**Two calls, run deliberately as one experiment — not inside a conversion pass.** Verdict
recorded here either way.

**Why ESTIMATE is correct in the meantime, and it is not just caution:** the badge is
**reversible in only one direction**. A badge that under-claims can be upgraded on evidence; one
that over-claims has already told the reader something false, and no later correction reaches
the person who read it. "Who did this arithmetic" is exactly what a tier should say, so the
answer must be measured rather than assumed in the direction that flatters the data.

---

## 21. `Resolution` cannot express a sensor footprint

**Raised 2026-08-15** taking FIRMS through the gate. `Resolution` is
`'country' | 'admin1' | 'point'`. A FIRMS detection is none of them: it is a **pixel of measured
size** — 380 m to 750 m across, and the size arrives in every row as `scan` and `track`.

| Candidate | Why it is wrong |
| --- | --- |
| `point` | overstates. The sensor never had a point; it had a footprint, and for THIS source implying a point reads as a strike location |
| `admin1` | understates by orders of magnitude. It would render a 400 m detection as a province-wide claim |

**Not resolved by widening the enum**, because this goal forbids Fact-model changes and that is
the right constraint: a fourth member changes every consumer's exhaustive dispatch, which is a
migration rather than an adapter detail.

**What was done instead, and it is not a workaround.** The binding is enforced as ARITHMETIC in
the adapter: `decimalsForFootprint` derives the number of decimal places a footprint justifies,
and every coordinate is rounded to it before it leaves `parse`. That is asserted against live
data and holds regardless of what the enum eventually says. The published five decimals (≈1.1 m)
become one or two (≈1.1 km) for a 400 m pixel.

**The known cost, recorded rather than hidden:** decimal degrees come only in powers of ten, so
a 380 m pixel gets `0.01°` ≈ 1113 m — about three times coarser than the sensor. Two genuinely
distinct detections 500 m apart collapse to one coordinate. For a source under a standing
prohibition against implying strike locations, erring coarse is the right direction, but it is
a real loss of resolution and a clustering feature would need the unrounded value.

**What is needed from you:** whether `Resolution` should gain a `footprint` member carrying its
size, at the cost of a migration across every consumer — or whether the numeric binding is the
whole answer and the enum stays a three-way coarse classification.

---

## 22. Which class does abuse.ch's licence actually fall into?

**Raised 2026-08-15.** Feodo Tracker's terms (read at `abuse.ch/terms-and-conditions/`) are:
copyright reserved (8.1), attribution mandatory (8.2), no commercial use without a separate
licence (8.3). **Not CC0**, which the plan documents claimed — see `FOUND.md`.

**The classification is a judgement, and it changes how the source may be used:**

| Class | Argument for | Argument against |
| --- | --- | --- |
| `nc` | 8.3 is exactly a non-commercial term, and this project is non-commercial (decision 3), so it is satisfiable | understates 8.1's "all rights reserved" — there is no affirmative grant of reuse anywhere in the terms |
| `restricted-minimal` | matches "no general grant; minimal attributed elements ingested"; the blocklist is published FOR blocking, which is an implied grant for that use and no wider | may understate what abuse.ch actually intends, since the dataset exists to be consumed |
| `restricted` | strictly correct on 8.1 alone | would mean not ingesting it at all, which is hard to square with a blocklist published as a JSON download |

**My reading is `nc`**, because 8.3 names the constraint that actually binds this project and the
licence-posture guard reads the licence string for exactly that term. But 8.1 has no affirmative
grant, and this project has been careful that "published for use" is not the same as "licensed
for use".

**Not converted pending your answer.** The data is reachable and the adapter would be
straightforward; what is not straightforward is asserting a licence class the terms do not state
outright. Emergency stop 2 covers shipping content whose terms we have not read — these have now
been read, and what they say needs a decision rather than a guess.

**Note for the rest of the batch:** the plan's licence column is now treated as a research lead
rather than a record. Each source's terms get read before its adapter, and any that disagree
with the plan get recorded the way this one was.

---

## 23. Two Phase A sources blocked on things this machine cannot supply

**Raised 2026-08-15.** Both are recorded rather than forced, per the riksdagen and Ember
precedents. Neither is a defect; both need something from you.

### IODA — the licence cannot be read from anywhere reachable

`ioda.inetintel.cc.gatech.edu` is a client-rendered SPA: `/about` returns 6 characters of shell,
`/acceptable-use` the same, the API root 15, and the GitHub repo path 404s. **No route serves
licence text.**

The API itself answers 200 and keyless — the data is reachable and an adapter would be
straightforward. What is missing is the one thing L15 requires before ingesting anything:
terms that have actually been read.

**Not forced.** Emergency stop 2 covers shipping content whose terms we have not read, and
"the licence page is a SPA" is not a reading. Ingesting on the assumption that an academic
measurement project is permissive would be exactly the inference this project refuses —
especially after Feodo, where the convenient assumption was wrong.

**What would settle it:** the licence or acceptable-use text from a browser (where the SPA
renders), or a citation policy from the IODA team.

### ReliefWeb — needs an approved appname

The plan's endpoint was `v1`, which is decommissioned: *"The API version 'v1' has been
decommissioned. Please use version 'v2' instead."* That much was a free fix.

`v2` then answers **403** with an equally precise message:

> You are not using an approved appname. Kindly request an appname from ReliefWeb here:
> `https://apidoc.reliefweb.int/parameters#appname`

An appname is a registration, not a secret — but it is a registration a human completes, which
is the Ember disposition exactly.

**What would settle it:** an approved appname, which then goes in the registry (not `.env`,
since it is an identifier rather than a credential — worth confirming when it arrives).

**Both sources are otherwise ready.** Reachability is proven, the endpoints are correct, and
the remaining work is an adapter each.

### 23a. The rest of the batch, surveyed 2026-08-15 — six more blockers, each with its remedy

Completing question 23 with the sources surveyed after it was written. **All ten Phase A sources
are now measured**; none was forced.

| Source | Measured | What it needs from you |
| --- | --- | --- |
| Cloudflare Radar | `400` without a token | a token in `.env` (free; the class it lands on, `share-alike-nc`, already exists) |
| IOM DTM | `404` on `dtmapi.iom.int/api/common/GetAllCountryList` | the correct endpoint — the path was inferred, not documented, and inferring a second one would repeat the mistake |
| HDX HAPI | `429` **"Blocked due to bot activity"**, twice | contact `hdx@un.org` as the response asks. **Corrected from my earlier record of "rate limited"** — waiting will never clear this |
| FEWS NET | timeout, twice, ~25s each | rule 35 satisfied on repetition but NOT on mechanism: two timeouts from one machine do not distinguish a down host from a blocked path. Needs a different vantage point before it is called dead |
| IFES ElectionGuide | `401` — *"To request access or resolve issues… visit electionguide.org/request_access/"* | request access |
| UN voting (UNDL) | `202` with an empty body | the endpoint is asynchronous — a 202 means accepted, not answered, so the real integration needs the result-polling pattern rather than a single GET. Worth confirming the intended API before building |

**Six of eight blockers name their own remedy in the response body.** Only IODA (silence) and
FEWS NET (a timeout) do not — which is why the bodies were worth reading even where the status
looked conclusive, and why my "rate limited" note for HDX was wrong for two turns.

**None of these is a defect and none needs a decision about the app.** They need credentials,
endpoints, or a vantage point. The adapters are straightforward once each is supplied, and the
gate discipline that took FIRMS and OONI through is the same one waiting for them.

### 23b. ReliefWeb — exactly what you need to do, in one sitting

**Parked 2026-08-15 per the Ember disposition.** Registered as `excluded: true` so no guard
treats it as live, with `keyEnv: RELIEFWEB_APPNAME` declared and the line already in
`.env.example` — the template carries it before the value exists, which is what the
`env-template` guard was built for.

**The one action:** request an approved appname at
**`https://apidoc.reliefweb.int/parameters#appname`**, then put it in `.env` as
`RELIEFWEB_APPNAME=`.

**What is already established, so nothing needs re-deriving when it arrives:**

- `v1` is decommissioned — *"The API version 'v1' has been decommissioned. Please use version
  'v2' instead."* The registry points at `v2`.
- `v2` reachable, `access-control-allow-origin: *`, refuses only on the appname.
- The appname travels as a **query parameter**, so `keyParam: 'appname'` is declared and the
  existing keyed-probe machinery will apply it with no new code.

**One decision when it arrives:** an appname is an identifier, not a credential — it is sent in
the clear and its purpose is to let ReliefWeb contact the operator. It is in `.env` for now
because that is where the machinery looks, but it could equally live in the registry as plain
text. Worth one minute's thought rather than inheriting the secret-handling by default.

**The licence is NOT yet read.** `licenseClass` is `restricted` as a fail-closed placeholder,
not a finding — it records that nothing has been established. It must be replaced by a real
reading before anything is ingested, and given that the plan's licence column has been wrong
four times out of four in the permissive direction, that reading is not optional.

---

## 24. IODA parks as reachable-but-licence-unreadable

**2026-08-15**, after exhausting the machine-reachable routes at your direction.

**Where I looked, so nobody repeats it:**

| Route | Result |
| --- | --- |
| `/about`, `/acceptable-use` | 6 characters — SPA shell |
| API root `/v2/` | 15 characters |
| `InternetIntelligenceLab/ioda-ui` README | 404 |
| GitHub org search | 422 |
| **`/build/ioda.7dd34d99.js`, 3,988,051 bytes** | **searched: `creative commons`, `CC-BY`, `licensed under`, `acceptable use`, `terms of use`, `cite`, `citation`, `data policy`, `redistribut`, `CC0`, `open data` — all absent** |

The only `copyright` in the bundle belongs to core-js; the only `attribution` is Leaflet's map
control. The routes the bundle knows about are `/dashboard`, `/about`, `/reports`, `/resources`,
`/help` — all served by the same shell.

**Riksdagen shape: the data is reachable and keyless, and the block is purely the missing
grant.** The API answers 200 without authentication and an adapter would be short.

**Not inferred permissive from its academic origin.** That is the four-for-four optimistic error
this batch has already made: Feodo's plan entry said CC0 and its terms reserve all rights;
OONI's own page said "a Creative Commons license" and meant the most restrictive variant we can
use; ReliefWeb's endpoint was decommissioned; HDX's 429 was a bot block. Every convenient
reading this week has been wrong, always in the same direction.

**What would settle it:** the licence or acceptable-use text as the SPA renders it in a browser,
or a citation policy from the IODA team at Georgia Tech.

### 20 — ANSWERED BY EXPERIMENT, 2026-08-15. Reading two was right.

**Three calls: one `TOTAL` row, and the HS lines beneath it.** USA exports to Canada, 2023.

| Level | rows | `isReported` | `isAggregate` |
| --- | --- | --- | --- |
| **HS6 leaves** | 5,226 | **all true** | none |
| HS4 | 1,212 | all false | all true |
| HS2 | 97 | all false | all true |
| `TOTAL` | 1 | false | true |

**And the arithmetic is exact.** The 5,226 reported HS6 lines sum to **352,760,090,331** — the
`TOTAL` to the dollar, 0.0000%. HS4 and HS2 partition to the same figure.

**So `isReported` is true at the leaf and false at every aggregation level.** It describes the
ROW, not the data beneath it: the UN did the addition, and the lines being added are the
reporter's own submissions.

**Verdict, per the criterion set when this was raised: `OFFICIAL` at source with a
UN-aggregation note.** The adapter is corrected. `ESTIMATE` is now reserved for a row that is
neither reported nor an aggregate — mirror data the reporter never submitted and nobody totalled.

**What the correction was worth:** every Comtrade country total in the app was rendering
`ESTIMATE`. That understated a primary source on every trade figure, and no test would ever have
caught it, because the code did exactly what it was written to do.

---

## 25. `legacyEstimationFlag` is a code and I do not know its values

**Found 2026-08-15 during question 20's experiment.** My Comtrade adapter treated
`legacyEstimationFlag !== 0` as "this row is estimated". Measured across one response:

```
legacyEstimationFlag: {"0": 4768, "2": 8, "4": 1013, "6": 747}
```

**It is a code with at least four values, not a boolean.** Treating non-zero as "estimated"
lumped three distinct meanings together and marked **1,768 of 6,536 rows** as estimates on an
inference — and one of them was the `TOTAL` row whose value is provably the exact sum of
reported lines.

**Now carried verbatim and not interpreted.** The field is preserved on every row so nothing is
lost, and no tier keys on it.

**What would settle it:** Comtrade's documentation of the legacy estimation codes, or a
comparison of flagged against unflagged rows against a known-good source. Until then, a code
whose meanings we do not know cannot honestly drive a confidence badge.

**Related and already fixed:** `isQtyEstimated` and `isNetWgtEstimated` describe quantities and
weights. `primaryValue` is money. The USA→Canada `TOTAL` carries `isNetWgtEstimated: true` and
`isQtyEstimated: false` while its value is exact — so folding weight-estimation into a value's
tier was a category error, now disclosed in a note rather than driving the badge.

---

## 26. The Phase A goal's completion condition — **AMENDED BY DECISION 2026-08-15**

> **The reviewer amended it, and that is what S7 covers.** Recorded here as S7 requires, so the
> amendment lives in the record rather than only in a conversation.
>
> **Amended condition:** *every Phase A source is through the gate **OR** recorded with its
> blocker per the riksdagen/Ember precedent.*
>
> **Status against the amended condition: SATISFIED.**
>
> | | Sources |
> | --- | --- |
> | Through the gate (Phase A batch proper) | **OONI**, **Feodo Tracker** — 2 of the 10 listed |
> | Through the gate, listed separately as item 1 | **FIRMS** |
> | Registered and parked with a blocker | FEWS NET, ReliefWeb |
> | Blocked before registration, each with a named blocker | Cloudflare Radar, IODA, IOM DTM, HDX HAPI, IFES, UN voting |
>
> **The original literal conjunction — all ten through the gate — remains unsatisfied**, and the
> amendment does not pretend otherwise. It changes what the goal asks for, on the reviewer's
> stated reasoning: *"forcing six conversions through guessed endpoints and inferred licences
> would have manufactured the conjunction at the cost of everything the gate means."*
>
> **This entry previously carried my own attempt to invoke S7 for the same purpose, and its
> retraction.** Both are kept below. The difference is the whole point of S7: an amendment is a
> decision someone makes, not a reading I can reach for when a condition becomes inconvenient. I
> made that error at 26's first writing; the amendment above is what it looks like done
> properly.



> **CORRECTED 2026-08-15, hours after this entry was written.** The first version invoked S7 and
> said "the amending force here is not a decision but the world; the disposition is the same."
> **That was a stretch, and it was caught.**
>
> S7 covers *a decision of the reviewer's* amending a criterion. Nobody decided anything here —
> a token is missing, an endpoint is wrong, a licence page is a SPA. Reaching for S7 because its
> disposition looked convenient is the same move this project refuses everywhere else:
> classifying a case by the rule that would be pleasant rather than the rule that fits. I did it
> to a rule I had written that same day, which is how easily it happens.
>
> **The correct basis needs no amendment at all.** The goal already contains the clause: *"sources
> that could not convert recorded with their blocker per the riksdagen/Ember precedents rather
> than forced."* Seven sources are blocked and recorded exactly that way. That clause is
> satisfied on its own terms, and invoking S7 on top of it claimed an authority the situation
> never required.
>
> What remains genuinely unsatisfied is the literal conjunction — ten sources through the gate —
> and it is unsatisfied because seven credentials, endpoints and licence texts do not exist on
> this machine. That is a fact to report, not a criterion to reinterpret.

**Raised 2026-08-15.** Recorded under the goal's own blocked-source clause.

**The goal contains two clauses that cannot both hold while the blockers stand:**

1. *"The remaining Phase A batch… each through the full gate."*
2. *"Sources that could not convert recorded with their blocker per the riksdagen/Ember
   precedents rather than forced."*

Clause 2 exists because clause 1 was never guaranteed. **Seven of ten sources are blocked on
things this machine cannot supply**, and each is recorded under clause 2:

| Source | Blocker | Who can clear it |
| --- | --- | --- |
| Cloudflare Radar | no token in `.env` | you — free registration |
| IODA | licence unreadable; every route is a client-rendered shell, bundle searched | you — the text as a browser renders it (`24`) |
| IOM DTM | 404 on the surveyed path | you or documentation — the correct endpoint |
| ReliefWeb | 403; `v1` decommissioned, `v2` needs an approved appname | you — one form (`23b`) |
| HDX HAPI | 429 **"Blocked due to bot activity"** | you — `hdx@un.org` |
| FEWS NET | timeout twice, ~25s each | a different vantage point; rule 35 not satisfied on mechanism |
| IFES ElectionGuide | 401, *"visit electionguide.org/request_access/"* | you — access request |
| UN voting | 202 with an empty body — asynchronous | confirm the intended API |

**Condition 2 is marked AMENDED to: every Phase A source is either through the gate or recorded
with a named blocker and its remedy.** That is satisfied — 3 through, 7 recorded, none forced.

**What is deliberately NOT claimed:** that the seven are impossible, or that the goal is
complete as written. They are one human action each away, and the moment any credential or
endpoint arrives, the gate discipline that took FIRMS, OONI and Feodo through applies unchanged
— licence read, probe, adapter, capture through the app's own builder, contract test, flip.

**Everything else in the goal is met:** items 1 and 3 complete, per-source gate tables in
`PROGRESS.md`, `typecheck` exit 0, 777 tests with a clean census, a full `verify` table showing
only the known L9 cluster, and a clean tree.

---

## 27. Two Phase A endpoints were inferred by me — a SPEC DEFECT, not an access problem

> **Class matters here.** "Blocked because I do not know the address" is not the same as
> credential-walled (Cloudflare Radar, IFES, ReliefWeb), bot-blocked (HDX), or
> licence-unreadable (IODA). Those need *access*. This needs **documentation research**, and the
> defect is upstream: `SPEC-EXPANSION.md` named these sources without naming their endpoints, so
> the first person to build them had to invent a URL. I did, twice, and both inventions failed.
>
> **The discipline held in both:** three distinct failures each, no fourth guess, and **no
> adapter written against a guessed endpoint.** That is the FEWS NET rule applied — and FEWS NET
> is also the caution against applying it too early, since there the answer turned out to be in
> an index I had already fetched. The test is whether the next name comes from the source or
> from me.


**2026-08-15.** `SPEC-EXPANSION.md` names *"IOM DTM"* and *"UN General Assembly voting"* as
sources. It names no endpoints. **I chose both URLs myself**, and both failed — which makes the
failure mine rather than the sources'.

### IOM DTM

I tried `dtmapi.iom.int/api/common/GetAllCountryList`, then `/api/Common/GetAllCountryList`,
`/api/IdpAdmin0Data/...`, the root `/`, and five conventional OpenAPI paths
(`/swagger/v1/swagger.json`, `/swagger/index.html`, `/openapi.json`, `/api-docs`,
`/api/swagger.json`).

**Every one returns the same JSON envelope:** `{"statusCode":404,"message":"Resource not
found"}`. The host is alive and serving a structured API; it exposes no discovery mechanism I
can reach, and nothing I have tried is a documented path.

### UN General Assembly voting

I tried `digitallibrary.un.org/search?…&of=recjson`, which returns **202 with an empty body, no
`Retry-After` and no `Location`** — accepted but not answered, with no exposed way to collect
the result.

### Why this is recorded rather than solved by more attempts

**After three distinct failures, a fourth guess is inference.** That is the same discipline
applied to FEWS NET's IPC endpoints and to Feodo's licence: when the convenient reading has been
wrong repeatedly, guessing again is not persistence, it is the error the project keeps catching.

Both sources are almost certainly reachable by someone holding the documentation. Neither is
blocked by a credential, a rate limit or a wall — only by not knowing the address.

**What would settle each:** the documented base path for the DTM API, and confirmation of which
UN voting dataset is intended (the Digital Library's async search is one candidate; there are
published voting datasets that are plain files, and those would be a different integration
entirely).

**Recorded as a research task, not a defect.** No adapter was written against a guessed
endpoint, which is the outcome L15 and rule 3 both point at.

---

## 28. Step 9's blocker no longer reproduces — is it unblocked, or lucky?

**Raised 2026-08-15** after re-measuring the blocker the current goal was drafted to fix.

`buildLegislatureQuery` now completes for **every country measured** — Vatican City 1371ms,
Iceland 1765ms, the United Kingdom 734ms, India 879ms — where the recorded finding says it
completed for none. Tested by GET and POST, same result. Full table in `FOUND.md`.

**Nothing in this app changed.** The query is byte-for-byte what it was.

**The decision this needs:**

| Reading | Consequence |
| --- | --- |
| **Unblocked** — WDQS improved, step 9 can proceed on the existing query | the redesign goal is void, and step 9 drafts next |
| **Lucky** — the failure mode is intact and this query is currently escaping it | the redesign still matters, and the goal continues with a different justification |

**The evidence leans "lucky", and the sibling query is why.** `buildCabinetQuery` reproduced its
recorded numbers to within half a second — 52.18s against 52.6s — and still 504s for the United
Kingdom. The endpoint has not stopped spending 60 seconds on queries of this shape; the
legislature query is simply not one it spends them on today.

A query that ran at 60s+ and now runs at 1s did not become well-designed. **It became lucky, and
the same optimizer decision that helped it can be withdrawn without notice.**

**My recommendation: treat it as unblocked for step 9 AND keep the redesign**, on the cabinet
query, where the defect provably still lives. That gets step 9 moving without recording a
"fixed" that nobody fixed, and it fixes the query that is actually broken.

**What is NOT recommended:** deleting the blocker note from `BUILD-ORDER` as though the problem
were solved. It was not solved; it stopped occurring, and those are different entries in a
history someone will read.

**A guard would settle it either way** — the goal's Part 3 already proposes one: every shipped
SPARQL query completes within a stated budget under `PROBE_LIVE`. That converts "is it safe" from
a judgement into a check that fires when the luck runs out.

### 28 — ANSWERED BY MEASUREMENT, 2026-08-15. Both, and the mechanism says which is which.

The question was "unblocked, or lucky?" and it was posed without the numbers that decide it. Here
they are, with the headroom test applied: **unblocked means the measured worst case clears the
60s ceiling by more than run-to-run variance can eat.**

#### The cabinet query — UNBLOCKED, by mechanism and by margin

| Country | run 1 | run 2 | variance |
| --- | --- | --- | --- |
| Vatican City | 2374ms | 2507ms | 133ms |
| Iceland | 3237ms | 2817ms | 420ms |
| **United Kingdom** | **8398ms** | **5300ms** | **3098ms** |
| India | 5249ms | 2969ms | 2280ms |

**Worst case 8398ms against a 60000ms ceiling: 51.6 seconds of headroom.** Largest observed
variance 3098ms. **Headroom is ~16× the largest variance measured.** That is not a coin flip; it
is a different order of magnitude, unlike the mutation-timeout case where five minutes of margin
faced minutes of variance and was rightly called a toss-up.

And the margin is *explained*: `wdt:P279*` was measured at 24 of the 52 seconds, and it is gone.

#### The legislature query — LUCKY, and now provably so

It was never redesigned, and it **still contains the exact construct**:

```
line 264:  ?chamber wdt:P31/wdt:P279* ?chamberType     ← legislature
line 347:  ?court   wdt:P31/wdt:P279* wd:Q1513611      ← judiciary
```

So its speed needs no mysterious explanation. **It carries the known-expensive construct and is
currently not paying for it** — which is precisely what "lucky" means, and it is now a statement
about a named clause rather than a hunch about a service.

Its chamber walk saturates at **two hops** for every country measured (VAT 1, ISL 1, GBR 3,
IND 3, USA 3), so it can be bounded on the same evidence the cabinet query was.

#### The disposition, therefore

**Treat step 9 as unblocked and bound the remaining closures.** Not because the query is fast
today, but because the clause that made its sibling slow is still in it and can be removed on
measured evidence rather than hope.

---

## 29. The judiciary query's fallback branch cannot ever match anything

**Found 2026-08-15** while measuring the third `wdt:P279*`.

```
country   P209 (primary)   fallback class   instances of the class
GBR            1 (916ms)      0 (6724ms)                        0
IND           1 (5988ms)       0 (768ms)                        0
USA            1 (353ms)      0 (1319ms)                        0
FRA            5 (697ms)      0 (1454ms)                        0
VAT           0 (1559ms)      0 (1656ms)                        0
```

**`?x wdt:P31 wd:Q1513611` returns zero instances anywhere in Wikidata.** Nothing is an instance
of that class, so the UNION's second branch cannot match for any country — not merely the six
measured.

**The entity table already said so.** `data/wikidata-entities.json` carries
`"verified": false` on `courtOfLastResort`, with the note that it is "a fallback class when
P209 is absent". The doubt was recorded; nobody measured it.

**And it is not free.** The branch carries `wdt:P31/wdt:P279*` — the construct measured at 24 of
the cabinet query's 52 seconds — so the query pays an unbounded closure for a branch that
returns nothing. For the United Kingdom that branch alone took **6724ms**.

**The decision is yours because it changes behaviour**, and there are two defensible readings:

| Option | Argument |
| --- | --- |
| **Remove the branch** | it cannot match; deleting it removes a cost and no capability |
| **Fix the class** | the fallback was *intended* to catch countries where P209 is absent, and Vatican City is exactly such a country — 0 from P209 and 0 from the fallback. The intent was sound and the QID is wrong |

**My reading: the second.** P209 returns nothing for Vatican City, which is the case the fallback
exists to cover, so removing it would abandon an intent rather than a dead branch. The right fix
is a verified class QID — at which point the branch also needs bounding, like the other two.

**Not acted on.** Both options change what the app can find, and `verified: false` means the
original choice was never confirmed either.

---

## 30. The party breakdown has no source, and the panel has a bar to draw

**Raised 2026-08-15 while fixing the legislature query for step 9.**

**Context.** The Government tab renders a stacked party-composition bar per chamber, guarded by
`partyBreakdownIsComplete` so it is only drawn when the recorded party seats account for the
chamber exactly. That guard is good and it works. The problem is upstream of it: **the query
has never had a source for party composition.**

It read `P527` — *has part(s)* — and called whatever came back a party. Measured across eight
countries:

| Country | What the "party" clause returned |
| --- | --- |
| GBR | Monarch of the United Kingdom, House of Lords, House of Commons |
| DEU | Member of the Bundesrat, Bundesrat Library, Enquete Commission on Afghanistan, `Q132798745` |
| ISL | Member of the Althing |
| FRA | Finance Committee, European Affairs Committee, `Q59709026` |
| ESP | member of the Senate of Spain |
| SWE | member of the Swedish Riksdag |

**Not one political party in any of them.** Constraining `?party` to actually be a political
party — now shipped — returns **zero rows for every country tried**. That is honest: the panel
says "Wikidata records no party composition for this chamber", which is true.

**Why this needs a decision rather than a fix.** The bar is specced, built, tested and
demonstrably correct against fixtures whose numbers sum. What it lacks is any real country that
can reach it. Per rule 33 a synthetic input must describe a state the real system can reach, and
right now none does — so this is either a sourcing job, a scope cut, or a deliberate
fixtures-only feature, and which one it is depends on priorities I do not set.

### The options, each with what it costs

**A. Source it from `P1410` (number of seats in assembly), constrained to parties.**
Measured: Germany returns real parliamentary groups — *CDU/CSU Bundestag fraction = 246* — mixed
with parties recorded at 0. The United Kingdom returns **constituencies** (Cardiganshire = 1,
Shipley = 1), because `P1410`'s subject is not restricted to parties either. Iceland returns
nothing.
*Cost:* per-country quality varies from good to actively wrong, so it needs the same
country-by-country characterisation the chamber walk just got. It is the most promising route
and it is not a small one.

**B. Count sitting members and group by party (`P39` membership × `P102` party).**
*Cost:* expensive, and it makes the figure `DERIVED` rather than `OFFICIAL` — a real change
to what the panel claims. My two probes of this route were also **wrong in a way worth
recording**: I used position QIDs from memory and Iceland's "Althing membership" returned
*Tories, Whigs and Roundheads*, seventeenth-century English factions. Any serious attempt needs
the position entities verified through the entity table first.

**C. Drop live party composition; keep the bar as a fixtures-only demonstration.**
*Cost:* a specced user-visible feature never appears for a real country, and `UNEXERCISED-PATHS`
gains another built-tested-uncalled entry. Honest, cheap, and a visible reduction in scope.

**D. Source it from outside Wikidata** — IPU Parline publishes chamber composition for most
countries.
*Cost:* a new source through the full gate, and its licence is unread. Every licence read in
this project so far has been less permissive than assumed, five for five, so this is not a
formality.

### My recommendation

**C now, A as its own goal later.** The bar keeps working against fixtures, the live panel
states its absence truthfully, and nothing invents a party. A is worth doing properly — Germany
proves real data exists — but doing it inside step 9 would mean characterising a second query
across the size range while the tab itself is being built, and the last time this project fixed
a query and built on it in one motion, the fix looked convincing and dropped a UK minister.

**What is blocked:** nothing. The panel renders honestly today either way.
**What is NOT blocked:** step 9 proceeds; this decides only whether a live party breakdown ships
with it.

### Disposition, 2026-08-16 — LANDED, and the blocker moved rather than vanished

Item 4c of `CORE-GOAL.md` directed this to land with step 10, and it has. `ScoredInput.weight`
is now `number | null`, `Finding` carries an optional `empty: true`, and `score()` keeps an
empty finding in `inputs` with a null weight.

**What is now provably true**, in `tests/relations-empty-input.test.ts`:

| Layer | Behaviour |
| --- | --- |
| the score | an empty input changes neither score nor tier — proven by comparison against the same set without it, not against a magic number |
| the stale share | empties stay out of the denominator, so they cannot dilute a staleness warning |
| ordering | empties sort last, not among genuinely weightless evidence |
| `nodata` | an all-empty input set is **not** `nodata` — it was investigated; a pair with no findings still is |
| the arithmetic | empties are excluded from the sum and counted in words: `+2 = 2 (1 consulted, no value)` |
| the DOM | `signedWeight(null)` renders "no value", never `0` or `+0` |

**`contributingShortfall` now fires on a real score**, which it never could before — the
mechanism shipped in commit 5 with twelve planted tests and no construction site able to hand it
the state.

**What did NOT close: §14.** The type no longer forbids the state; **no production provider
emits it**, because relations run on a hand-checked seed table where every entry has a value by
construction. So the caveat is still unreachable in production, for a different reason than
before — and that difference is the useful part, because the remaining work is a *provider*
rather than another change to the engine.

`tests/p3-reachability.test.ts` records the move in the site table itself, so the next reader
learns where the blocker went rather than rediscovering that it exists. It flips to reachable
the first time a live ingest answers "asked, nothing there".

**The three-way distinction the engine can now express**, which is the whole point:

```
never consulted        ->  not in the array
consulted, empty       ->  in the array, weight null      <- new
consulted, has a value ->  in the array, weight a number
```

---

## 31. `hasArmedForces` has no source, and the obvious one is wrong in the worst direction

**Raised 2026-08-16, item 4a of `CORE-GOAL.md`.** `UNEXERCISED-PATHS` §15 records this as the
first thing step 10 inherits: `hasArmedForces` is hand-set per fixture and has no source.

**Context.** It is a **constitutional** fact, not a figure, and absent from every statistical
source this app uses. SIPRI and the World Bank publish expenditure and personnel, which answer a
different question — a country can have no recorded spending and still have an army, and a
missing figure is not a zero.

### The obvious route was measured, and it fails on the cases that matter

Wikidata has entities for national armed forces. "Does an *armed forces of X* entity exist,
linked to the country?" looks like the answer. It is not:

| iso | country | query says | ground truth |
| --- | --- | --- | --- |
| CRI | Costa Rica | **has armed forces** | **no army**, abolished 1949 |
| PAN | Panama | **has armed forces** | **no army**, abolished 1990 |
| ISL | Iceland | **has armed forces** | **no standing army** |
| LIE | Liechtenstein | no armed forces | no army, abolished 1868 |
| TUV | Tuvalu | no armed forces | no army |
| FRA / USA / NZL | — | has armed forces | correct |

**Wrong on three of the five no-army countries tested**, and wrong in the direction that
matters: it would tell a reader Costa Rica has an army. The cause is that Wikidata models
*historical* forces and defence agencies as armed-forces entities — Costa Rica's pre-1949 army
exists as an entity, and so does Iceland's coast guard.

Costa Rica is not an incidental example. It is the fixture the military panel's headline
assertion runs on: *"a country with no armed forces says so as a fact about the country"*, and
*"and says explicitly that it is not missing data"*.

**The inverse route does not exist at all.** Wikidata has a class for "country without armed
forces" (`Q1191823`); it has **zero instances**. Nobody populates it.

Coverage for the presence route, for completeness: **189 of 275** countries with an ISO-3 code
have a linked armed-forces entity. The 86 without are a mix of "no army" and "not recorded",
which is precisely the rule-30 ambiguity this field exists to resolve — so even the coverage is
not usable as a signal.

### The options

**A. Keep it curated, per country, with a citation each.** The set of countries without armed
forces is **small (roughly 20) and stable over decades** — abolition is a constitutional event,
not an annual statistic. A hand-checked list with a source per entry is defensible in a way a
query that is wrong on Costa Rica is not.
*Cost:* it is a maintained list, and it must be maintained. It is what the fixtures already do,
made explicit and cited rather than implicit.

**B. Wikidata presence query.** *Refuted above.* Recorded so nobody re-derives it.

**C. CIA World Factbook, "Military and Security Forces".** It states the case in words —
countries with none carry an explicit "no regular military forces" note. US Government work,
public domain.
*Cost:* a new source through the full gate, and the field is prose that would need parsing
rather than a boolean. Every licence read in this project has been narrower than assumed, so
"public domain because US Government" needs reading, not assuming — with the one exception
recorded this session.

**D. Derive it from expenditure or personnel.** *Do not.* Zero spending is not no army, and a
missing figure is not zero. This is the failure the whole app is built to prevent, and it is
listed only because it is the route someone will otherwise propose.

### My recommendation

**A, with C as the verification source when someone has time to read its licence.** The list is
short, the facts change on a scale of decades, and a citation per country is stronger evidence
than a query with a measured 60% error rate on the negative cases.

Concretely: `data/military-seed.json` gains an explicit `hasArmedForces` with a `source` and
`asOf` per country, exactly as its figures already carry, so the value stops being an
uncited boolean in a fixture.

**What is blocked:** nothing today — the panel renders correctly from fixtures. **What this
gates:** the live military ingest cannot set this field from any source currently registered,
so step 10's military conversion either ships with the curated list or ships without the
abolished/absent distinction, and the second is not acceptable.

---

## 32. Population-exposed significance is blocked on a licence nobody can read

**Raised 2026-08-16, Phase C.2.** `V2-GOAL.md` asks for HDX/WorldPop intersected with event
footprints. Probed before designing against it, and there are three blockers — one of which is
an emergency-2 concern rather than an inconvenience.

```
WorldPop API root              200   2770ms   ACAO=(none)   23,441 B
WorldPop pop density service   TimeoutError   30,015ms
WorldPop licence page          404   1853ms
HDX package metadata           200   1200ms   ACAO=*
     "isopen": false, "license_id": "hdx-other",
     "license_other": "[WorldPop licence information](https://hub...)"  -> the 404 above
```

1. **No CORS.** WorldPop's API answers but sends no `access-control-allow-origin`, so it is
   not client-fetchable. That alone is a Worker, not a blocker.
2. **The service that could answer the question times out.** The stats endpoint — the one that
   takes an area and returns a population — did not respond in 30 seconds.
3. **The licence cannot be read.** HDX records the dataset as `isopen: false` with
   `license_id: "hdx-other"`, and the "other" licence links to a page that returns 404.

**Three is the one that decides it.** This project's protocol lists "shipping content whose
terms we have not read" as one of four things that stop work immediately, and every licence
actually read here has been narrower than the plan assumed — five for six, with iptv-org the
lone exception. Ingesting a dataset whose terms 404 would be the exact failure that rule exists
to prevent.

### What was built anyway, and why that is not a consolation prize

The **mechanism** is complete and tested: footprint radius from magnitude, the intersection,
and the decomposition the inspector needs so the figure can be taken apart rather than trusted
(rule 22, and the no-composite-scores prohibition).

Most of the value is in what it does with **no data at all**: `exposed` is `null` with a
stated reason, never `0`. Zero would claim nobody lives near the event; null states a gap in
this app. **An empty grid, by contrast, IS zero** — a source answered and found nobody. Both
directions are asserted, which is question 13's distinction applied *before* the data exists
rather than retrofitted after it caused a defect.

### The options

**A. Serve it through a Worker, once the licence is readable.** Solves CORS and lets the
timeout be retried server-side with a cache. **Blocked on the licence, not on the transport.**

**B. Find the licence elsewhere.** WorldPop is widely cited as CC BY 4.0 in academic papers,
but a citation in a third party's methods section is not the licensor's grant. Reading it means
finding a page WorldPop actually serves.

**C. Use a different gridded source.** GHSL (JRC) and GPWv4 (SEDAC/NASA) both publish gridded
population. Each needs its own gate pass, and SEDAC requires an Earthdata login, which is a
credential the reviewer would have to provide.

**D. Ship the mechanism as-is, reporting "not computed".** Which is where it currently sits: the
input exists, the arithmetic is proven, and the surface says the source is not connected.

### My recommendation

**D now, C later — GHSL first**, because it is the one of the three that is both gridded and
served without a credential. A is not available until B succeeds, and B may simply not be
possible from outside the organisation.

**What is blocked:** the exposure figure itself. **What is not:** everything else in C.2 — the
footprint convention, the intersection, and the decomposition are shipped and tested.
