# Warwatch-class surfaces — specification

**Status: specified, not started. Builds after the current queue.**

Six surfaces. Every one is subject to the existing rules without exception — confidence
tiers, sourcing discipline, and rules 8, 9, 22, 24 and 30. Nothing here gets a shortcut
for being visually impressive; that is the category of feature most likely to be granted
one, which is why it is written down first.

**Every item enters through the existing gate: source registered → fixture captured from
live → contract test passing → `live`.**

---

## The through-line

Four of these six surfaces are, structurally, the same failure waiting to happen: a
display that looks authoritative over data that is partial in a way the display cannot
show. The biohazard choropleth, the broadcast-traffic map, the severity bands and the
prediction-market widget each invite a reader to conclude something the data does not
support.

The rule that governs all four is already written — **rule 30's register**: *no answer is
not an answer of no*. An absent marker, an absent case count, an absent market and an
absent severity all mean "we did not observe", and all four render as if they meant zero.

---

## 1. Market ticker strip

A horizontally scrolling row below the header, above the globe. Fixed height, monospace.

| Requirement | Detail |
| --- | --- |
| Content | Symbol, price, absolute change, percent change |
| Direction | Green up / red down **and** an arrow glyph **and** a sign. **Never colour alone** — the arrow and sign carry the meaning for colourblind readers |
| Contents | War-relevant commodities (Brent, WTI, natural gas, gold, wheat), major indices, defence-sector equities |
| Configuration | **Data-driven, never hardcoded.** The symbol list is a registry file, like `indicators.json` |
| Provenance | Every value carries its as-of timestamp and source, reachable from the ticker's own inspector. **A ticker is still rendered facts** and rule A4 applies — the badge is the only sanctioned way to render one |
| Delay | **If the feed is 15-minute delayed, the strip says so, permanently.** Presenting delayed quotes as live is a wrong-value error, not a cosmetic one |
| Closed markets | **Market closed is a state, not a stale number.** Show last close, explicitly labelled as a close |
| Clipping | Rule 9 in full. A clipped price is a different price, and prices are the densest numeric surface in the app |

**Phase 0 required before building.** Free tiers with no key preferred. Report what is
actually available, its licence, its delay, and its rate limit **before** committing to a
provider — the same investigation Phase 0 did for the original 34 sources, and for the
same reason: a provider chosen for convenience and discovered later to forbid redisplay
is a rewrite, not a fix.

---

## 2. Globe mode switcher

A segmented control above the globe: **CONFLICT / TRACKING / BIOHAZARD**. It is a *preset
selector* over the existing layer toggles and dossier, replacing neither.

- **Mode is URL state**, per the existing deep-link requirement.
- Each mode states its data sources and their freshness in a header line.

### Conflict mode

Country outlines coloured by conflict state.

- **Reuse the existing relations palette semantics.** Never a second colour language — a
  reader who has learned that red means adversary must not meet a red that means something
  else two clicks away.
- Colour by a **stated, computed property** — active state-based conflict from UCDP, a
  fatality-count band, or conflict recency — **named on screen, with a legend**. Never an
  unexplained "threat level".
- **No composite threat score.** A single number combining conflict, economy, unrest and
  press freedom into "how dangerous is this country" is an editorial claim wearing
  arithmetic. If a composite is ever built it must be **fully decomposable in the
  inspector and adjustable**, exactly like the relations score — and the default answer
  is that it is not built.

### Biohazard mode

Outbreak tracking: a choropleth plus per-country count markers.

- A **disease sub-selector**. Only pathogens with a current sourced dataset appear in it —
  an empty selector entry is a promise of data we do not have.
- Choropleth bands are case counts, with **thresholds stated in the legend** and the
  **counting basis named**: confirmed or suspected, cumulative or incident, and over what
  window. **Rule 22 — a count with no basis is not a fact.**
- Sources: WHO Disease Outbreak News, ECDC, national health agency feeds. Registered **per
  country and pathogen** with its cadence. Outbreak data lags; **the panel says by how
  much**.

> **A country with no data renders as no-data, distinct from zero cases.**
>
> This is the empty-cabinet rule at its highest stakes. *"No reported cases"* and *"no
> surveillance data"* are different claims, and conflating them misinforms about exactly
> the countries least able to report — painting a surveillance gap as good news.

### Tracking mode — read before building any of it

Vessel and aircraft positions. AIS via a free-tier provider; ADS-B via OpenSky.

> ### THIS IS NOT MILITARY TRACKING AND IS NEVER LABELLED AS SUCH.
>
> Military vessels and aircraft routinely disable or spoof AIS and ADS-B. A tracker built
> on these shows the traffic that is **broadcasting** and silently omits the traffic that
> matters — the empty-cabinet bug in the highest-consequence place it could occur.

