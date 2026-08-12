# The fetch layer — design proposal

**Status: proposed, not built. Nothing in this document has been implemented.**

The app makes no runtime `fetch` calls anywhere (`UNEXERCISED-PATHS.md` §8). Every panel
renders from fixtures statically imported into providers and bundled — `economy-provider.ts`
imports seven JSON files at module scope, and the other providers do the same. This is the
prerequisite for steps 8–14 and for every WARWATCH surface, and it is the largest single
piece of unwritten infrastructure in the project.

---

## 0. The decision that comes before the architecture

**The fact model has no state for "we asked and could not get an answer", and adding one is
the first thing that has to happen.** Everything else in this document is plumbing; this is
the part that decides whether the app tells the truth once it starts fetching.

`factState` today resolves to exactly four values:

| State | Means |
| --- | --- |
| `ok` | we have a value |
| `nodata` | **the source was asked and had nothing** |
| `broken` | the value cannot be traced — a bug, rendered loudly |
| `unconfigured` | key-gated source with no key set |

A 503, a timeout, a DNS failure and a rate-limit rejection fit none of them, and the
temptation is to route them to `nodata` because that is the state that already renders
gracefully. **That would be rule 30 violated at the framework level, once, for every panel
in the app simultaneously.** "No answer" is not an answer of "no". A World Bank timeout
would render as "no GDP data for this country" — a false fact about the country rather than
a true fact about our request.

`broken` is equally wrong in the other direction: a failed fetch *is* traceable. We know the
source, the URL, the status and the time. `broken` means nobody can check the value, and it
renders as an alarm because it indicates a defect in this app. A source being down is not a
defect in this app.

### Proposed: a fifth state, `unavailable`, and a provenance kind to carry it

```ts
/** A request that was made and did not produce a usable response. */
export interface FailedFetchProvenance {
  kind: 'fetch-failed';
  sourceId: string;
  requestUrl: string;
  /** null for a transport failure that never received a response. */
  httpStatus: number | null;
  attemptedAt: string;
  attempts: number;
  /** 'network' | 'timeout' | 'http' | 'rate-limited' | 'shape' | 'aborted' */
  reason: FailureReason;
  detail: string;
  /** When a retry becomes possible, if one will. */
  retryableAt: string | null;
}
```

`factState` gains `unavailable`, returned when provenance is `fetch-failed`. Ordering in
`provenanceState` — **`broken` still checked first**, because a defect in this app outranks a
defect anywhere else, then `unavailable`, then `unconfigured`.

### The propagation rule this implies

P2 says unconfigured propagates: if an input's source needs a key that is not set, the
pipeline never ran and there is nothing to be confident about. The live sibling is the same
sentence with a different cause:

> **P9 — Unavailable propagates.** A derivation with an input whose fetch failed is
> `unavailable`. The pipeline ran and did not complete, which is not a different situation
> from its never having started, as far as the confidence of the output is concerned.

This slots into the existing loudest-wins fold in `provenanceState` with no structural
change, because it is a property of a *provenance*, not of a value — unlike P3, which
remains blocked for exactly that reason.

**Naming collision, flagged rather than resolved quietly:** P5 already uses the word
UNAVAILABLE for a missing input in rendered arithmetic ("never as zero"). I propose reusing
it deliberately — a formula showing `UNAVAILABLE` should mean the same thing whether the
input was empty or unfetchable, since neither is a number we have. If you would rather keep
them distinct in the UI, the state name should change here, not P5's marker.

---

## 1. Shape

Five modules, each with a single job, and one existing seam they all serve.

```
  adapter (per source)      buildRequest() → RequestSpec        typed, tested, already exists
        ↓
  fetch/compose.ts          RequestSpec + registry → Request    base URL, headers, key, route
        ↓
  fetch/limiter.ts          per-host token bucket + concurrency admission
        ↓
  fetch/cache.ts            IndexedDB read/write, TTL freshness
        ↓
  fetch/transport.ts        direct fetch | Worker proxy, retry, timeout, abort
        ↓
  → { ctx: FetchContext, raw: unknown }  or  FailedFetchProvenance
        ↓
  adapter (per source)      parse(raw, ctx) → Fact<T>           unchanged
```

**The seam already exists and does not move.** `FetchContext` in `src/sources/adapter.ts`
is exactly what a fetch layer needs to hand an adapter: `requestUrl`, `httpStatus`,
`fetchedAt`, `cache`, `fromFixture`. Every adapter already takes it. That means adapters do
not change shape when this lands — they stop being handed fixture bytes and start being
handed response bytes, and their contract tests keep passing unmodified. That is the
strongest evidence the boundary was drawn in the right place, and it should be preserved
rather than redesigned.

