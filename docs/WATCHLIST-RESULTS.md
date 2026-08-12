# WATCHLIST — first contact with live data

`WATCHLIST.md` was written **before** any live Wikidata response was seen, deliberately, so
its predictions would be falsifiable. This is the first time any of them has met real
data. Measured 2026-08-12 against `buildCountryQueryUrl()` — the query the app actually
issues, not a simplified stand-in.

**Confirmations are reported as prominently as refutations.** A prediction that held is
evidence the resolution rules are sound, and recording only the failures would make the
rules look worse than they are.

---

## Results

| Country | Predicted | Live `P122` label | Rule fired | Verdict |
| --- | --- | --- | --- | --- |
| France | rule 2 — semi-presidential, president leads | `semi-presidential system` | **2** | **CONFIRMED** |
| Switzerland | `undetermined`; may need a collective rule | `federal republic` | none → `undetermined` | **CONFIRMED** |
| Bosnia and Herzegovina | `undetermined`; 3-member presidency | `republic` | none → `undetermined` | **CONFIRMED** |
| Andorra | `undetermined`; two co-princes, one a foreign head of state | `parliamentary coprincipality` | none → `undetermined` | **CONFIRMED** |
| China | `undetermined`; rule-1 override candidate | `people's republic` | none → `undetermined` | **CONFIRMED** |
| Saudi Arabia | rule 4 — king is also prime minister | `monarchy` | **4** | **CONFIRMED** |

**Six of six predictions held.** Saudi Arabia's 502 was transient; re-run, it returns
`monarchy`, rule 4 fires, and the same person holds both offices — `Salman bin Abdulaziz
Al Saud` as King *and* as Prime Minister, exactly as predicted. Every country expected to be hard was hard, in the way
it was expected to be hard, and the label-driven classifier returned `undetermined` rather
than guessing in every case where the arrangement does not fit rules 1–5.

France is the one that matters most for the other direction: the prediction was that rule
2 *would* fire, and it did, on the exact label predicted (`semi-presidential system`).
The rules work where they are supposed to work.

---

## Findings beyond the predictions

### 1. Switzerland returns an office where a person is expected — CONFIRMED, and it is the whole problem

```
hos       = "Swiss Federal Council"
hosOffice = "Member of the Swiss Federal Council"
```

`P35` resolves to **the Federal Council itself**, not to a councillor. WATCHLIST predicted
this class explicitly:

> *Countries where `P35` is an **office rather than a person**, which the parser would read
> as a person named after the office — worth an explicit check.*

That is precisely what happens. The parser has no way to tell "Swiss Federal Council" from
a person's name, so the dossier header would render a body as its head of state, complete
with a portrait slot. **This is a wrong value, not a missing one** — rule 7's worse
category — and it is live today for any user selecting Switzerland.

### 2. Andorra returns a foreign head of state as its own — CONFIRMED exactly

Two distinct people across two distinct offices:

```
Emmanuel Macron                 — co-prince (ex officio, as President of France)
Josep-Lluís Serrano Pentinat    — "French co-prince of Andorra"
```

WATCHLIST called this the case *"most likely to break a naive collective rule"* because the
two heads of state are *"neither peers nor domestic"*. Live data confirms it and adds a
wrinkle: the query returns both the French President and a second person on a
French-co-prince-titled office, so a naive "take the first binding" would attribute
**France's president to Andorra** with no signal that anything is unusual.

### 3. Bosnia returns two concurrent holders of one office

```
Denis Bećirović      \  both on office "Presidency of Bosnia and Herzegovina"
Željka Cvijanović    /
```

Two of the three presidency members, sharing a single office label. This is the exact
signature the sixth-rule evidence standard asks for in its first criterion.

---

## What this means for the sixth rule — the pre-committed standard, applied

`WATCHLIST.md` recorded, before any data was seen, four criteria that must **all** hold
before a collective-leadership rule is written. Applying them:

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Multiple concurrent holders of the same office | **Bosnia yes** (2 holders, 1 office). Andorra **no** — 2 holders on 2 *different* offices. Switzerland **no** — 1 "holder" that is a body. |
| 2 | The office item itself expresses plurality (`P1342` > 1) | not yet queried |
| 3 | A rotating or shared presidency is modelled, not inferred | not yet queried |
| 4 | The pattern holds across more than one country — at least three with **the same structural signature** | **FAILS.** Three candidates produced **three different signatures**: a body-as-person, two people on two offices, two people on one office. |

