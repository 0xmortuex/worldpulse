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
| A9 | **Text fidelity is asserted separately from geometry** (`scrollWidth <= clientWidth`, SVG advance width, expected formatted strings, and a deliberately extreme fixture per numeric surface). Compaction is allowed; truncation is not — a clipped value is a different number, not an approximation. |
| A10 | **Every fixture-mapped country must exist in the country list**, asserted by test. Regression: the sparse-news fixture pointed at Tuvalu, absent from the 110m topology, so its browser check silently re-tested the USA. |
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
| G1 | **Ministry glosses come from Wikidata's own `schema:description`, verbatim, or an explicit no-description marker. This app never authors them.** *Spec amendment:* the original wording — "a plain-English line on what that ministry actually does" — was reviewed and replaced with "the ministry's description, sourced, or an explicit no-description marker." Recorded here so it is not re-litigated: an authored line explaining what a ministry *actually* does is plausible, unfalsifiable and quietly political. "The Ministry of Public Security handles domestic policing" is one editorial choice away from characterising a secret police force as a police force. Where a ministry has no description, **that gap is the honest output.** |
| G2 | **A party-composition bar is drawn only when party seats account for the whole chamber.** Partial data gets a sentence stating the shortfall, never a bar. |
| G3 | **Untranslated portfolios keep their Q-id and are flagged.** Dropping shrinks the cabinet silently; translating invents. |
| G4 | **"No ministries recorded" and "ministries with no officeholders" are distinct states** and render differently. |
| G5 | **Q-ids used in SPARQL live in one registry, all unverified.** Queries degrade to missing rows rather than wrong rows when an id is wrong. |
| G6 | **Deferred scope renders as a no-data card naming the step that fills it** — the pattern approved in step 3, applied throughout. |

## Overrides

| # | Decision |
| --- | --- |
| O1 | **A rule-1 override requires a constitutional or statutory citation, not a consensus.** Where a constitution names a party's leading role explicitly, cite that article. Where it does not, **the override is not made** and the header resolves by the ordinary rules. Being formally correct and visibly incomplete beats being informally right and unciteable. |
| O2 | **The sixth rule (collective leadership) is not built until live data confirms its shape**, and rules 1–5 are not bent around it. The evidence required to justify it is written down in `WATCHLIST.md` *before* the data is seen — a rule designed after seeing the data tends to be a rule shaped to fit the data. |

## Economy tab

| # | Decision |
| --- | --- |
| E1 | **No data, a mid-series gap, and a stale value are three distinct states** and render differently. A null is never plotted as zero; a gap is never bridged; staleness is stated per indicator, never panel-wide. |
| E2 | **Unit and basis live in the indicator registry, not at the call site.** A monetary value without a currency and a current/constant designation is not a fact. |
| E3 | **Log scale is offered only where the series is strictly positive and spans ≥2 orders of magnitude.** The active scale is always stated; log is refused with a reason for indicators that can go negative. Scale choice resets on country change. |
| E4 | **A late-starting series is not a gap.** Leading and trailing nulls are trimmed before gap detection. |
| E5 | **An indicator with no fixture is listed as "not fetched", not omitted.** An indicator missing from the panel is indistinguishable from one that does not exist. |
| E6 | **Axis labels are compact-formatted.** Regression: "451.53 billion" overflowed its gutter and clipped to "3 billion" — a different number, not merely ugly. Covered by a test asserting a character budget. |

## News tab

| # | Decision |
| --- | --- |
| N1 | **Coverage volume is a property of the index, never the country.** Sparse coverage says "little English-language coverage is indexed", with the source limitation stated. |
| N2 | **Tone is labelled on the chart itself**, in both the visible caption and the accessible label — never a footnote. It is a machine sentiment estimate of indexed English-language coverage, not a measure of conditions. |
| N3 | **A day with no indexed coverage breaks the tone line.** Zero is a real tone value; absence is not. |
| N4 | **The feed deduplicates syndicated copies and shows the outlet count.** Grouping is conservative — case and punctuation only. |
| N5 | **Unusable rows are counted with their reason, not dropped.** One malformed row must not blank a country's news, and a silently shorter list reads as less news. |
| N6 | **Text direction comes from the headline, not the source country.** |