`CacheState` (`'hit' | 'miss' | 'stale-revalidating'`) is likewise already in the fact model,
which fixes the cache's vocabulary before the cache is written: stale-while-revalidate is
already a modelled outcome and the inspector already has somewhere to show it.

---

## 2. Request construction from the registry

Today a URL is built entirely inside its adapter:

```ts
export function buildUrl(iso3: string, indicator: string, perPage = 60): string {
  return `https://api.worldbank.org/v2/country/${iso3}/indicator/${indicator}?format=json&per_page=${perPage}`;
}
```

The host is inline, and `sources.json` separately knows about `worldbank`. Two places know
one fact, which is the condition every drift bug in this project has started from.

**But moving the whole URL into the registry would break rule 26.** Contract tests must
issue the request the app issues, and they do that by calling the app's own builder — the
three-of-six divergence that prompted deriving fixture URLs from app builders is exactly
this hazard. A registry holding URL *templates* would put query construction in JSON, where
it is untyped, untestable, and no longer the thing the contract test exercises.

**Proposed split — the registry owns policy, the adapter owns the question:**

```ts
export interface RequestSpec {
  sourceId: string;
  path: string;                       // '/v2/country/FRA/indicator/NY.GDP.MKTP.CD'
  query?: Record<string, string>;     // { format: 'json', per_page: '60' }
  accept?: string;
}
```

The adapter returns a `RequestSpec`. `compose(spec, registry)` resolves the origin, applies
the key, sets headers, and picks the transport. Rule 26 is preserved and strengthened:
contract tests call `compose(adapter.buildRequest(...))`, so they exercise the routing and
key injection too, which they cannot do today.

**Registry fields this needs** (additive to `SourceRecord`, all validated by `parseRegistry`
so a missing one fails at module load rather than at first request):

| Field | Purpose |
| --- | --- |
| `origin` | `https://api.worldbank.org` — the one place the host is written |
| `transport` | `'direct' \| 'worker'` |
| `rateLimit` | `{ perMinute, burst }`, per host |
| `maxConcurrent` | per host |
| `timeoutMs` | per source; a source with a known slow tail gets a longer one explicitly |
| `schemaVersion` | integer, bumped when its adapter's parse changes |

**`transport` must be checked against the probe, not hand-maintained.** The deploy gate
should assert that every source's `transport` matches the latest verdict in
`CORS-VERDICT.md` — `CLIENT-FETCH` → `direct`, `WORKER-REQUIRED`/`KEY-GATED`-with-a-secret →
`worker`. A hand-set field that silently disagrees with the measurement is the same class of
defect as the `verifiedAgainst` cast that went unnoticed for two whole steps.

Current distribution across 49 active sources: **19 CLIENT-FETCH, 4 WORKER-REQUIRED,
6 KEY-GATED, 2 UNREACHABLE, 1 INCONCLUSIVE**, remainder unprobed.

---

## 3. Rate limiting and concurrency

**Bucket by host, not by source id.** Several sources share an origin, and a per-source
limiter would multiply the real request rate by the number of registry entries pointing at
one server. This is not hypothetical here: the two `iptv-org-*` sources share a host, and the
Wikimedia family is one operator across several.

- **Token bucket per host**, refilled at `perMinute`, capped at `burst`.
- **Semaphore per host** at `maxConcurrent`, plus a **global cap** (propose 6) so opening a
  dossier that touches nine sources does not saturate the connection pool.
- **A single FIFO queue per host**, so a slow host cannot starve a fast one.
- **`Retry-After` is authoritative**: when a host sends one, the bucket is drained until
  that moment. A limiter that keeps its own opinion after being told a number is a limiter
  that gets the origin to ban us.

The standing rule for the probe — no more than one full probe per host per hour — is the
same principle applied to a different client, and the limiter should be the mechanism for
both rather than a second implementation. (The probe is a separate binary today; sharing
the limiter is desirable but not a blocker.)

---

## 4. Cache

**IndexedDB, keyed on the composed request URL plus `schemaVersion`.**

```ts
interface CacheEntry {
  url: string;
  schemaVersion: number;
  raw: unknown;          // the RAW body — the inspector shows it, so it must survive
  httpStatus: number;
  fetchedAt: string;
  etag: string | null;
  lastModified: string | null;
}
```

- **TTL comes from the registry's existing `ttlMs`.** It is already populated and already
  matches each source's cadence — `300000` for a 5-minute feed, `86400000` for annual
  indicators. **`null` means static** (2 sources: `naturalearth`, `iso-3166-names`) and never
  expires.
- **Fresh → `hit`. Expired but present → serve it and revalidate → `stale-revalidating`.**
  Both are already `CacheState` values. Stale-while-revalidate is the right default because
  it makes an origin outage invisible for a while rather than instantly blanking a panel.
