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