## Globe layers

| # | Decision |
| --- | --- |
| L1 | **Back-facing markers are not pickable.** Enforced via `pointerEventsFilter` using the camera's visible cap, not a hand-rolled world-space normal. |
| L2 | **Coincident events cluster; the marker sits on the strongest member's real coordinate.** Never a group average. Every member is listed in the tooltip, so clustering never makes an event unreachable. |
| L3 | **A polygon-derived position is tagged `[DERIVED]` on the marker** and states the vertex count it reduced. |
| L4 | **Events not updated for 180 days are stale**: excluded from the default view, labelled, never deleted. |
| L5 | **Marker minimum radius is a pointer-target floor, not an aesthetic one.** A marker too small to click cannot be checked. |
| L6 | **Event markers render above the tallest polygon altitude.** Below it, a selected country's raised polygon intercepts the ray and every event inside it becomes visible but unopenable. |
| L7 | **A magnitude in a marker tooltip is a badged fact, not a printed number.** The event carries the magnitude twice: a bare number for sizing, sorting and clustering, which are geometry, and the `Fact` the tooltip renders. Both are built from the same field in `toGlobeEvents` so they cannot disagree. An unreviewed automatic solution must never be presentable as an analyst-reviewed one, and a tooltip is not an exemption from the badge. |
| L8 | **A layer with no magnitude concept carries no magnitude fact at all.** Distinct from a quake whose magnitude is genuinely null: EONET does not measure magnitude, so rendering "no data" for one would invent a missing value rather than report an absent one. |
| L8a | **Amended after live data. The original reason above is FALSE and is left visible on purpose** — a decision that was right for a wrong reason is worth seeing whole (same treatment as G1). EONET *does* measure: every geometry carries `magnitudeValue` and `magnitudeUnit` — 9673 `hectare` for a wildfire's burned area, 35 `kts` for a storm's winds. The app was discarding a published NASA figure because we had assumed it did not exist. **Corrected decision:** parse it into a distinct unit-bearing `measurement` fact, render it as value + unit with its own OFFICIAL badge, and **never feed it into the point-sizing scale**. Sizing is comparative and there is no honest comparison between 9673 hectares and 35 knots, nor between either and moment magnitude; non-quake events keep a fixed size. **Never aggregate, average or rank across units** — a future "biggest events" panel is per-unit within a category, or it is nothing. The original conclusion (`magnitude` stays null for EONET) survives; only its justification changes. |

## EONET category scope

EONET publishes 13 categories; the app registered 3. The other 10 were not a bug —
`unregisteredLayers()` surfaces them in the rail rather than dropping them, which is the
design working — but which to register had never been decided.

| # | Decision |
| --- | --- |
| L12 | **`floods` is registered as a layer.** 6 of 200 live events, already specced, and a flood is the same kind of thing as the three layers already carried. |
| L12a | **The remaining nine stay unregistered, with reasons, and `unregisteredLayers` keeps surfacing them.** `drought`, `tempExtremes`, `seaLakeIce`, `snow`, `waterColor` and `dustHaze` are slow-onset or areal phenomena that a point marker misrepresents — a drought is not located at a coordinate, and rendering one as a pin would be the position-precision error decision L3 exists to prevent. `landslides` and `manmade` are candidates but were absent from a 200-event sample, so registering them would ship a layer whose live path has never been exercised. `earthquakes` is deliberately excluded: USGS is the earthquake source, and carrying EONET's as a second layer would double-count the same events under two provenances. |

**Registering a layer is a claim that a point marker represents the phenomenon.** For
half of EONET's categories that claim is false, which is why the honest default is to
leave them unregistered and visible rather than mapped and wrong.

## Verification