- **A stale-served fact must say so.** The inspector shows `fetchedAt`; a fact served from a
  cache older than its TTL by a wide margin (propose: > 5× `ttlMs`) also carries a `note`.
  A month-old GDP figure rendered with no indication of age is a wrong-value defect on a
  slow fuse.
- **Conditional requests** with `If-None-Match` / `If-Modified-Since` where the origin sends
  validators; a 304 refreshes `fetchedAt` without re-downloading.
- **Eviction is not an error.** The browser may clear IndexedDB at any time under storage
  pressure. Every read path must treat a miss as normal, and no fact may depend on a cache
  entry existing.
- **`schemaVersion` in the key is what prevents the worst cache bug available here**: an
  adapter changing how it parses, and then parsing bytes cached under the old assumption.
  Bumping the field invalidates that source's entries and nothing else's.

---

## 5. Retry, backoff, and what must never be retried

| Condition | Action |
| --- | --- |
| Network error, DNS failure | retry |
| 408, 425, 429, 5xx | retry, honouring `Retry-After` |
| 4xx other than the above | **never retry** — the request is wrong, and repeating it is asking the same wrong question louder |
| `ShapeError` from the adapter | **never retry** — the origin answered fine; our parse disagrees. Retrying hides schema drift, which is the failure contract tests exist to catch |
| Abort (selection changed) | **never retry** — nobody is waiting for it |

Exponential backoff with jitter — propose 400ms, 1.2s, 3.6s, **3 attempts**, jittered ±25% so
a dossier's parallel requests do not resynchronise onto one origin.

**A budget, not just a schedule.** Total retry spend per source is capped per session; on
exhaustion the source is marked `unavailable` with `retryableAt` set, and further requests
short-circuit until then. Without this, a persistently failing origin gets hammered by every
country the user clicks.

### The lesson this must encode

`buildLegislatureQuery` never completes against live WDQS — it fails at ~60s, the server's
timeout, **for every country tried, including single-chamber Vatican City** (`FOUND.md`).
That is a defect in the query, not a slow source, and no amount of retry, backoff or caching
can make it complete.

So: **a timeout is reported as `reason: 'timeout'` and is retried at most once**, and
repeated timeouts on one source across countries must surface as a distinct condition rather
than dissolving into per-request failures. A fetch layer that retries uniformly would turn a
diagnosable design defect into intermittent panel flicker — the outcome the WDQS finding was
reclassified specifically to prevent.

---

## 6. Cancellation and coalescing — this layer's own wrong-value failure mode

Worth stating separately because it is the way a fetch layer causes the exact class of bug
this project is built to prevent.

A user selects France, then Jamaica two seconds later. France's nine in-flight requests
resolve *after* Jamaica's dossier has rendered. **Without a guard, France's GDP renders in
Jamaica's dossier, with a confident OFFICIAL badge and correct-looking provenance.** Every
existing defence misses it: the value is real, the source is right, the provenance is
traceable, the badge is accurate. Only the country is wrong.

- **A generation token per selection.** Every request carries the token current when it was
  issued; a response whose token is stale is discarded, not rendered.
- **`AbortController` per selection**, aborted on change, so the work also stops.
- **In-flight coalescing by composed URL**: two panels asking for the same thing share one
  promise and one cache write.

**This needs an assertion in the browser harness, not just a code comment** — select A,
select B before A's requests settle, assert B's dossier contains no value from A. That check
is the reason to write the cancellation logic as a directly callable policy function
(rule 32) rather than as `if` statements scattered through the transport.

---

## 7. Panel states

Every panel gets five, and they are computed from its facts, never set by hand (rule 21).

| State | When | Renders |
| --- | --- | --- |
| `loading` | any required fact still in flight | skeleton **occupying the final layout box** |
| `ok` | all facts resolved | normally |
| `degraded` | some `unavailable`/`nodata`, some `ok` | the values we have, plus a named list of what is missing and why |
| `unavailable` | every fact `unavailable` | source name, reason, when it will retry, manual retry control |
| `unconfigured` | key-gated, no key | existing behaviour, unchanged |

- **The skeleton reserves the real box.** Rules 8 and 9 apply to loading states exactly as
  they do to loaded ones; a skeleton that is the wrong height ships a layout shift on every
  load, and the geometry harness should assert the skeleton's box matches the loaded box.
- **`degraded` is the important one and the one most likely to be skipped.** A dossier with
  eight of nine sources answering must not look identical to one with nine, and must not be
  suppressed to `unavailable` either. It names the missing source inline.
- **No spinner without a deadline.** At `timeoutMs` the panel moves to `unavailable`. A
  spinner that never resolves is the loading-state equivalent of rendering absence as zero.
- **A retry control is per source, not per panel**, and is rate-limited by the same limiter —
  a user mashing retry must not be a way around the token bucket.

---

## 8. The Worker proxy

