# Classification watchlist

Countries whose government form is expected to be hard to classify, written **before**
seeing what the live API returns. That ordering is the point: a list compiled after
reading the data would be a list of what the data happens to say, not a list of what we
expected to be difficult. Predictions made in advance are falsifiable; post-hoc ones are
not.

**This is the first thing to check by hand when egress opens.** For each entry: run the
dossier query, record the `P122` label and Q-id actually returned, and record which rule
fired. Where the outcome differs from the expectation below, that is a finding — either
the resolver is wrong or the expectation was.

## Why this list exists

Classification is currently label-driven (`data/government-forms.json`), because Q-ids
could not be verified from the build environment. That is accepted as a temporary
scheme. Labels are mutable, multilingual and inconsistently worded — "federal
parliamentary republic" and "parliamentary republic" describe the same arrangement, and
only one of them contains the exact substrings the rules match on.

### At egress, the scheme changes

1. Populate the `qids` arrays from verified Wikidata entities.
2. Key on **Q-id as primary**, keep the label match as an **independent second signal**.
3. **If Q-id and label disagree, output `undetermined` and log the disagreement as a
   finding.** Neither wins silently. A disagreement means one of them is wrong, and
   which one is exactly the thing worth knowing.

---

## Hybrid and compound forms

The wording risk: qualifiers ("federal", "unitary") sit in front of the phrase the rules
match on. `contains` matching survives that, but a rewording to "federation with a
parliamentary system" would not match `["parliamentary", "republic"]`.

| Country | Why it is hard | Expected rule |
| --- | --- | --- |
| Germany | "federal parliamentary republic" — qualifier prefix | 3 |
| Austria | Federal, but the chancellor leads in practice | 3 |
| India | Federal parliamentary republic; ceremonial president | 3 |
| Switzerland | Directorial system. **No single head of government.** The seven-member Federal Council rotates the presidency annually — the header's one-primary-portrait model may not fit at all | expect `undetermined`; likely needs a sixth rule |
| Bosnia and Herzegovina | Three-member rotating presidency | expect `undetermined` |
| San Marino | Two Captains Regent serving jointly, six-month terms | expect `undetermined` |
| Andorra | Co-principality: two heads of state, one of them a foreign bishop | expect `undetermined` |

Switzerland, Bosnia, San Marino and Andorra are the cases most likely to require a
**collective leadership** rule. Do not force them into rule 3.

## Semi-presidential systems

Rule 2 deliberately routes these to the head of state, because the president holds
executive power. The risk is the opposite reading — that the prime minister is treated
as the real leader — and the balance genuinely differs between countries.

| Country | Note |
| --- | --- |
| France | Canonical semi-presidential. President leads. |
| Russia | Formally semi-presidential; practice is more presidential |
| Portugal | Semi-presidential on paper, parliamentary in practice — prime minister is the effective leader, so rule 2 may produce a defensible but misleading header |
| Poland | Similar: president is directly elected but the prime minister governs |
| Finland | Moved decisively toward parliamentary practice since 2000 |
| Ukraine, Romania, Taiwan | Balance shifts with the incumbent |

Portugal and Finland are the two most likely to need an override or a rule refinement.

## Transitional, military and contested governments

Highest churn. Rule 5 keys on words like "junta", "provisional", "transitional" — but
Wikidata may record the pre-coup form for months after a seizure of power, or may
already have normalised the arrangement to "republic".

| Country | Why |
| --- | --- |
| Mali, Burkina Faso, Guinea, Niger, Gabon | Post-coup arrangements; expect stale or normalised labels |
| Sudan | Contested authority between rival forces |
| Myanmar | Military administration alongside a claimed civilian government |
| Libya | Rival administrations claiming the same offices |
| Afghanistan | Unrecognised government; office titles may not map to any rule |
| Syria | Governing authority changed in December 2024; the step-1 seed already flags its diplomatic status as under review |
| Haiti | Transitional council rather than a single head of government |

For all of these, **rule 5's refusal to normalise the title is the whole value**. Check
specifically that the title rendered is the one actually in use.

