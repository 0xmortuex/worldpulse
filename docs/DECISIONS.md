# Decision log

Standing decisions, so they survive session restarts. Newest section last.
Rationale lives in `PHASE-0-REPORT.md`; this file is the record of what was settled.

---

## Data sources and licensing

| # | Decision |
| --- | --- |
| 1 | **ACLED excluded.** Registration required, commercial use prohibited without a corporate licence, external publication must be "transformative". **UCDP GED is the sole conflict source.** |
| 2 | **Equipment inventories dropped.** No tank / aircraft / submarine counts ship. The Military tab carries a card naming Global Firepower and IISS Military Balance and explaining why they are unusable. Wikidata-derived figures sit behind an off-by-default toggle, tagged `[DERIVED]`, warning that coverage is uneven and unaudited. |
| 3 | **Project is non-commercial** — personal, open source, no ads, no paid tier. This clears OpenSanctions (CC BY-NC). Every NC and share-alike source is isolated behind its own adapter with a `licenseClass` flag in `sources.json`, so a change in project status means swapping one module. **NosDéputés is ODbL: share-alike is viral into derived datasets, so its data stays in its own store and is never merged into a general-purpose derived table.** |
| 4 | **Arms-transfer arcs dropped.** The UN Register is self-reported and sparse; as arcs, a missing report reads as "no transfers", which is a confident falsehood in the format users trust most. A coverage note explains the restriction instead. |
| 5 | **Keys** (`congress.gov`, UN Comtrade, EIA, TheyVoteForYou) read from env, `.env.example` shipped. Every key-gated panel degrades to "key not configured", never an error. **The app must run end to end with zero keys.** |
| 7 | **UCDP lag accepted but loud.** The conflict layer header states dataset version, coverage end date, and "this is not a live feed". Candidate monthly data is tagged `[ESTIMATE]` (preliminary, subject to revision) and never mixed with GED in one view without visual distinction. |
| 9 | **EU legislature** uses the HowTheyVote weekly GitHub CSV dumps, not the experimental API. **Germany** is labelled named-votes-only so absent routine votes do not read as inactivity. |
| 10 | **Poland** stays Tier 2 until Fundacja ePaństwo is observed responding, verified live during step 9. Do not build against a service not seen to respond. |

## Engine

| # | Decision |
| --- | --- |
| 8 | **Relations restructure approved.** Current bloc membership carries the weight; CoW/ATOP are low-weight corroboration. The traceability popover shows every input's coverage end year; inputs older than five years render greyed with their age. A classification resting mostly on stale inputs renders in a distinct low-confidence treatment. |
| 8a | **Low confidence applies at every tier resting on evidence, neutral included.** A neutral resting on stale evidence and a neutral resting on current balanced evidence are not the same claim. Only "no data" is exempt, having no evidence to be stale about. *(Widened from the original blue/red wording; confirmed.)* |

## Architecture

| # | Decision |
| --- | --- |
| A1 | **Worker proxy only where a probe proves it is needed.** Probes send `Origin` and record `Access-Control-Allow-Origin` per source, yielding client-fetch / Worker-required / key-gated / inconclusive. |
| A2 | **4xx/5xx yields `INCONCLUSIVE`, never `WORKER-REQUIRED`.** A rate-limit 403 is not evidence of CORS posture. |
| A3 | **No visual layer counts as verified without asserting on rendered behaviour**, not the container's existence. See `TESTING.md`. |
| A4 | **The confidence badge is the only sanctioned way to render a fact.** Enforced statically by `tests/fact-discipline.test.ts` using real type information. Escape hatch is `notAFact(value, reason)`, which requires a written reason at the call site. |
| A5 | **A value with no traceable provenance renders as UNTRACEABLE, loudly.** Brokenness outranks emptiness: an untraceable fact shouts even when it has nothing to show, rather than passing as a legitimate "no data". |
| A6 | **`verifiedAgainst: "documentation" \| "live"` per source.** Nothing ships while any runtime source is still `documentation`; `npm run check:deploy` enforces it. Bundled version-pinned sources are not gated — they cannot drift, and their shape is asserted against the real bytes. |
| A7 | **Fact ids are monotonic and never reused.** An earlier per-pass reset let DOM that outlived a pass keep ids later reassigned to other facts, so a badge could open the wrong value's provenance. Showing the wrong provenance is worse than showing none. |

## Feature scope

**Approved and scheduled**

| Feature | When |
| --- | --- |
| Confidence badge with provenance inspector built in | **done, step 2** |
| Source health dashboard | after step 2 |
| Coverage-gap choropleth | with step 12 |
| Leader detail sheet | folded into step 3 |
| Search by endonym / exonym / ISO code | with the top bar |
| Last-known-good offline mode | with the IndexedDB cache layer |

**Deferred — revisit after step 9:** neighbours & borders panel, dossier export with
citations, elections calendar detail, command palette.

**Dropped:** day/night terminator — decorative, and competes visually with the event
layers.

---

## Blocked

**Egress.** The environment's network policy does not permit any of the 33 data hosts;
all return a gateway 403 at CONNECT. `api.github.com` responds 200 as a control, so the
proxy is healthy and the allowlist is the gap. `npm run probe` is written and runs today,
reporting UNREACHABLE. **No further building against assumed CORS posture** until it
returns real verdicts.
