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

The marker-click check retries the *race*, never relaxing the *assertion*. Each attempt
still has to hover the same event, and the camera still has to land on that event's real
coordinates.

**A flake rate is a property of a machine, not of a check.** Record the frame profile it
was measured on, or the number cannot be compared with anything. Measure both with
`node scripts/measure-frame-profile.mjs`.

### This machine's profile

Swiftshader, the same launch args `verify-render.mjs` uses, nothing else running:

| | median | p95 | max | fps |
| --- | --- | --- | --- | --- |
| Idle globe, US selected | 583.3ms | 716.7ms | 1266.7ms | 1.7 |
| During a `flyTo` | 550.1ms | 699.9ms | 1350ms | 1.8 |

Under concurrent load the idle median rises to 716.7ms, so any measurement taken while
something else runs is not this profile. The earlier machine rendered at ~2100ms per
frame — 3.6× slower, but the same order. **Neither machine is fast enough for a fixed
wait to mean anything**: the 600ms settle after `focusCluster` is about one frame, and
the 150ms and 250ms parks are each under half a frame. Waits in this harness must be
expressed as conditions, never durations.

### Measured rates on that profile

| Configuration | Failure rate |
| --- | --- |
| First attempt succeeded | **2 / 30 — 93% of first attempts fail** |
| As shipped, 3-attempt retry | **40%** (18/30) |
| One attempt, no retry (clean box, 20 trials) | **90%** |

**The retry was not smoothing a race. It was carrying the check** — converting a guard
that fails 93% of the time into a 40% background flake, which is exactly the rate at
which people learn to re-run rather than read.

Two consequences, both landed:

1. `scripts/verify-render.mjs` now asserts
   `check('the marker click worked on the first attempt', attempts === 1, …)`, with each
   attempt's failure mode in the detail. Reporting the count only in a failure string was
   never visibility: those strings print only when the check already failed, so a run
   needing all three attempts printed identically to one that worked first time.
2. `scripts/measure-frame-profile.mjs` measures the profile and all three rates together,
   so the next machine can re-derive them rather than inheriting a number that does not
   transfer.

### What the flake is not

Recorded so the next session does not re-derive them:

- **Not camera damping.** Refuted previously.
- **Not marker drift under a parked pointer.** Every failure measures
  `pointerOffsetAtClick = 0px` and `driftAfterWait = {maxStep: 0, total: 0}`. The marker
  is stationary and the pointer is on it. Drift occurs in about 2 trials in 15 and those
  trials do fail, but it accounts for almost none of the rate.
- **Not the stale tooltip alone.** `pickEvent` parks the pointer, waits 150ms — under half
  a frame — then waits for `.evt` to exist, which the *previous* hover's tooltip satisfies
  instantly. That guard is genuinely vacuous, and the positive control asserting the
  marker was hovered reads the same leftover. But requiring the tooltip to disappear and
  reappear, so a fresh hover is observed rather than assumed, **does not fix the click**:
  4/20 versus 2/20 on a clean box, which is no improvement worth claiming.

So the vacuous guard and the dropped click are two defects, not one. The guard is
understood and its fix is known; **the click is not yet explained**, and no further fix
should be written until it is.

Re-running until green is not an option available here. A check that is re-run until it
passes has stopped being evidence.

## 16. "Nothing matched" is not "nothing wrong"

`assertTextFits` collected the elements whose text overflowed and passed when that list
was empty. A selector matching *no elements* produced an empty list too, so it scored
identically to "everything fits". `assertLayout` had a guard for this; the two text
helpers did not, which put every rule-9 assertion one class rename away from passing
vacuously.

It was not hypothetical. `timeline dates` asserted `.term .term-dates` against the United
Kingdom, and the leadership-timeline fixture is mapped to the United States — the
selector had matched nothing since the check was written. This is the Tuvalu bug (rule
10) in a check written *after* rule 10 existed, because the rule was being applied by
hand at each call site instead of by the helper.

Both helpers now assert they examined something before asserting what they examined was
fine. Any helper whose pass condition is "the problem list is empty" needs the same pair.

## 17. A skipped check is not a pass

