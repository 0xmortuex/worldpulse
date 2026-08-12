# Breaking News Board — specification

A ranked news surface separate from the per-country News tab, digesting four time
horizons.

**Status: specified, not started. Blocked on the RSS fallback (item 3).**

---

## The blocking dependency, stated first

**This must not be built against GDELT.** GDELT has failed six of six attempts across a
full session — 429, 429, connection error, connect timeout, `fetch failed`, 429 — and is
recorded UNREACHABLE. A ranking engine built on a source that has never once responded is
a ranking engine nobody has seen rank anything.

The build order is therefore: **the curated RSS fallback lands first**, then the ranking
engine and card layout are built against fixtures, then they wire to real feeds. The
fixtures are not a placeholder for the feed — they are the regression suite, per D6.

---

## Time horizons

Four tabs — **Today**, **This Week**, **This Month**, **This Year** — each a **ranked
digest**, not a filter. The top N stories by computed significance, never the most recent.

| Horizon | Stories |
| --- | --- |
| Today | ~10 |
| This Week | ~10 |
| This Month | ~12 |
| This Year | ~15 |

"~" is a ceiling, not a target. **A period with fewer qualifying stories shows fewer, and
never pads.** Padding a digest to a round number is inventing significance to fill a
layout.

---

## Significance ranking — `[DERIVED]`, and the whole surface says so

"Biggest story of the month" is an editorial judgment. This project has spent nine steps
refusing to make unexplained ones, so the ranking is computed from stated inputs using
**exactly the relations-score pattern**: weighted inputs, a visible arithmetic popover,
user-adjustable weights, live re-ranking.

### Inputs

Every input is measurable from the feed. **None requires us to judge importance.**

| Input | Measured as |
| --- | --- |
| Outlet breadth | count of distinct outlets carrying the story |
| Syndication volume | total article count (grouping already exists — N4) |
| Coverage duration | days the story has been covered |
| Geographic spread | count of distinct countries whose feeds carry it |
| Event linkage | maps to a tracked event: active UCDP conflict, an election in-window, a new sanctions listing, or a natural event above a stated threshold |

### Requirements

- The surface is tagged `[DERIVED]` as a whole, not per card.
- **A "why this ranked here" inspector on every card**, showing each input's contribution
  and the arithmetic, walking down to the source articles — the relations popover, applied
  to news.
- **User-adjustable weights with live re-ranking**, as in the relations panel.
- Default weights documented in the README.
- **The caveat is the headline, not a footnote:** *this ranks coverage volume, not
  importance.* A story covered by many outlets is not thereby more important, and a story
  the press ignores scores zero. That sentence renders on the surface itself.
- **Ties do not present as a confident ordering.** Scores within a stated epsilon render
  as a tied band, not as ranks 4, 5, 6.

### Normalisation — required by rule 22, not optional

The score sums contributions from inputs measured in **different things**: outlet counts,
days, country counts, a boolean linkage. Rule 22 forbids aggregating across units, and a
raw sum of `12 outlets + 9 days + 4 countries` is exactly the incoherent arithmetic it
names.

**The sum is only legitimate because each input is normalised to a unitless contribution
in [0, 1] before weighting.** That normalisation is part of the score's definition, not an
implementation detail:

- **it is stated per input in the README** — the function, its bounds, and what saturates
  it
- **the arithmetic popover shows the raw measurement and its normalised contribution
  side by side**, so a reader can see that 40 outlets became 0.9 and why

Without a stated normalisation the score is not merely undocumented, it is incoherent —
rule 22 applied to our own derivation rather than to a source's.

### Missing inputs — an instance of the P3 class

Two of the five inputs (elections, sanctions) do not exist, and a third (UCDP conflict
linkage) is unshipped. **A weighted sum missing two of five inputs is not a complete score
with a footnote; it is a less reliable score, and the ranking inherits that.** See
DECISIONS P5–P8, which are binding here:

- missing inputs render **UNAVAILABLE**, never zero — in a weighted sum the two are
  indistinguishable
- **the surface header** states which inputs were available at compute time, because the
  *ordering* is a product of the incomplete set, not just the individual scores