| # | Requirement |
| --- | --- |
| T1 | The mode is titled **"Broadcast Traffic"** |
| T2 | Its header states, **permanently and in plain language**, that it shows only vessels and aircraft transmitting on public transponders, that military and covert traffic commonly does not, and that **absence of a marker is not evidence of absence** |
| T3 | **No "military" filter, no military icon set, no classification implying we can identify military assets.** If a vessel self-reports a type, that is a self-report and is labelled as one |
| T4 | Free-tier rate limits are strict: **Worker-cached, never per-visitor** |

### Hormuz Strait monitor

A regional view of the same broadcast traffic through a named chokepoint, with transit
counts over time and relevant commodity prices alongside.

- **The Tracking-mode disclosure appears verbatim, not softened for a focused view.** A
  narrower frame makes the omission more misleading, not less — a reader looking at one
  strait is more likely to believe they are seeing all of it.
- Transit counts are **counts of broadcasting vessels**, labelled as such. Never "traffic
  through the strait".

---

## 3. Intel feed

A full-page chronological feed across all sources, separate from the per-country news tab.

- Search; sort by most recent or oldest; range filter 24h / 7d / 30d / all time.
- Header counters: total items, and counts per severity band.
- Cards: image where the source provides one, headline, outlet, country flag, relative
  timestamp, severity badge.
- Pagination with a stated total.

### Severity bands

**`[DERIVED]`, computed, never authored and never model-generated.** Same treatment as the
news-board ranking, from the same measurable inputs: outlet breadth, syndication volume,
event linkage to a tracked conflict/outbreak/sanction, and geographic spread.

- A **"why this severity" inspector** showing the arithmetic, walking down to the source
  articles.
- **User-adjustable weights.**
- **Reuse the news-board scoring engine.** A second ranking mechanism would drift from the
  first, and two surfaces disagreeing about which story matters is worse than either being
  wrong alone.
- Stated on the surface: **severity reflects coverage volume and event linkage, not
  editorial importance.**
- Rule 22 applies to the score exactly as it does on the news board: inputs measured in
  different units are normalised to unitless contributions before weighting, and the
  normalisation is documented.

### Timestamp discipline

Relative times are computed from the item's **own publication timestamp**.

> **A future timestamp is a data error.** It renders as *"publication time unavailable"* —
> never as "in 2 hours". The reference implementation gets this wrong; do not copy it.

This is rule 30 again: a timestamp we cannot interpret is not a timestamp in the future.

---

## 4. Dashboard

**Per-user, local-only. No accounts, no server-side profile, no tiers.**

- Saved items with counts, reachable and removable.
- Reading history.
- The existing country watchlist and change digest, surfaced here.
- Everything persisted locally, with a **visible clear-all**.

**No clearance level, no tier badge, no "access" language.** This project is
non-commercial with no paid features (decision 3), so there is nothing to gate — and a
clearance indicator over a public dataset is theatre that implies the data is privileged
when it is open.

---

## 5. Prediction markets

Polymarket's public API, no key. Market question, current price, volume, resolution date,
for markets tied to tracked countries or conflicts.

> **These are market prices — what traders are paying — not forecasts and not
> probabilities.** A market at 34% is a price. **Never render one as "34% chance of war".**

- Tagged `[OFFICIAL]` for the price **as reported by the exchange**. Never derive a
  probability from it.
- **Never aggregated into any composite indicator.**

The label is permanent and on the widget, not in a tooltip. The conversion from price to
probability is one a reader will make unaided; the widget's job is to not perform it for
them.

---

## 6. Public webcams

Public traffic and city cameras from an open directory, keyed to country.

| # | Requirement |
| --- | --- |
| W1 | Titled **"Public Cameras"**, never "war cams". A camera pointed at a city is not a view of a conflict, and framing it as one invites viewers to read ordinary footage as combat |
| W2 | Every camera shows its **stated location and the directory that listed it**. A camera whose location cannot be verified **does not render** |
| W3 | **Only cameras published for public viewing by their operator.** No scraping, no reframing of streams the operator has not made public |
| W4 | **Nothing that could show identifiable people at a resolution raising a privacy issue in a conflict zone.** This is a licence-and-ethics constraint, not a quality one |
| W5 | Health-check before showing available, same as the TV grid |

---

## Build order

1. **Market ticker** — simplest, and exercises the fetch layer
2. **Intel feed**, reusing the news-board scoring engine
3. **Dashboard**
4. **Biohazard mode**
5. **Prediction markets**
6. **Public cameras**
7. **Conflict mode presets**
8. **Broadcast traffic and Hormuz** — last, **because its disclosure requirements are the
   strictest and it must not be built under time pressure**

### A dependency the order implies

Item 1 "exercises the fetch layer", and **the fetch layer does not exist** — no runtime
`fetch` appears anywhere in `src/` (`UNEXERCISED-PATHS.md` §8). The ticker is therefore
the first surface that requires building it: a request wrapper, error handling reaching a
panel's degraded state, loading/failed states, and caching. That is a prerequisite, not a
detail of the ticker, and it should be planned as one.