| # | Decision |
| --- | --- |
| V1 | **The browser suite reports per step, every run.** A step whose assertion count silently drops to zero is indistinguishable from a step that passed. Attribution comes from the runner, never from someone counting call sites by hand. |
| V2 | **A skipped check exits non-zero.** Guarded assertions that do not run are recorded and printed. "All checks passed" must describe the suite the reader thinks they are reading. |
| V3 | **The runner refuses a bundle older than its sources**, and `npm run verify` builds first. Every prior green run was produced by a runner that could pass without executing the code under test. |
| V4 | **Every helper whose pass condition is "the problem list is empty" must first assert it examined something.** Applied to `assertTextFits` and `assertSvgTextFits`; `assertLayout` already had it. |
| V5 | **One mutation per step, run as a suite** (`npm run mutate`). A mutation that survives is a check that cannot see the behaviour it names. Ad-hoc self-tests proved two checks could fail; this proves one per step. |
| V6 | **Number-to-string conversions reaching markup are enumerated and must be justified.** The fact-discipline rule is enforced through types, so any `string`-returning function is a bypass. The laundering signature is specific — a call in a render path that takes a number and yields a string — so the registry stays small enough to be read. Sanctioned (`factHtml`, `notAFact`) or registered with a justification, and a registered helper must genuinely route through a sanctioned one. |
| V7 | **A verdict is never stronger than its evidence.** `BUILD-FAILED`, `TIMEOUT` and `UNPARSED` are distinct from `CAUGHT`: a compiler noticing, a hang, and a run that aborted before the assertion executed are three different claims, and none of them is "the check can see this". |
| V8 | **Rule 8 asks whether content fits its box, not whether the box reached zero.** A row squashed to 2px with its text clipped away is invisible; defining "collapsed" as exactly zero let it pass. |

## Provenance propagation

A derived value is only as trustworthy as what it was computed from. Inputs used to be
ignored entirely, so a seed with no citation rendered **BROKEN** on its own and vanished
into a confident DERIVED value the moment it became an input — `scoreFact` has exactly
that shape, so a relation score built on an uncitable seed looked identical to one built
on a cited one.

| # | Rule |
| --- | --- |
| P1 | **Untraceability propagates unconditionally.** Any broken input makes the derivation broken. Not a coverage question: a number resting on a value nobody can check is a value nobody can check. |
| P2 | **Unconfigured propagates.** If an input's source needs a key that is not set, the pipeline never ran and there is nothing to be confident about. |
| P3 | **Missing data propagates through REQUIRED inputs only.** A derivation declares which inputs it needs and which merely contribute; a shortfall among contributing inputs renders as a caveat, never silently absorbed. |
| P4 | **A derived fact is always tier DERIVED** and inherits the loudest caveat among its inputs. It can never present as more authoritative than what produced it. |

Precedence when inputs disagree: **broken > unconfigured > nodata > ok**, and brokenness
is checked before emptiness so a derivation that is both still shouts.

**P3 is not implemented, and this is a modelling gap rather than an oversight.**
`DerivedProvenance.inputs` is `Provenance[]`, not `Fact[]`. A provenance records how a
value was obtained; "no data" is a property of the *value*, which it does not carry — so
a derivation cannot currently see that an input came back empty. Closing it means
`inputs: AnyFact[]`, or recording each input's state beside its provenance, which changes
the shape every adapter emits. It lands with the first derivation that genuinely needs
it; the step-12 choropleth will force the issue.

## Classification watchlist

`docs/WATCHLIST.md` lists countries expected to be hard to classify, written **before**
seeing live data so the predictions are falsifiable. At egress: populate the `qids`
arrays, key on Q-id as primary with the label as an independent second signal, and
**output `undetermined` and log a finding when the two disagree** — neither wins silently.

## The P3 class — a register, not a rediscovery

**P3 says missing data propagates through required inputs.** It is unimplemented, and it
keeps reappearing in new places. This is the register, so the third instance is
recognised rather than re-derived.

| Instance | Shape | State |
| --- | --- | --- |
| Relations score | `DerivedProvenance.inputs` is `Provenance[]`, not `Fact[]`, so a derivation cannot see that an input came back empty | open — needs `inputs: AnyFact[]` or per-input state |
| Coverage-gap choropleth (step 12) | will force the modelling change above | pending |
| **Breaking-news significance score** | a weighted sum over five inputs, two of which (elections, sanctions) do not exist and one of which (UCDP) is unshipped | **open, and specced below** |

