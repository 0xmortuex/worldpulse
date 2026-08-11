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

## 9. Text fidelity — geometry cannot prove readability

Rule 8 proves elements do not overlap or overflow. It cannot prove the text inside them
is intact. **"451.53 billion" clipping to "3 billion" is the worst defect class this
project has produced: silently wrong, confidently displayed, geometrically valid.**

For every numeric surface:

1. **Assert `scrollWidth <= clientWidth`** on any element whose text is generated from a
   Fact. This is the direct test for clipping and it holds regardless of formatting
   strategy. For SVG text, compare `getComputedTextLength()` against the space allowed.
2. **Assert a character budget** for text in a fixed-width gutter or fixed-height row.
   Note that a budget written for Latin text is wrong for others — see below.
3. **Assert the rendered string equals the expected formatted value.** A check that only
   asserts "some text is present" passes happily on a truncated number.
4. **Fixture at least one deliberately extreme value per numeric surface** — the longest
   plausible string. A 15-digit GDP, a hyperinflation percentage, a long country name in
   a compare column, a twelve-digit population. Extremes are where formatting fails and
   they do not occur by chance in hand-written fixtures.

### 9b. Compaction is allowed; truncation is not

A compacted value is **lossless in intent**: `452B` tells you the same thing as
`451,530,000,000` at lower precision, and a reader knows precision was traded for space.
A truncated value is a **different number**: `3 billion` from `451.53 billion` is not an
approximation, it is wrong.

If a value cannot be shown at full precision in the space available, either the space is
wrong or the value needs a tooltip carrying the exact figure. **Never let the display
silently choose a different number.**

Corollaries worth stating, because they are easy to get wrong:

- `text-overflow: ellipsis` is acceptable for prose (a headline, an outlet name) where
  the truncation is *visible* as an ellipsis. It is never acceptable for a numeric value.
- CSS that clips without an ellipsis is never acceptable for either — the reader cannot
  tell anything was removed.
- A character budget calibrated on Latin text will be wrong for CJK (wider glyphs),
  Arabic and Devanagari (different advance widths, and shaping that makes `.length` a
  poor proxy for rendered width). Prefer the measured `scrollWidth` check, and treat
  character budgets as a secondary guard on surfaces you know are Latin-only.

## 10. Absence is not evidence unless you looked in the right place

**Any assertion whose passing condition is an absence must be paired with a positive
assertion proving the harness reached the intended subject.**

No polyline. No sparse-coverage banner. No error state. Every one of those passes
identically when the test is pointed at the wrong thing entirely — and passes *silently*,
because absence is what it wanted.

Where this came from: the sparse-news fixture was mapped to Tuvalu, which is absent from
the 110m topology. The country was unselectable, `selectCountry('Tuvalu')` quietly did
nothing, and three assertions about sparse coverage ran against the previous country and
passed. Nothing was red. Nothing was covered.

This is the third instance of the family — the bare sphere, the dual-portrait overlap,
and now this — and the first where the test was aimed at the wrong subject rather than
measuring the wrong property.

The pairing, concretely:

| Absence asserted | Positive control that must accompany it |
| --- | --- |
| No polyline in a chart block | the block's `data-indicator` is the one requested |
| No sparse banner | the panel header names the country requested |
| Layer off, no points rendered | the layer toggle reads off AND the globe rendered other layers |
| No error state | the fact id under test is present in the DOM |

**Every fixture must assert its subject is reachable through the UI path the test uses.**
`tests/fixtures.test.ts` does this generally: every country any provider maps a fixture
to must exist in the country list, or the fixture is unreachable and whatever it was
meant to prove is unproven.

## 11. Fix the mechanism, not the instance

When a check catches a bad output, ask **"what is the set of inputs that produce this
class of output"** — not "does this input produce it now".

Where this came from: `formatAxisValue` rendered `451.53 billion` into a 46px gutter,
where it clipped to `3 billion`. The step-5 fix made the label shorter. The step-6 check
then caught `5.99e+3T` from the same function — `toPrecision()` flips to exponent
notation once the mantissa exceeds its significant digits, and shortening one output had
done nothing about that. The real fix was to scale first and fix the decimals after, so
the formatter *cannot* emit exponent notation for any input.

A fix that makes the failing case pass, without narrowing the space of inputs that can
produce the failure, is a fix that will be re-reported later under a different value.

## 12. `innerText` applies CSS, `textContent` does not

Assertions against `innerText` see the *rendered* text, so anything under
`text-transform: uppercase` comes back uppercased. Match case-insensitively, or read
`textContent`. Three step-2 checks failed on this before the code was wrong at all.

## 13. Verify the build that is actually running

`npm run verify` drives whatever is serving the preview port. A preview server started
earlier keeps serving an old `dist/` indefinitely, so every check can pass against code
that is not the code in the working tree — and "all checks passed" then means nothing at
all. This happened during step 7: a full green run had been produced against a bundle
built eighteen minutes before the changes it was supposed to be verifying.

The harness now refuses to start when `dist/` is older than anything under `src/`,
`data/`, `tests/fixtures/` or `index.html`, and `npm run verify` builds first. Rule 1
says assert rendered behaviour; this is the same rule pointed at the harness itself —
the behaviour asserted has to be the behaviour of the code under test.

## 14. A string-returning wrapper is a hole in a type-driven rule

The fact-discipline rule is enforced through the type checker: an expression reaching
DOM-bound markup must not be number-typed, and the two sanctioned helpers both return
`string`. That makes *any* function returning a string a laundering path — the rule
cannot tell `notAFact(n, reason)` from a local `signed(n)` that quietly does
`String(value)`.

Two such helpers existed. Both rendered slider weights, which genuinely are not facts,
so nothing was mis-labelled — but the rule was not what was keeping it that way.

Corollary, and the reason this is a convention rather than a one-off fix: when a rule is
enforced through a type, every conversion to that type is part of the rule's surface. A
new formatter that returns `string` needs to route through the sanctioned helper, or the
rule stops covering the values that pass through it.

The same defect had a second form: the rule only inspected templates whose own text
contained a tag, so one level of nesting defeated it —

```ts
`<div>${magnitude === null ? 'no magnitude' : `M${magnitude}`}</div>`
```

The outer span is `string`-typed and the inner template has no tag in it, so a USGS
magnitude reached the DOM unbadged with nothing flagged. Markup-boundness is now
inherited by nested templates, and the planted-violation control plants both shapes.

## 15. A flaky check is a check nobody reads

The marker-click check failed about one run in three: globe.gl resolves a click against
whatever its own raycast last hovered, and under swiftshader that raycast lands an
indeterminate number of frames after the pointer moves, so the click is sometimes
dropped entirely.

The fix is to retry the *race*, never to relax the *assertion*. Each attempt still has
to hover the same event, and the camera still has to land on that event's real
coordinates; only the frame-timing coin flip is retried, and the attempt count is
reported in the failure detail so a check that starts needing all three attempts is
visible rather than silent.

Re-running until green is not an option available here. A check that is re-run until it
passes has stopped being evidence.

## Running

```bash
npm test              # unit: relations engine, geometry
npm run verify        # builds, then runs browser assertions (needs a preview server)
npm run probe         # source reachability and CORS posture
```

`npm run verify` needs Chromium. Where it is installed out of band, set
`PLAYWRIGHT_CHROMIUM_PATH` to the binary.
