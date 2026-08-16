# Phase 0 — market data providers

Investigated 2026-08-16, before any of SPEC-WARWATCH §1 was built, because that section
requires it: *"Report what is actually available, its licence, its delay, and its rate
limit **before** committing to a provider — a provider chosen for convenience and
discovered later to forbid redisplay is a rewrite, not a fix."*

This is the same gate Phase 0 applied to the original 34 sources, and it reaches the same
kind of conclusion it reached for WorldPop: **the surface as specified cannot be built
honestly from what is freely available.** What can be built is smaller and differently
named, and the difference is stated on screen rather than papered over.

## The headline finding

**There is no free, keyless, redistribution-permitted source of live market quotes.**
Not one candidate survived all three tests at once. The tests are not negotiable:

1. **The licence permits redisplay to third parties.** L15 governs: a licence nobody has
   read is not permission, and neither is a licence that is merely *probably* fine.
2. **The key, if any, can be kept secret.** This app is a static client. An API key in the
   bundle is a published API key.
3. **The browser can actually read the response** — CORS, measured by `npm run probe`,
   not assumed.

## What was examined

| Candidate | Licence / terms | Key | Verdict |
| --- | --- | --- | --- |
| **EIA** (US Energy Information Administration) | **Public domain** — "U.S. government publications are in the public domain and not subject to copyright protection". Attribution requested, not required | Required, free | **USABLE, via the Worker** |
| **World Bank Pink Sheet** | CC BY (version not stated on the landing page; the World Bank's dataset terms are CC BY 4.0) | None | **USABLE, with caveats** |
| **FRED** (St. Louis Fed) | Third-party series carry their own copyrights and "before using data with a copyright notice for anything other than personal use, you must contact the data owner". Also forbids "data mining, scraping, or extraction" | Required, free | **REJECTED** |
| **Stooq** | No terms-of-use page found | None | **REJECTED** |
| CommodityPriceAPI, Commodities-API, Oil Price API, AURUM, Alpha Vantage, EODHD | Commercial freemium; redistribution restricted or unstated | Required | **REJECTED** |
| Yahoo Finance endpoints | Undocumented endpoints, ToS forbids it | None | **REJECTED, on principle** |

### Why FRED is rejected despite being the obvious choice

FRED is the standard answer to "free economic time series", and it carries Brent
(`DCOILBRENTEU`) and WTI (`DCOILWTICO`) — but it is an **aggregator**, and its terms make
the aggregation the product. Redistributing copyrighted series commercially needs the
copyright owner's permission, which FRED cannot grant on their behalf, and determining
which series are affected means reading a notice per series.

The series this app would want are mostly EIA's anyway. **Going to EIA directly removes
the aggregator and the question at once** — and EIA's terms are the clearest of anything
examined. Preferring the origin over the convenient middleman is the same reasoning that
put Wikidata behind a `verifiedAgainst` field rather than trusting a scrape.

### Why Stooq is rejected for having no terms

Stooq serves keyless CSV quotes and is widely used for exactly this purpose. No
terms-of-use, licence, or data-policy page could be found. **L15 settles it: silence is
not a grant.** This is the same standard that blocked WorldPop — and blocking a source we
would like to use is what makes the standard mean anything.

## What this costs the spec

§1 asks for "war-relevant commodities (Brent, WTI, natural gas, gold, wheat), major
indices, defence-sector equities". Against the table above:

| Asked for | Available | Status |
| --- | --- | --- |
| Brent, WTI, natural gas | EIA, public domain | **Buildable** |
| Gold, wheat | World Bank Pink Sheet, monthly | **Buildable, monthly only** |
| Major indices | Nothing redistributable | **NOT BUILDABLE** |
| Defence-sector equities | Nothing redistributable | **NOT BUILDABLE** |

Index and equity quotes are a licensed product everywhere they appear. The exchanges sell
them; the free tiers that carry them forbid redisplay. **There is no honest route to them
without a commercial licence**, so they are not going in, and their absence is rendered as
an app-owned gap in the wording decision #32 fixed: *this app has no source connected for
these*, never an implication that the market did not trade.

## And it is not a ticker

The word has to go, because the thing it names does not exist here.

- **EIA daily spot prices are published with a lag**, not streamed. A value is a
  **published official price with an as-of date**, not a quote.
- **Pink Sheet prices are monthly averages**, which is a different quantity again — an
  average is not a close, and rule 22 forbids putting the two in one column as though
  they were the same measurement.

§1's own rules already anticipate this and are stricter than they look: *"If the feed is
15-minute delayed, the strip says so, permanently"* and *"Market closed is a state, not a
stale number."* A strip carrying a monthly average under a scrolling ticker chrome would
break both — **ticker styling is itself a claim about freshness.**

So the surface is a **commodity price strip**: per-symbol as-of date, per-symbol cadence
(daily-with-lag vs monthly average), no scrolling-tape styling, and a permanent statement
of what the numbers are. Rule 47 applies to every stored value in it.

## A prerequisite the spec did not name

SPEC-WARWATCH's build order says the ticker "exercises the fetch layer" and that the
fetch layer does not exist. **That is now out of date** — `src/fetch/` exists and the
economy panel's states are asserted in verify step 7b.

The real missing prerequisite is different: **EIA is key-gated, so it needs the edge
Worker, and the edge Worker has not been built.** `src/fetch/compose.ts` already refuses
to route a secret key any other way — it throws `secret key ... requires transport
"worker"` — so this is enforced, not merely intended. 18 sources in CORS-VERDICT.md are
already marked WORKER-REQUIRED and are waiting on the same thing.

**The Worker is therefore a dependency of §1, and it belongs with deployment** (V2-GOAL
section 5), not inside the ticker. Recorded as a reorder rather than a surprise.

## The fragile URL, recorded before it breaks

The Pink Sheet download URL contains a versioned path segment that changes:

```
https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx
                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

The 2025 files sit under a different hash. **This URL will rot**, and it will rot silently
into a 404 that a careless adapter would render as "no data". It is a build-time fetch
into a committed artefact for exactly that reason — the same treatment as the armed-forces
table — so a rotted URL fails a generator run in front of a human instead of emptying a
panel in front of a reader.

The file is `.xlsx`, not CSV. Parsing a spreadsheet is a real cost and it belongs in the
generator, never at runtime.

## Recommendation

**Build the strip from EIA energy prices only, at first, and state the rest as gaps.**

- EIA gives three of the five commodities, in the public domain, with the clearest terms
  of anything examined. It needs the Worker, which is coming anyway.
- Pink Sheet adds gold and wheat as **monthly averages, labelled as such**, via a
  build-time generator — worth doing, but it is a second unit and must never share a
  column with a daily price.
- Indices and defence equities are **not buildable** and get the app-owned gap wording.

**Queued for the reviewer, not blocking:** whether a commodity strip that omits indices
and equities is still worth the header space it takes, given that half of §1's content
list cannot be sourced. Building it is the reversible choice, so it is being built.

## Sources read

- EIA, *Copyrights and reuse*: <https://www.eia.gov/about/copyrights_reuse.php>
- EIA, *Open Data API v2 documentation*: <https://www.eia.gov/opendata/documentation.php>
- FRED, *API Terms of Use*: <https://fred.stlouisfed.org/docs/api/terms_of_use.html>
- St. Louis Fed, *Legal notices*: <https://www.stlouisfed.org/about-us/legal-information>
- World Bank, *Commodity Markets*: <https://www.worldbank.org/en/research/commodity-markets>