**The invariant across all three: in a weighted sum, an absent input and a zero
contribution are indistinguishable.** A score computed without them is not the same score
with a footnote — it is a *less reliable* score, and any ordering built from it inherits
that unreliability.

| # | Decision |
| --- | --- |
| P5 | **A missing input renders as UNAVAILABLE in the arithmetic, never as zero.** Zero is a measurement; absence is not. |
| P6 | **The surface header states which inputs were available at compute time, not only the individual cards.** The *ordering* is a product of the incomplete input set, so the disclosure belongs where the ordering is presented. |
| P7 | **Where two items' relative order would change if a missing input took any plausible value, they do not present as confidently ordered.** This reuses the tie-band mechanism, applied to uncertainty from missing inputs rather than from close scores. An exact computation is not required: **a conservative approximation that widens the band is acceptable, because over-declaring uncertainty is the safe direction.** |
| P8 | **The disclosure is permanent and data-driven, never a temporary banner.** It reports whatever is unavailable at compute time, forever. A banner someone removes when elections land is a banner that stops telling the truth the next time an input goes missing — a feed outage, a key not configured, a source degraded. **"We will add the inputs later" must not become the reason the incompleteness stops being disclosed once they do.** |

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

## Source registry corrections — measured, 2026-08-12

| # | Decision |
| --- | --- |
| 9a | **Poland drops to Tier 2 now, not at step 9, and `epanstwo-pl` is removed from the registry.** Decision 10 said "do not build against a service not seen to respond", and it has now been *seen not to respond*: `api.sejmometr.pl` fails at CONNECT with the request cancelled — the host does not resolve — across four probe runs. Fundacja ePaństwo winding down its services was the Phase 0 caveat and this confirms it. A dead host left in a table that reports 34 sources is a table that overstates coverage by one, every run, in the direction of looking healthier than it is. Poland renders as Tier 2: official-but-unstructured, no vote endpoint. |
| A1a | **`wikimedia-commons` was WORKER-REQUIRED because of our own query string.** MediaWiki emits `Access-Control-Allow-Origin` only when the request carries `origin=*`. Without it: 200, no ACAO. With it: 200, `ACAO: *` — **CLIENT-FETCH**. This is Wikidata's error in a second place, and portraits are a step-3 dependency that has already shipped, so it is corrected before anything is built on the wrong verdict. **Every MediaWiki request this app makes must carry `origin=*`**; it is a property of the API, not of one probe URL. |
| A1b | **`gdelt-doc` gets one probe after a full day, and a fifth distinct failure is a finding, not a verdict.** It has now failed four times in four different ways: 429, 429, connection error, connect timeout. If a single probe after a day's interval fails a fifth way, that is a **Phase 0 correction about GDELT's availability**, not an inconclusive CORS result — and it matters because GDELT is the news tab's only source and **no fallback is specced for it**. Phase 0 §4 lists "per-country RSS" as the fallback for News; that is a sentence, not a design. |

## Phase 0 correction — GDELT is not a usable source

Recorded 2026-08-12 after **eight consecutive failures across a full session**, in four
distinct modes, with quiet intervals between several of them:

| # | Result |
| --- | --- |
| 1 | HTTP 429 |
| 2 | HTTP 429 |
| 3 | connection error |
| 4 | connect timeout (targeted, after a gap) |
| 5 | `fetch failed` at 10.9s (single request, not a sweep) |
| 6 | HTTP 429 |
| 7 | HTTP 429 |
| 8 | HTTP 429 |

**Zero successful responses.** Phase 0 §4 listed GDELT DOC 2.0 as the news source at
~15-minute cadence; that was read from documentation and has never been observed.

| # | Decision |
| --- | --- |
| 11 | **GDELT is held UNREACHABLE and is not a foundation for anything.** It stays in the registry with its failure history attached rather than being deleted — a removed source is a source nobody knows was tried. |
| 11a | **Re-entry is through the same gate as everything else:** fixture, contract test, then `live`. If GDELT starts responding it becomes an *enrichment on top of* the RSS feeds, never the base layer again. |
| 11b | **The tone timeline is removed, not approximated.** It is GDELT-only and has no fallback. Computing sentiment ourselves would mean this app authoring an editorial judgement about coverage it cannot cite — G1's rule, and N2's caveat exists precisely because the number is a machine estimate rather than a measurement. An estimate we produced ourselves would have no source at all. |
| 11c | **The news tab's source becomes a curated per-country RSS list.** Phase 0's fallback was the sentence "per-country RSS"; this makes it a source with per-feed licensing recorded. |

