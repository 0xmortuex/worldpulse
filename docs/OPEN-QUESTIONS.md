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

Three things, and only three. Everything else gets appended and the work continues.

| # | Emergency | Why it cannot wait |
| --- | --- | --- |
| 1 | **Destructive or irreversible** | Deleting data, force-pushing over history, dropping a source's only copy. The cost of asking is a pause; the cost of proceeding cannot be undone. |
| 2 | **Licence violation** | Redistributing data a licence forbids, or shipping content whose terms we have not read. This project's non-commercial standing (decision 3) and its per-feed restrictions are load-bearing, and a violation is not fixed by a later commit — it has already happened. |
| 3 | **The app would assert a false fact to a user** | A wrong value rendered with confidence. Rule 7's category: absent provenance is loud and self-correcting, wrong provenance is silent and self-justifying. This is the failure the whole project is built to prevent, so it outranks finishing the task it was found during. |

A defect that is *latent* — real but not reachable by a user today, like the form-of-government
coin flip while the app makes no runtime fetches — is **not** an emergency. It is recorded
here or fixed in place, and the work continues.

## Status

**Five open.** All surfaced during the queue run of 2026-08-12.

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
