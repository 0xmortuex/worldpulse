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
| A8 | **Layout is asserted geometrically at 360px, 900px and desktop** — no overlap, no overflow, no collapsed elements. Presence and text assertions are blind to layout; the dual-portrait overlap shipped past a fully green suite. The harness carries a self-test that recreates that bug and confirms it is caught. |
| A4 | **The confidence badge is the only sanctioned way to render a fact.** Enforced statically by `tests/fact-discipline.test.ts` using real type information. Escape hatch is `notAFact(value, reason)`, which requires a written reason at the call site. |
| A5 | **A value with no traceable provenance renders as UNTRACEABLE, loudly.** Brokenness outranks emptiness: an untraceable fact shouts even when it has nothing to show, rather than passing as a legitimate "no data". |
| A6 | **`verifiedAgainst: "documentation" \| "live"` per source.** Nothing ships while any runtime source is still `documentation`; `npm run check:deploy` enforces it. Bundled version-pinned sources are not gated — they cannot drift, and their shape is asserted against the real bytes. |
| A6a | **`verifiedAgainst` gains a third value, `bundled`.** The gate has no exceptions: every active source prints with its status on every run. `bundled` requires a registered byte-level shape assertion, checked by the gate itself, so it cannot be used to wave a source through. |
| A7 | **Fact ids are monotonic and never reused.** An earlier per-pass reset let DOM that outlived a pass keep ids later reassigned to other facts, so a badge could open the wrong value's provenance. Showing the wrong provenance is worse than showing none. |

## Dossier header

| # | Decision |
| --- | --- |
| D1 | **The resolution rule that fired is always displayed**, tagged DERIVED. Which office leads is this app's judgement, not something any source states. |
| D2 | **Office titles are never normalised.** A junta leader keeps the literal title in use. |
| D3 | **Form-of-government classification is label-driven, not Q-id driven**, because Q-ids could not be verified from this environment and a wrong one misclassifies silently. Unmatched labels yield `undetermined`, never a guess. |
| D4 | **An override without a source citation and review date is ignored.** An override is a reviewed correction, not a place to encode an opinion. |
| D5 | **Never substitute another person's photograph.** Missing portrait yields an initials placeholder. Commons credit is assumed required when the licence cannot be read. |
| D6 | **Leader fixtures are a permanent regression suite.** A live contradiction is a finding to investigate, not a fixture to update. People in fixtures are synthetic; the invariant is which rule fires. |

## Government tab

| # | Decision |
| --- | --- |
| G1 | **Ministry glosses come from Wikidata's own description or not at all.** A guessed remit reads as fact. |
| G2 | **A party-composition bar is drawn only when party seats account for the whole chamber.** Partial data gets a sentence stating the shortfall, never a bar. |
| G3 | **Untranslated portfolios keep their Q-id and are flagged.** Dropping shrinks the cabinet silently; translating invents. |
| G4 | **"No ministries recorded" and "ministries with no officeholders" are distinct states** and render differently. |
| G5 | **Q-ids used in SPARQL live in one registry, all unverified.** Queries degrade to missing rows rather than wrong rows when an id is wrong. |
| G6 | **Deferred scope renders as a no-data card naming the step that fills it** — the pattern approved in step 3, applied throughout. |

## Classification watchlist

`docs/WATCHLIST.md` lists countries expected to be hard to classify, written **before**
seeing live data so the predictions are falsifiable. At egress: populate the `qids`
arrays, key on Q-id as primary with the label as an independent second signal, and
**output `undetermined` and log a finding when the two disagree** — neither wins silently.

## Feature scope

**Approved and scheduled**

| Feature | When |
| --- | --- |
| Confidence badge with provenance inspector built in | **done, step 2** |
| Source health dashboard | after step 2 |
| Coverage-gap choropleth | with step 12 |
| Leader detail sheet | **done, step 3** (partial — timeline, party history, predecessor/successor and news mentions render as explicit no-data cards pending steps 4 and 6) |
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