## One-party and ideologically-specific states

Labels here often describe ideology rather than mechanism, so they match no rule.
`undetermined` is the correct output, not a defect — but confirm the header says so
rather than silently showing whichever office came back first.

| Country | Likely label | Expected |
| --- | --- | --- |
| China | "socialist republic" / "one-party state" | `undetermined`; real authority is the party general secretary, which likely needs a rule-1 override |
| North Korea | Titles do not map to ordinary offices | `undetermined`; override likely |
| Vietnam, Laos, Cuba | Party-led; general secretary or first secretary outranks the state president | `undetermined`; override candidates |
| Eritrea | Single-party, no elections since independence | `undetermined` |
| Iran | Already overridden (rule 1) | 1 — regression-check the override still fires |

**These are the strongest candidates for new rule-1 overrides.** Each needs a
constitutional or statutory citation before being added — a widely-held view about who
really holds power is not a citation.

## Monarchies

The rules split on "absolute" versus "constitutional", and several monarchies sit
between the two.

| Country | Why |
| --- | --- |
| Saudi Arabia | King is also prime minister; rule 4 should fire |
| Morocco, Jordan, Eswatini | Constitutional in form, executive in practice — rule 3 will fire and may understate the monarch |
| Thailand | Constitutional monarchy with an unusually strong crown |
| Liechtenstein, Monaco | Constitutional monarchies with real princely powers |
| Vatican City | Absolute elective monarchy; the head of state is also a religious office |
| Malaysia | Elective monarchy, five-year rotation among state rulers |
| United Arab Emirates | Federation of monarchies with an elected federal president |

Morocco and Jordan are the clearest cases where a formally-correct rule 3 may mislead.
Resolve by override with a constitutional citation, or accept and document.

## Microstates and unusual arrangements

| Country | Why |
| --- | --- |
| Vatican City | See above |
| Monaco | Minister of State is appointed by the prince |
| Liechtenstein | Prince retains veto and dissolution powers |
| Kosovo, Northern Cyprus, Somaliland | Carry user-assigned non-ISO codes in this app; Wikidata coverage and `P298` presence are both uncertain |
| Palestine | Contested statehood; office data may be split across entities |
| Western Sahara | Disputed; may return no `P122` at all |

## Coverage gaps to expect

Beyond misclassification, expect outright absence:

- Countries with **no `P122`** at all → `undetermined` (correct behaviour, but confirm)
- Countries with **no `P35` and no `P6`** → `no-data` header
- Countries where `P35` is an **office rather than a person**, which the parser would
  read as a person named after the office — worth an explicit check
- Countries where the head-of-state statement has **no end date on a former holder**,
  so the `FILTER NOT EXISTS pq:P582` guard returns two current holders

---

# CLOSED — the sixth rule is refuted (2026-08-12)

**Verdict: not justified. Do not write it.** Full evidence in `WATCHLIST-RESULTS.md`.

The standard below required, as criterion 4, that the same structural signature hold
across at least three countries. Live data produced **three different signatures** from
the three candidates:

| Country | Signature |
| --- | --- |
| Switzerland | one "holder" that is a body, not a person |
| Andorra | two holders on two *different* offices, one of them a foreign head of state |
| Bosnia | two holders on *one* office |

And a survey of all countries found **15 with multiple concurrent holders**, of which most
— Australia, Bulgaria, Hungary, Albania among them — are stale statements with no end
date rather than collective arrangements. A rule keyed on "more than one holder" would
have promoted about twelve data-quality artifacts into constitutional arrangements.

**Why this is recorded as reasoning and not just a verdict:** a standard written *after*
seeing this data would have been very tempting to bend. Three countries that look alike
from a distance — each producing "more than one plausible primary portrait" — invite a
single rule, and the resemblance is real at the level of appearance. It is the *mechanism*
that differs, and only a pre-committed criterion made that difference decisive rather than
negotiable. The next person tempted to define a rule after reading data should read this
paragraph first.

Each of the three proceeds instead as a **rule-1 override with a constitutional
citation**, per the fallback below. The citation requirement holds without exception: if a
case cannot be cited, it does not get an override.