### The finding about the news tab, stated precisely

The news tab **does not** currently render from GDELT and does not degrade to an empty
panel. Like every other panel, it renders hand-authored fixtures, labelled: the SEED
banner is up and each fact's inspector says *"Served from a hand-authored fixture, not a
captured response."* **The app makes no runtime fetches at all** — see
`UNEXERCISED-PATHS.md` §8.

So this is not a shipped wrong-value defect. It is a panel with **no viable live source**,
which matters when the fetch layer is built and not before. Recorded this way because an
earlier report of mine described it as "shipping against a source that never responded",
which was wrong and made the item sound more urgent than it is.

## Contested and ambiguous identity

| # | Decision |
| --- | --- |
| D9 | **When an ISO 3166 code resolves to more than one Wikidata entity, the app refuses.** It renders `undetermined`, names every QID, and states the reason. **It never assembles a dossier across entities and never picks a canonical one.** Measured: `P298 "PSE"` binds both `Q219060` and `Q407199`, and the app's query drew fields from both — which is why Palestine returned two heads of government, one from each item. A dossier assembled across two items is a record of neither. **Choosing between them would be this app taking a position on statehood, which is not ours to take** — so refusing is not merely the safe answer here, it is the correct one. Resolving a specific case needs a reviewed decision naming which entity is treated as the country, with a citation, exactly as a rule-1 override does. |
| D10 | **A country with several recorded forms of government is `undetermined`, with every value named.** Afghanistan returns `Emirate`, `islamic theocracy` and `unitary state`; Palestine returns `parliamentary republic`, `semi-presidential system` and `unitary state`. They do not classify alike, and SPARQL guarantees no row order, so picking the first was a coin flip whose outcome could differ between two loads. Naming the disagreement reports where it actually lives — in the source. |

## Cross-country officeholders

| # | Decision |
| --- | --- |
| D7 | **A shared head of state and an ex-officio foreign office are different arrangements and are never phrased alike.** Enumerated live: Charles III across 24 states and territories, Willem-Alexander across 4, Frederik X across 3 — one crown held across several states. Andorra is not that. Macron holds the Andorran co-princedom **because** he is President of France: an office of one country conferring an office in another. Andorra does not share a head of state with France; it shares a constitutional consequence of France's presidency. Flattening the two into one phrasing would state something false about both. |
| D8 | **The shared relation is rendered, tagged `[DERIVED]`, with the count computed from the query.** Omitting it misleads: Jamaica's dossier shows the same portrait as Canada's with nothing connecting them. The count is never hardcoded — a literal 24 is a fact with no provenance and goes stale silently — and per rule 22 the label states **what** it counts, since "states and territories" includes crown dependencies and is not a count of sovereign states. |

## Known user-facing risk — marker clicks on low-frame-rate devices

**This is a product risk, not a harness note.** It is recorded here rather than only in
`TESTING.md` because the honest statement of it is a claim about users, not about tests.

**Symptom.** Clicking an event marker does nothing. No camera move, no detail, no error —
the globe appears to ignore the click.

**Mechanism, located by instrumentation and not inferred.** The DOM click reaches the
canvas every time. globe.gl's `onPointClick` does not fire. Our `facesCamera` occlusion
filter is not the cause and never rejected a front-facing marker: it computed `true` in
all 12 instrumented trials, and `true` inside the handler on the trials where the handler
ran. The loss is inside globe.gl's own raycast, between delivery and resolution.

**What can and cannot be claimed.** No code in this repository drops the click. That is
*not* the same as "the app is fine". The mechanism is a raycast failing to resolve at a
low frame rate, and a slow device is a low frame rate. The accurate statement is:

> We have never tested this on a device slow enough to reproduce it in the field, and our
> only slow environment reproduces it in about 90% of single attempts.

