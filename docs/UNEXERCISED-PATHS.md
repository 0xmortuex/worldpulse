# Unexercised paths — enumeration

Code paths, categories, branches and states that may never have run against real data.

**The list is the deliverable, not the gaps in it.** The shipped-but-unvalidated sources
were found by enumerating everything and reading the result, not by anything failing —
so rows are reported here even where they look fine, because a row that looks fine and a
row nobody checked are indistinguishable until someone writes both down.

Generated 2026-08-12 by `scripts/`-adjacent scanning plus manual verification. Where a
row says "unverified", that is a statement about our knowledge, not about the code.

---

## 1. Globe layers — declared versus exercised

| Layer | Declared | Exercised by in-app fixtures | Seen in live data |
| --- | --- | --- | --- |
| `usgs:earthquakes` | yes | yes | yes |
| `eonet:volcanoes` | yes | yes | yes (5 on request) |
| `eonet:wildfires` | yes | yes | yes (191 of 200) |
| `eonet:severe-storms` | yes | yes | yes (3 of 200) |
| `eonet:floods` | yes | **yes — added by this sweep** | yes (6 of 200) |

`eonet:floods` was registered under decision L12 and had **no fixture event**, so its
category mapping, marker, tooltip, click and provenance had never run in the app. Found
by this enumeration within minutes of being introduced — the same class as the three
shipped-but-unvalidated sources, created and caught in the same session. A fixture event
now exercises it.

### EONET categories deliberately unregistered

Nine, each with a recorded reason under L12a. These are **not** unexercised paths — they
are phenomena we have decided a point marker misrepresents. `unregisteredLayers()`
surfaces them in the rail rather than dropping them.

---

## 2. Fact states

| State | Referenced in `src/` | Rendered in the app by a fixture |
| --- | --- | --- |
| `ok` | 6 | yes — every populated panel |
| `nodata` | 11 | yes — gallery and economy no-data cards |
| `broken` | 9 | yes — gallery untraceable case |
| `unconfigured` | 11 | yes — gallery key-gated case |

All four render in the component gallery, which is why the gallery exists: a branch that
never renders in the running app is a branch nobody has looked at.

---

## 3. Provenance kinds

| Kind | Constructed in `src/` | Notes |
| --- | --- | --- |
| `fetch` | 10 | the ordinary path |
| `derived` | 4 | relations score, EONET centroid, tone |
| `seed` | 2 | relations seed data |
| `unconfigured` | 2 | key-gated sources |
| `fixture` | **0** | **not a provenance kind — fixture-ness is a flag on `FetchContext`** |