---

# What would justify a sixth rule

Written **before** seeing live data, deliberately. A rule designed after reading the
API tends to be a rule shaped to fit the API — it will classify the sample perfectly
and generalise badly. Committing the evidence standard in advance makes the decision
falsifiable.

Rules 1–5 are **not** to be bent to accommodate these cases in the meantime.
`undetermined` is the correct output until the evidence below is actually observed.

## The distinction that matters

The whole question is whether we are looking at:

- **(A) a genuine collective head of state** — an office designed to be held by several
  co-equal people simultaneously, or
- **(B) a resolution failure** — one office, one holder, and we could not work out which
  office leads.

These look identical from a distance: both produce "more than one plausible primary
portrait". Conflating them would let every parsing bug present itself as a
constitutional arrangement, which is a far worse outcome than an honest `undetermined`.

## Evidence required for (A), all of it

1. **Multiple concurrent holders of the same office.** The `P35` or `P6` statement set
   contains two or more entries with overlapping validity — `P580` start dates set,
   no `P582` end date, and the intervals genuinely overlap. Two open-ended statements
   where one is simply a stale record that nobody closed is (B), not (A), and the
   step-3 `FILTER NOT EXISTS pq:P582` guard already assumes exactly that.
2. **The office item itself expresses plurality.** The office reached via `P1906`/`P1313`
   carries a seat count (`P1342` > 1), or `P2124`/an equivalent membership property, or
   its `P31` resolves to a collective-body class rather than a personal office. An
   office with `P1342 = 7` held by seven people is (A). An office with no seat count
   held by two people is more likely (B).
3. **A rotating or shared presidency is modelled, not inferred.** A distinct chair or
   presidency office exists (Switzerland's annually rotating President of the
   Confederation; Bosnia's rotating chair) and is queryable — rather than us noticing
   that several people appear and deciding it must rotate.
4. **The pattern holds across more than one country.** At least three of the candidate
   countries below produce the same structural signature. A rule justified by one
   country is an override, and should be written as one.

If 1–3 hold for a single country only, **make it a rule-1 override with a
constitutional citation** — Switzerland's Federal Constitution Art. 174–177, Bosnia's
Dayton Annex 4 Art. V, San Marino's Art. 3. That is cheaper, more honest, and reversible.

## Candidates and what each should show

| Country | Expected structure | Signature to confirm |
| --- | --- | --- |
| Switzerland | Federal Council, 7 co-equal members; presidency rotates annually | 7 concurrent `P6`/`P35` holders; council office with `P1342 = 7`; separate rotating-president office |
| Bosnia and Herzegovina | 3-member Presidency, rotating chair | 3 concurrent `P35` holders; `P1342 = 3`; chair modelled separately |
| San Marino | 2 Captains Regent, joint, six-month terms | 2 concurrent `P35` holders; term length ≈ 6 months on `P580`/`P582` |
| Andorra | 2 co-princes, one of them a foreign head of state | 2 concurrent `P35` holders, **not** co-equal in the same sense — one is *ex officio* another country's president. This may need its own treatment rather than the collective rule |

Andorra is the case most likely to break a naive collective rule: two heads of state
who are neither peers nor domestic. Watch it specifically.

## This is a header problem before it is a resolution problem

**The panel is built to hold one primary portrait and one labelled secondary.** Seven
co-equal Federal Councillors do not fit that, and neither does a rotating chair that
must be shown as *primus inter pares* without implying it outranks the others.

Discovering this at step 13, after the compare view, time scrub and URL state all
assume a single primary, would be expensive. So before any sixth rule is written:

- Sketch the header variant first — a grid of equal portraits with no primary, plus a
  distinct treatment for a rotating chair.
- Check what else assumes one primary: `comparePortrait()` renders one figure per
  compare column; the leader detail sheet is opened by a single Q-id; the time scrub
  will want "who led on date X" and must be able to answer "these seven did".
- Decide whether the collective case renders as one card or N cards, **before** the
  resolution rule forces the answer.

The resolution rule is the easy half. Write the header variant down first.