- **where two stories' relative order would flip if a missing input took any plausible
  value, they render in a tied band** rather than as a confident ordering; a conservative
  approximation that widens the band is acceptable, since over-declaring uncertainty is
  the safe direction
- the disclosure is **permanent and data-driven**, computed from what is unavailable at
  compute time — never a banner removed when elections land, because the same mechanism
  must still fire for a feed outage or an unconfigured key years later

### The failure mode this design is guarding against

A ranked list is the most authoritative-looking format there is. Presenting
coverage-volume as significance without saying so would make press attention look like
editorial judgment, which is the same class of error as the relations engine presenting a
score as a fact. The score is honest; **the label on the score is what makes it honest.**

---

## Card design

A dark satellite-map backdrop showing the subject country's region; the country's state
emblem in a hexagonal frame outlined in a meaningful colour; a BREAKING chip; a large
two-tone headline (accent on the primary actor, white on the rest); a short Brief Look;
and a source badge.

Constraints, each of which overrides the aesthetic where they conflict:

| # | Constraint |
| --- | --- |
| C1 | **The hex outline reuses the existing relation palette** (red/blue/amber/grey) when a story involves two countries, so colour means the same thing here as on the globe. **Never introduce a second colour language.** |
| C2 | **Emblems come from Wikidata `P94` via Commons**, with the same licence-and-credit handling as leader portraits and the same initials-placeholder fallback. **Never substitute a flag for a coat of arms** without labelling it as such — they are different objects with different meanings. |
| C3 | **The map backdrop is generated from the same Natural Earth data as the globe**, never a stock image. A decorative map that does not match the actual region is a wrong-value error in the most eye-catching element on screen. |
| C4 | **BREAKING is a computed state with a stated definition** — first indexed within N hours AND above a score threshold. **If it cannot be computed, it does not render.** A decorative BREAKING chip is a lie in the largest type on the card. |
| C5 | **Rules 8 and 9 apply in full.** This is the densest, most tightly-composed surface in the app. Fixture the extremes *before* laying it out. |

---

## Sourcing discipline

The reference design presents one outlet's anonymous sourcing in a format that reads as
established fact. **That is precisely the failure this project exists to prevent.**

| # | Rule |
| --- | --- |
| S1 | **Every card names its outlet prominently** — not in a corner badge. |
| S2 | **A single-source story says so explicitly.** A visible marker, not a hover. |
| S3 | **Where outlets disagree, show the disagreement** rather than picking a winner. |
| S4 | **"Brief Look" is extracted or quoted from the source article with attribution, never written by us.** Summarising news in our own words is authoring editorial content, and authored content has no source to cite. This is G1's rule — the app never writes the words — applied to news. |
| S5 | **Never render an unattributed claim**, however confident the underlying article is. |

S4 is the one most likely to be argued with later, so the reasoning is recorded: a
summary we write is unfalsifiable and unsourceable. The moment we compress "officials say
X" into "X", we have made a claim no outlet made and no citation supports.

---

## Hard cases — fixture these before any layout work

Per rule 9's fourth clause and rule 10, these are the fixtures, and a set containing only
the happy path would predict every one of them correctly and catch none.

| Case | What it must prove |
| --- | --- |
| One outlet vs. forty | the single-source marker (S2) renders, and breadth scoring separates them |
| Three or more countries | which emblem leads, how the others appear, what the hex outline colour means when there is no pair |
| **No country at all** (a market move, a scientific finding) | the card renders without an emblem or a map region, and does not invent one |
| Too few stories to fill a digest | shows fewer, never pads |
| **No stories at all** | reads as "no coverage indexed", never "nothing happened" — this is N1's rule, and the distinction is the whole point |
| Two stories within the tie epsilon | renders as a tied band, not a confident ordering |
| A country with no `P94` coat of arms | initials placeholder, never a flag substituted silently (C2) |
| A headline long enough to break the two-tone split | the split degrades legibly; no clipping (rule 9) |
| RTL and non-Latin headlines | direction from the headline, not the country (N6); no character-budget assumptions |

---

## What this surface must never become

A page that tells someone what the most important thing in the world is today. It tells
them **what the indexed English-language press covered most**, with the arithmetic shown
and the limitation stated. Those are different claims, and the difference is the product.
