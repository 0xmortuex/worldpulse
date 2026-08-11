# Test conventions

Rules this project has paid for. Each one exists because a real bug got through.

---

## 1. A visual layer is verified only by asserting on rendered behaviour

**Never assert that a canvas exists, has non-zero dimensions, or that a component
mounted. Assert that something rendered inside it responds.**

Where this came from: step 1's globe check confirmed `#globe canvas` was present and
sized, and passed. The country polygons were not rendering at all — three-globe reads
`d.geometry` and our records expose `.feature`, so every polygon silently drew nothing.
A bare lit sphere produces a perfectly sized canvas. The check was green and the app
was broken.

The replacement asserts through the renderer's own hit-testing: move the pointer over
the globe and require a country tooltip. That can only pass if polygons exist, carry
geometry, are positioned on the sphere, and are pickable.

Applies to every visual layer added from here — points, arcs, markers, choropleth,
the time scrub. For each, the check must be something only a correctly rendered layer
can satisfy:

| Layer | Not sufficient | Sufficient |
| --- | --- | --- |
| Country polygons | canvas has size | hovering yields a country tooltip |
| Event points | `pointsData` length | clicking a point flies the camera and opens its detail |
| Arcs | arc count | an arc's endpoints resolve to the two expected countries |
| Choropleth | legend rendered | two countries with known-different values get different fills |
| Markers | marker count | a marker's tooltip names the expected base or mission |
| Time scrub | slider moves | scrubbing to a past date changes a specific rendered value |

The general form: **name a property that is false when the layer is broken but the
container still exists.** If you cannot name one, you have not verified the layer.

---

## 2. When the engine is right and the test is wrong, fix the test — and name it
   after the invariant

`USA↔RUS` scored `strained`; the test expected `adversary`. The engine was correct:
the seeded evidence is one-way sanctions, there is no active conflict between them
and relations are not severed. Calling that "adversary" would have been the app
asserting more than its inputs support.

The fix was to correct the expectation and rename the test to
`refuses to escalate one-way sanctions into adversary`. A test named after the
invariant it protects survives refactors and tells the next reader why the value is
what it is. A test named after its inputs just records a number.

Corollary: before changing engine code to make a test pass, state in one sentence why
the current output is wrong. If you cannot, the test is what is wrong.

---

## 3. An error response is not evidence about the success path

`scripts/probe-sources.mjs` classified a GitHub 403 (unauthenticated rate limit) as
`WORKER-REQUIRED`, because the error response carried no `Access-Control-Allow-Origin`.
Most servers omit CORS headers on error paths, so that inferred a permanent proxy
dependency from a transient auth failure.

Any probe or contract test that reads headers, shape or ranges off a non-2xx response
must report `INCONCLUSIVE` and say what to re-run. Never let a failed request harden
into an architectural conclusion.

---

## 4. Contract tests assert shape and range, not values

Upstream data changes legitimately; upstream *formats* changing is what makes this app
start lying. For each source, assert:

- the response parses and the expected fields exist at the expected paths
- a known-stable record is present
- key numeric fields fall in a sanity range (population > 0, GDP within orders of
  magnitude, latitude in [-90, 90])

Never assert an exact current value — that produces a test that fails every time the
world changes, which trains people to ignore it.

---

## 5. Fixtures are labelled, and never silently substitute for live data

Seed and fixture data must be visibly marked in the UI when in use — step 1 renders a
persistent SEED banner. A test that passes against a fixture proves the rendering
path, not the data path, and its name should say so.

---

## 6. A rule that has never failed is not a rule

`tests/fact-discipline.test.ts` carries a `catches a planted violation` case that
feeds the analyser a deliberately non-compliant file and asserts it is flagged. A
static rule that silently matches nothing looks exactly like a clean codebase.

The same applies to the browser checks: when one is added, break the thing it watches
once and confirm it goes red before committing it.

## 7. Wrong provenance is worse than absent provenance

Any identifier that maps a UI element to a data record needs a **no-reuse
assertion**. Not "is it unique right now" — "can this id ever refer to a different
record than it did when it was rendered".

Where this came from: confidence-badge ids were reset each render pass. Any DOM that
outlived a pass — the component gallery — kept ids that were later reassigned to
different facts. Clicking such a badge opened *another value's* provenance. The
inspector looked healthy; it was confidently describing the wrong number.

Absent provenance is loud and self-correcting: the badge renders UNTRACEABLE and
someone fixes it. Wrong provenance is silent and self-justifying — it makes a bad
value look audited. Prefer failing closed: a stale id must resolve to nothing.

This failure class will recur wherever an id bridges the DOM and a record:

| Surface | The id | The risk |
| --- | --- | --- |
| Global event feed | event row -> event record | clicking flies the camera to the wrong place |
| Compare columns | column index -> country | a stat is attributed to the wrong country |
| Choropleth | polygon -> indicator value | a country is painted with another's number |
| Watchlist diffs | change row -> before/after pair | a diff is shown against the wrong baseline |

For each: assert that rendering N records yields N distinct ids, that an id from an
earlier render never resolves to a later record, and that an unknown id resolves to
nothing rather than to a neighbour.

## 8. Existing is not working — assert geometry, not presence

**For any panel with more than one positioned element, assert that key elements' bounding
boxes do not intersect, and that nothing overflows its container — at every responsive
breakpoint.**

Where this came from: the dossier header's dual-portrait case rendered with the title
block and both portraits overlapping into unreadable soup. Every assertion was green. The
rule fired correctly, the right person led, the office titles were exact — and the panel
was broken. A human noticed it in a screenshot.

This is the same failure shape as the bare-sphere polygon bug in rule 1: *the check
proved the thing existed without proving it worked*. Presence assertions and text
assertions are both blind to layout. A bug only a human eye catches will eventually ship
on a step where nobody looked.

Breakpoints to check: **360px** (drawer/sheet), **900px** (the rail/drawer boundary), and
desktop. Overlap tends to appear only at the narrow end, which is also where nobody
screenshots.

`scripts/verify-render.mjs` exposes `assertLayout(page, selector, children, label)`:

- every child's box lies inside the container's box (no overflow)
- no two children's boxes intersect
- no child has zero width or height — a collapsed element is invisible, not absent, and
  presence checks pass on it

Screenshots stay in the loop. They catch what geometry assertions cannot — colour
collisions, illegible contrast, a portrait that is technically inside its container and
still wrong. The two are complementary, not alternatives.

## 9. `innerText` applies CSS, `textContent` does not

Assertions against `innerText` see the *rendered* text, so anything under
`text-transform: uppercase` comes back uppercased. Match case-insensitively, or read
`textContent`. Three step-2 checks failed on this before the code was wrong at all.

## Running

```bash
npm test              # unit: relations engine, geometry
npm run verify        # browser assertions against the built app (needs a preview server)
npm run probe         # source reachability and CORS posture
```

`npm run verify` needs Chromium. Where it is installed out of band, set
`PLAYWRIGHT_CHROMIUM_PATH` to the binary.