Several browser assertions sit behind a guard — the camera checks only run if a marker
was picked, the occlusion pick only if a back-facing marker exists. When the guard was
false those checks silently did not run, and the suite still printed "all checks passed"
over a smaller suite than the reader thinks they are reading.

Skips are now recorded, printed, and exit non-zero. Same principle as showing all 34
sources in the deploy gate every run: **invisible passes are how a suite quietly stops
covering things**, and a check that did not run is not evidence of anything.

The per-step table exists for the same reason. It prints every run, green or not, so a
step whose assertion count silently drops to zero cannot look like a step that passed.

## 18. A verdict is never stronger than its evidence

The mutation harness reports `CAUGHT` only when the assertion that *names* a behaviour
fails. Everything else is a different claim and gets its own verdict:

- `CAUGHT-ELSEWHERE` — something noticed, but not the check under test
- `BUILD-FAILED` — the compiler noticed, so the assertion never ran
- `TIMEOUT` — a hang is a failure signal, not a pass
- `UNPARSED` — non-zero exit with no failing check parsed, meaning the suite stopped
  before rendering a verdict at all

The last one was earned. A mutation that laid the dossier portraits over the title block
made an overlapping element intercept pointer events; a click back in step 2 timed out,
the script died on a `TimeoutError`, and the run was scored as "caught" — by nothing. The
layout assertions it was aimed at had never executed.

That also exposed a structural weakness worth stating on its own: **this suite is one
linear sequence, so an exception anywhere blinds every assertion after it.** The report
now prints on `uncaughtException` and `unhandledRejection` too, recording the aborting
step and naming every step that never ran.

## 19. Ask whether content fits its box, not whether the box reached zero

`assertLayout` flagged a child only at exactly zero width or height. A mutation forcing
party-legend rows to `height: 0` left them **2px** tall — the row keeps 1px of padding
top and bottom — with their text clipped entirely away, and the check passed. Measured,
not assumed: 16.5px before, 2px after.

"Collapsed" was the wrong question. A child whose overflow is unreachable (`hidden` or
`clip`) and whose `scrollHeight` exceeds its `clientHeight` is now a failure — the
vertical counterpart to rule 9's horizontal `scrollWidth` test. It catches the whole
family of squashed rows rather than the single value zero.

## The harness's own failure modes

Every class below produces a green result without testing the thing it names. Four were
found the hard way; the audit that followed looked for more.

| Class | How it passes without testing anything | Status |
| --- | --- | --- |
| Vacuous absence check | Asserting a thing is absent where the subject never existed (Tuvalu) | Rule 10; positive controls required |
| Type-system laundering | A string-returning wrapper carries a number past a type-driven rule | Rule 14; enforced by `tests/render-helpers.test.ts` |
| Stale bundle | The runner drives a build older than the code under test | Rule 13; freshness guard, `verify` builds first |
| Empty selector | "No offenders found" and "nothing to look at" are the same value | Rule 16; helpers assert they examined something |
| Skipped check | A guarded assertion silently does not run | Rule 17; skips recorded and exit non-zero |
| Unproven check | A check that has never been observed failing | `npm run mutate`; one mutation per step |

Checked and currently clean, recorded so the next audit does not re-derive them:

- **Un-awaited conditions.** A `Promise` is truthy, so `check('x', page.locator(…).count())`
  without `await` passes unconditionally. Scanned: no occurrences.
- **Discarded `waitFor` results.** A timeout that is ignored lets the next assertion run
  against a page that never reached the expected state. Both call sites consume the
  result.

Known and *not* fixed, stated so it is not mistaken for covered: **33 assertions match a
regex against a whole-panel `innerText` blob**. A pattern like `/650/` would pass on any
occurrence anywhere in the panel, not only in the seat count it means. Mutation testing
constrains this — a mutation that survives shows the assertion cannot see its subject —
but the scoping is still weaker than it reads.

## Running

```bash
npm test              # unit: relations engine, geometry, static rules
npm run verify        # builds, then runs browser assertions (needs a preview server)
npm run mutate        # breaks one feature per step, requires the suite to notice
npm run probe         # source reachability and CORS posture
```

`npm run verify` and `npm run mutate` need Chromium. Where it is installed out of band,
set `PLAYWRIGHT_CHROMIUM_PATH` to the binary.