For the 4 `WORKER-REQUIRED` sources and the key-gated sources whose `keyEnv` is not
`VITE_`-prefixed (a secret key must never reach the browser — the probe already encodes this
precedence, scoring `KEY-GATED` above a permissive ACAO for exactly this reason).

```
  GET /api/s/:sourceId?<query>
```

- **The allowlist is `data/sources.json`, read by the Worker at build time.** Not a second
  list. A proxy with its own copy of the routing table is a drift bug with an SSRF blast
  radius.
- **The Worker composes the upstream URL from `origin` + validated path/query.** It never
  accepts a full URL from the client. This is the single most important line in the section:
  an open proxy is a security defect, not a design wart.
- **Keys are injected server-side** from Worker secrets and never appear in a response,
  an error message, or a provenance record. `requestUrl` in provenance must be the
  *proxied* URL, with any key parameter redacted — the inspector shows that string to the
  user verbatim.
- **Rate limits are enforced at the edge, shared across all visitors.** Per-visitor limiting
  multiplies the real rate by the number of visitors, which is precisely what the free tiers
  measure. This also means the Worker, not the client, is the authority for
  `WORKER-REQUIRED` sources.
- **Edge cache with the same `ttlMs`**, so N visitors cost the origin one request.
- **Attribution and licence constraints travel with the response.** Several of these sources
  are `nc` or `share-alike`; proxying must not detach data from its terms.

---

## 9. How this gets tested (rule 32, applied before the code exists)

Every policy decision below is a pure function taking data and returning a decision, with
planted cases. The I/O is the thin part.

| Function | Planted cases |
| --- | --- |
| `compose(spec, registry)` | key injection, redaction, transport selection, missing origin |
| `admits(bucketState, now)` | burst exhaustion, refill, `Retry-After` override |
| `freshness(entry, ttlMs, now)` | fresh, stale, static-null, far-stale note threshold |
| `retryPlan(failure, attempt)` | each row of the table in §5, especially the never-retry rows |
| `stateFor(facts)` | every panel state, especially `degraded` |
| `provenanceState` | P9 propagation and its ordering against P1/P2 |
| Worker allowlist | a path escaping its origin; an unknown `sourceId` |

The transport itself is exercised against a stub `fetch` — **not** by hitting the network,
so the retry ladder and abort behaviour can be tested deterministically. Live behaviour stays
where it already is: contract tests under `PROBE_LIVE=1`, per rule 26.

**Two new mutations** for the mutation suite when this lands, since it adds two mechanisms
whose failure would be silent: strip the generation-token check (must be caught by the
selection-race assertion), and make a failed fetch return `nodata` instead of `unavailable`
(must be caught by a panel-state assertion). Both are the "looks fine, lies quietly" shape
that the existing nine were chosen for.

---

## 10. Migration

**One source at a time, through the gate that already exists.** The five sources currently
`live` got there this way and it worked.

1. Land the layer with **zero sources switched**. Providers keep importing fixtures. Nothing
   user-visible changes, and the layer is exercised only by its own tests.
2. Switch **`worldbank`** first: already `live`, `CLIENT-FETCH`, `direct`, has a fixture and
   a contract test, and its panel already handles gaps and missing years.
3. Then `usgs-quakes`, `nasa-eonet`, `wikipedia-rest`, `wikimedia-commons` — the rest of the
   `live` five.
4. Then the first `worker` source, which is where the Worker gets its first real exercise.

**Each switch is a separate commit, and the fixture stays.** The fixture becomes the contract
test's input rather than the app's data source. Deleting fixtures on switch-over would remove
the only offline description of each response shape and break every test that depends on
determinism.

**`fromFixture` must be set correctly throughout**, since it already surfaces a warning in
the inspector. A half-migrated app in which fixture-backed panels claim to be live is worse
than either end state.

---

## 11. What I am not proposing, and what needs your call

**Not proposing:** a service worker (offline is not a goal and it complicates the freshness
story); a normalised entity store (adapters return facts and that is sufficient); request
priorities beyond the FIFO-per-host queue (add only if measurement shows a need); optimistic
UI of any kind.

**Needs a decision:**

1. **The `unavailable` naming collision with P5's UNAVAILABLE marker** (§0). My
   recommendation is to reuse the word deliberately; the alternative is renaming this state.
2. **Stale-while-revalidate as the default.** It keeps panels populated through an outage,
   at the cost of showing data that is knowingly out of date. I recommend it *with* the
   far-stale note (§4); the opposite choice — blank rather than old — is defensible and is a
   product judgement, not a technical one.
3. **The far-stale threshold** (proposed 5× `ttlMs`). Arbitrary, and the arithmetic should be
   yours, since it decides when the app starts apologising for its own data.
4. **Whether `degraded` blocks the deploy gate.** A panel that is permanently degraded
   because a source has gone away is a shipped panel making a promise it cannot keep, and
   the gate currently has no view on runtime state at all.