**The sixth rule is not justified.** Criterion 4 fails, and it fails in the most
informative way possible: the three countries that look alike from a distance — "more than
one plausible primary portrait" — are structurally unlike each other in the data. Writing
one rule for all three would have been writing a rule shaped to a resemblance rather than
to a mechanism.

That is exactly the outcome the pre-commitment was designed to make visible. Had the
standard been written after seeing this data, it would have been very tempting to define a
signature that covers all three.

**Per the standard's own fallback:** where the criteria hold for a single country only,
the answer is a rule-1 override with a constitutional citation. Switzerland (Federal
Constitution Art. 174–177), Bosnia (Dayton Annex 4 Art. V) and Andorra (Art. 43) each
qualify separately, and each is cheaper, more honest and reversible.

---

## What must be fixed regardless of the sixth rule

The Switzerland case is a **live defect**, not a modelling question. A body rendered as a
person is a wrong value on a shipped panel, and it does not wait for a rule:

1. **Detect that `P35`/`P6` resolved to a non-person.** The entity's `P31` (instance of)
   distinguishes a human from a collective body; the query does not currently ask for it.
2. **Render `undetermined` with the reason named**, never a portrait frame around an
   institution.
3. **Two concurrent holders of one office must not silently become one.** Bosnia's binding
   set is exactly the case where "take the first row" produces a confident, arbitrary
   answer — and the query returns them in no guaranteed order, so it is not even stable
   between requests.

---

## Method note

Every figure above comes from `buildCountryQueryUrl()`, the app's own query builder,
rather than a hand-written approximation of it. That matters here more than usual: three
of six fixtures in this project were found recording requests the app does not make, and a
WATCHLIST check run against a simplified query would have proven nothing about the app.


---

# Enumeration — the set was not closed

Three countries were examined because WATCHLIST named them. Enumerating the whole of live
Wikidata instead of assuming that set was complete found considerably more.

## Non-person heads of state — 2 countries

| ISO | Country | `P35` resolves to | `P31` class |
| --- | --- | --- | --- |
| CHE | Switzerland | Swiss Federal Council | cabinet / collective head of state |
| HTI | **Haiti** | Transitional Presidential Council | provisional government / political institution |

**Haiti was also predicted** — WATCHLIST lists it under transitional governments as
*"Transitional council rather than a single head of government"*. Two for two on this
class, and both are live wrong-value defects today.

## Multiple concurrent `P35` holders — **15 countries**, not 3

| Holders | Countries |
| --- | --- |
| 6 | San Marino |
| 3 | Bosnia and Herzegovina |
| 2 | Madagascar, Malawi, Bulgaria, Hungary, Libya, Niger, Albania, Andorra, Sint Maarten, Australia, Samoa, Central African Republic, Falkland Islands |

**This is the most consequential finding of the survey, and WATCHLIST predicted the
mechanism exactly:**

> *Countries where the head-of-state statement has **no end date on a former holder**, so
> the `FILTER NOT EXISTS pq:P582` guard returns two current holders.*

Australia, Bulgaria, Hungary and Albania are not collective heads of state. They are
almost certainly **stale statements nobody closed** — the guard the app depends on is
insufficient, and it is insufficient for **fifteen countries**, not the three that looked
interesting. San Marino returning **six** Captains Regent where the constitution provides
two is the clearest case: three unclosed pairs.

### What this does to the sixth-rule question

It strengthens the refutation considerably. The multi-holder signature is **dominated by
data-quality artifacts**, not by collective arrangements. WATCHLIST framed the whole
question as distinguishing:

> **(A) a genuine collective head of state** … from **(B) a resolution failure**

The live distribution says (B) outnumbers (A) by roughly four to one. A sixth rule keyed on
"more than one concurrent holder" would have promoted twelve stale records into
constitutional arrangements.

## Cross-country officeholders

Andorra remains the only confirmed case in the sample: Emmanuel Macron appears as a head
of state of Andorra by virtue of being President of France. Detecting this needs a
different query — a holder whose office is tied to another country — and is not covered by
the two surveys above. **The set is not closed and should not be assumed to be.**