| # | Decision |
| --- | --- |
| L9 | **Marker clicks may not resolve on low-frame-rate devices. Known, located in globe.gl's raycast, unfixed.** Not to be described as a test-environment quirk: the same mechanism is available to a user on slow hardware. |
| L10 | **The keyboard/list equivalent for globe interaction is load-bearing, not an accessibility nicety.** It is the mitigation for L9 as well as the accessibility requirement. **Every event reachable by clicking a marker must be reachable from the event feed and the country list**, and that equivalence is asserted, not assumed. Build it with the feed. |
| L11 | **Cheap defence, noted and not built:** resolve a click from the last hovered point rather than requiring a fresh raycast on the click frame, if globe.gl's API permits. Deferred — a fix without a mechanism for *why* the raycast resolves on some frames and not others would be another unvalidated guess, and this investigation has already produced two. |

Mitigation is the strategy here, not repair. A defect in a dependency that we cannot
explain is one we should route around rather than paper over, and the route already
exists in the spec.

## Phase 0 correction — UCDP is no longer a keyless API

Recorded against decisions 1, 5 and 7. Measured 2026-08-12, first session with egress.

**The UCDP REST API now requires a token on every endpoint.**

```
GET https://ucdpapi.pcr.uu.se/api/gedevents/26.1 -> 401
API token required. Add header: x-ucdp-access-token: <your-token>
```

Not a version pin and not one endpoint: `gedevents` 24.1 and 26.1,
`ucdpprioconflict`, `battledeaths`, `nonstate` and `onesided` all answer 401. Phase 0
§1.2 recorded "Fully RESTful JSON … No key", which was true when read from documentation
and is false against the live service.

**This premise was load-bearing twice**, which is why it is recorded here rather than
fixed quietly: decision 1 excluded ACLED partly because UCDP was the clean alternative,
and decision 5 promises the app runs end to end with zero keys.

### A keyless path exists, and it is the better one

| Path | Status | Evidence |
| --- | --- | --- |
| REST API, all endpoints | **keyed** | 401, token required |
| Bulk CSV, `ucdp.uu.se/downloads/ged/ged261-csv.zip` | **keyless** | 200, `application/x-zip-compressed`, 39,122,522 bytes, `PK\x03\x04` |
| Candidate monthly CSV | **keyless** | 200 |

Licence unchanged and confirmed on the downloads page itself: *"All datasets are free of
charge and licensed under CC BY 4.0 — you are free to use and redistribute them provided
you cite the relevant publications listed with each dataset."*

| # | Decision |
| --- | --- |
| 1a | **UCDP is reached through the bulk CSV downloads, not the API.** GED is released annually; a live API buys nothing a version-pinned download does not, and it would cost the zero-key property. No UCDP key is introduced. `sources.json` probes the download path. |
| 5a | **Decision 5 stands.** The zero-key property is preserved by 1a, not by luck — it would have been broken by adopting the keyed API. |

**Open, and deliberately not decided here:** at 39MB the GED zip is not a per-visitor
browser fetch. It wants either version-pinning as a bundled dataset — which under A6a
requires a registered byte-level shape assertion before the gate will pass it — or a
Worker-side extract with the client fetching a filtered slice. That is an architecture
decision, not a source-registry edit, and it is recorded rather than made.

### ACLED's exclusion, re-examined rather than assumed

Decision 1 excluded ACLED *and* named UCDP as the sole conflict source, so it is fair to
ask whether the exclusion rested on UCDP being clean. **It did not, and it still holds.**
The objections in Phase 0 §1.1 are properties of ACLED's own terms: registration and an
access key are required, commercial use is prohibited without a corporate licence with no
exemptions, and external publication must be "transformative" — which rendering events on
a map is not. None of those turn on what UCDP does. UCDP becoming keyed would have made
ACLED *equally* keyed, not more permissive.

Stated because it was asked for explicitly, not because the answer was in doubt.

## Blocked

**Egress.** The environment's network policy does not permit any of the 33 data hosts;
all return a gateway 403 at CONNECT. `api.github.com` responds 200 as a control, so the
proxy is healthy and the allowlist is the gap. `npm run probe` is written and runs today,
reporting UNREACHABLE. **No further building against assumed CORS posture** until it
returns real verdicts.