The `fixture` row is a false alarm from the scan, recorded rather than deleted: it is
`fromFixture` on the context, not a provenance kind. Left visible so the next person
running this scan does not re-investigate it (rule 23's disposal rule).

---

## 4. Position kinds

| Kind | Exercised |
| --- | --- |
| `measured` | yes — USGS points and EONET Point geometries |
| `derived-centroid` | yes — EONET Polygon geometries, 6 present in live data and 2 in the captured fixture |

---

## 5. Source adapters

Ten modules. Coverage after this session's conversions:

| Adapter | Contract test | Live |
| --- | --- | --- |
| `worldbank.ts` | yes | yes |
| `usgs.ts` | yes | yes |
| `eonet.ts` | yes | yes |
| `wikipedia.ts` | yes | yes |
| `wikidata.ts` | yes | no — awaiting three consecutive clean runs |
| `wikidata-dossier.ts` | **yes** — `tests/wikidata-queries.test.ts` | no |
| `wikidata-government.ts` | **partial** — cabinet, judiciary, timeline, person-history covered; **legislature has none** | no |
| `gdelt.ts` | yes | **no — source unusable** |
| `gdelt-tone.ts` | **no** | **no — source unusable** |
| `adapter.ts` | n/a — shared helpers | n/a |

**Closed for five of the six queries.** `tests/wikidata-queries.test.ts` now covers the
dossier, cabinet, judiciary, leadership-timeline and person-history builders against live
captures from real countries.

**`buildLegislatureQuery` remains uncovered, and not for want of trying.** It does not
complete against live Wikidata for any country tested — 504 for the UK, 500 after 60.6s
for Iceland, 504 after 65.5s for Vatican City, all at WDQS's ~60s server timeout. There is
no real capture to write a contract against, and hand-writing one would be a prediction
about a response nobody has seen. See `FOUND.md`.

---

## 6. Known-unexercised, by explicit decision

Recorded so they are not mistaken for oversights:

| Path | Why |
| --- | --- |
| Nine EONET categories | L12a — a point marker misrepresents the phenomenon |
| GDELT tone timeline | source unusable; the panel is to be removed, not approximated |
| Rule-6 collective leadership | O2 — not built until live data confirms the shape |
| P3 missing-data propagation | modelling gap, recorded, lands with step 12 |
| Equipment inventories | decision 2 — no licensable source exists |

---

## 7. What this sweep could not see

Stated so the enumeration is not mistaken for complete:

- **Branches inside adapters.** This counts modules and states, not every `if`. A parser
  branch that has never taken its else path would not appear here.
- **Responsive breakpoints.** Rule 8 asserts three; whether every panel has been rendered
  at each is not enumerated.
- **Error paths in the browser harness.** The skip machinery is exercised, but not every
  guarded branch.
- **Anything keyed on a string the scan did not know to look for** — the same limitation
  that made the source-coverage grid a lower bound.

---

## 8. The fetch layer — the largest unexercised path, and this sweep did not catch it

**There is not a single runtime `fetch` anywhere in `src/`.** Every panel in the
application renders hand-authored fixtures. Verified by search, not assumed:

```
grep -rn "await fetch(\|fetch(" src/ --include=*.ts   →   no results outside src/dev
```

This is not dishonest — the SEED banner is up, every fixture-backed fact carries
`fromFixture: true`, and the inspector renders *"Served from a hand-authored fixture, not a
captured response."* But it reframes what the rest of this document, and the deploy gate,
actually mean.

### Why the sweep missed it

Sections 1–7 look for unexercised **branches inside code that runs**. This is a whole
**layer that does not exist**, and an enumeration of what exists cannot find what was never
written. Section 7 stated the sweep's limits and did not include this one — the honest
conclusion is that "what could this sweep not see" is itself a question that needs
enumerating, not just answering once.

### What `verifiedAgainst: "live"` actually means

**It means a contract test fetched the source and its shape matched.** It does *not* mean
the application has ever fetched anything. Five sources marked `live` and seven clearing
the gate describe **the test suite**, not the app.

That label will mislead someone, and the most likely someone is us. It is recorded here
rather than renamed unilaterally, because the gate's semantics are a decision.

### What exists

| Piece | State |
| --- | --- |
| Response **parsing** per source | built and tested — `expectObject`, `expectArray`, `expectInRange`, `ShapeError` |
| **Provenance** capture (`FetchContext`, `fetchProvenance`) | built; every fixture supplies one by hand |
| **URL construction** | built and now exported per source, used by fixtures |
| Contract tests against live sources | built, 5 sources |
| `ttlMs` in the registry | **declared, never read** — no code consumes it |
| `cache` on `FetchContext` | a *field* every fixture sets to `'miss'`; no cache exists |

### What does not exist

- **Any runtime request.** No fetch call, no request wrapper, no per-source client.
- **Error handling at runtime.** `ShapeError` is thrown by parsers under test; nothing
  catches it in a rendering path, because no rendering path fetches.
- **Retries, backoff, request queueing, per-source concurrency limits** — features 38 in
  the Phase 0 list. None present.
- **Caching or IndexedDB.** `ttlMs` is registry metadata nothing reads; `cache: 'miss'` is
  a literal in fixtures.
- **The Worker proxy.** Needed by 4 sources per the CORS verdicts. Not started.
- **Loading and degraded states.** Every panel renders synchronously from an import, so
  there is no pending state, no partial state, and no error state in the UI — for any
  panel.

### What one panel rendering live data end-to-end would require

Stated as a gap, not a plan:

1. A request wrapper that fetches, times out, and returns a real `FetchContext` — status,
   fetch time, cache state — rather than a hand-written one.
2. Somewhere for the response to be parsed by the existing adapter and for `ShapeError` to
   be *caught*, mapping to the panel's degraded state rather than an exception.
3. Three UI states per panel that today has one: loading, loaded, failed. Rule 8 and rule 9
   apply to each, and none has ever been laid out.
4. A cache honouring `ttlMs`, or a decision that the first version has none — either is
   fine, but silently having none while the registry declares TTLs is the gap that
   matters.
5. For the four WORKER-REQUIRED sources, the proxy, before they can be fetched at all.

**None of this contradicts the contract tests.** They prove the real sources match the
shapes the fixtures predict. They do not prove the app can consume them, because nothing
in the app has ever tried.
