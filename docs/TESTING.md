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

### Second configuration — local Windows 11 box, 2026-08-14

Recorded as a **new** configuration rather than replacing the numbers above, per 20a. The
profile above is the cloud sandbox (4-core Xeon 2.10GHz, Linux container). This one is a
local Windows 11 machine with a discrete GPU. Two expectations went in and both were wrong,
which is the reason to write them down.

Measured with `measure-frame-profile.mjs` on `cf62bcd`, US selected, nothing else running:

| Rasteriser | idle median | idle p95 | idle max | flyTo median | fps |
| --- | --- | --- | --- | --- | --- |
| swiftshader (harness default) | 750ms | 1499.9ms | 2416.5ms | 750ms | 1.3 |
| hardware GL (`WORLDPULSE_HARDWARE_GL=1`) | 733.3ms | 750ms | 766.6ms | 733.3ms | 1.4 |

**This machine is slower than the sandbox, not faster** — 750ms against 583.3ms per frame,
1.29× worse — despite better hardware on paper. Software rasterisation is single-thread
bound and does not care about the GPU sitting idle beside it.

**Hardware GL is not "roughly twice as fast" here**, as `measure-frame-profile.mjs`'s own
header claims. The medians are within 2% of each other. What differs is the *tail*: hardware
GL holds p95 at 750ms against swiftshader's 1499.9ms, so its frame times are far more
consistent at the same median. A bare page with no country selected measures swiftshader
much faster (4.9fps against 1.5fps) — but that is a state the harness never runs in, and the
two converge as soon as the globe has work to do. Measure in the state the check runs in.

Flake rates, swiftshader, **10 trials per mode** (the sandbox used 20–30):

| mode | passed | failure rate | first attempt | hover-missed | click-dropped |
| --- | --- | --- | --- | --- | --- |
| shipped, 3-attempt retry | 8/10 | 20% | 6/10 | 0 | 9 |
| single, no retry | 5/10 | 50% | 5/10 | 0 | 5 |
| cleared | 7/10 | 30% | 7/10 | 0 | 3 |

`npm run verify` on this configuration: **894s, 276 assertions, 6 failures** — the marker
click needing 2 attempts, two `locator.click` actionability timeouts, and their cascades.
The sandbox recorded 313–510s per *mutation*, each of which is a build plus a full verify,
so the same run there was on the order of 300–500s.

**Hardware GL rates were not measured.** Three attempts were killed externally by the
environment — at 186 checks, at 11 checks, and immediately after the profile printed — while
every swiftshader run on the same box completed. No GPU driver or TDR events appear in the
Windows system log for those windows and no Playwright process was left orphaned, so the
cause is recorded as unidentified rather than guessed at.

#### CORRECTED — the second "flake" was a harness defect, and it is fixed

**What this section said, and why it was wrong.** It recorded `… : clickable` as a second
frame-rate flake, concluded that "this machine cannot run the browser suite to a clean sheet",
and declined to fix it on the grounds that any fix would convert a measured environmental limit
into a green tick. **The first two claims were false and the third was a way of not looking.**

Instrumenting the click showed the element was neither slow nor covered: it was being
**replaced**. Re-selecting a country swaps `[data-tab="economy"]` — measured at 18 mutations
and 2 replacements in the 3s after a scenario switch, with `elementFromPoint` returning the tab
itself, unobstructed. Playwright's actionability wait handles an element that moves or is
covered; it cannot help with one that is replaced, because every retry re-resolves the selector
and starts over. The 15s was spent re-resolving a moving target, not waiting for a slow frame.

**The cause was fixed durations, which rule 15 already forbade.** `selectCountry` parked for
250ms and 500ms — both under one frame at 750ms/frame — and returned mid-rebuild. The rule was
written and then not applied to the one helper that most needed it.

**Fixed by conditions, not by relaxation.** `waitForStableNode` requires a selector to resolve
to the same node for three consecutive frames before `clickOrFail` clicks; `waitForDomQuiet`
requires a subtree to stop mutating for three frames before a caller reads it. Both are
frame-based, so they scale with the machine instead of assuming one. No timeout was raised, no
retry added, no check skipped, no tolerance widened.

**Result on this configuration: 273 assertions, 0 failures** — the marker click included, which
had failed in the two runs before the fix. The claim that this machine could not produce a
clean sheet was wrong, and it was wrong because a harness defect had been filed as an
environmental one.

**The lesson worth keeping.** "Environmental" is the most comfortable explanation available for
a flaky check, and it is unfalsifiable until someone instruments it. Two runs' worth of evidence
were read as confirming it when they were equally consistent with DOM churn. A flake attributed
to the machine should carry the measurement that rules out the code, or it is a guess wearing a
configuration table.

#### Superseded: the original two-flake reading

Recorded because "the known marker-click check" is the sandbox's flake list, and on this box it
is incomplete. Two `npm run verify` runs on the same machine, same swiftshader configuration,
bracketing a night of source registrations that touched no rendering code:

| Run | Assertions | Failures |
| --- | --- | --- |
| `cf62bcd`, before | 276 | **6** — marker click (2 attempts), `stale toggle: clickable`, `economy tab: clickable` ×2, and two step-7b cascades |
| `c5d50f7`, after | 274 | **2** — marker click (2 attempts), `economy tab: clickable` ×1 |

**`… : clickable` is `locator.click: Timeout 15000ms exceeded`** — Playwright's actionability
wait giving up, not the app refusing a click. In the later run the assertions immediately
after it all passed: the degraded panel rendered, named what was missing, and showed the
indicators that answered. **The click timed out and the scenario still worked**, which is what
distinguishes this from a defect.

The mechanism is the one §15 already describes for the marker click: at 750ms per frame there
are ~20 frames inside a 15s timeout, and Playwright's stability check needs consecutive frames
with an unchanged box. It is the same fault surfacing at a different call site.

**The assertion count moves with the failures** (276 → 274) because `clickOrFail` emits a
`clickable` check per failed click. A run with fewer timeouts reports fewer assertions, so the
totals are not comparable between runs on this configuration — worth knowing before reading a
count drop as lost coverage.

**Superseded 2026-08-14 — see the correction above.** This paragraph originally declared the
failure unfixable and a property of the machine. It was a harness defect: fixed durations in
`selectCountry` returning mid-rebuild, and `clickOrFail` handing Playwright a node that was
being replaced. The suite now runs to 273 assertions and 0 failures on this configuration.

The reasoning is kept rather than deleted because it was wrong in an instructive way: every
sentence in it is a correct general principle — do not raise timeouts, do not retry to green,
do not skip — deployed to justify not investigating. The principles are right; using them as a
reason to stop looking was not.

#### What this configuration says about the mechanism

Two results do not fit "globe.gl fails to resolve a click at a low frame rate":

- **The frame period got worse and the flake got better.** 750ms against 583.3ms per frame,
  yet single-attempt failure fell from 90% to 50% and first-attempt success rose from 2/30
  to 6/10. A mechanism driven by frame period alone should have moved the other way.
- **`hover-missed` was 0 in all 30 trials.** Every failure was `click-dropped`. The hover and
  pick path — the one the reverted change in `FOUND.md` addressed — was never implicated on
  this machine.

At n=10 per mode the ordering of the three modes is not resolved; the gaps sit inside the
noise. What the sample does support is that the flake is roughly halved here, nowhere near
gone, and is a *click* failure rather than a *hover* failure on this box.

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

So the vacuous guard and the dropped click are two defects, not one.

### Where the click is lost — instrumented, three questions in order

Reframed deliberately: a click that lands on a correctly-hovered, correctly-identified
marker and does nothing is what a user would call *"the globe ignores my clicks"*. That
would be a step-7 defect in shipped behaviour, not a test curiosity, so it was worth
asking which it is before fixing anything.

Measured over 12 trials with a capture-phase listener on the canvas, a temporary counter
inside `onPointClick`, and `facesCamera` recomputed independently at the instant of the
click:

| Question | Answer |
| --- | --- |
| 1. Does the DOM click reach the canvas? | **Yes — every trial, failures included.** One `click` event on the canvas, every time. |
| 2. Does globe.gl's `onPointClick` fire? | **No, on every failure.** It fired on exactly the trials that passed (2 of 12) and never on the 10 that failed. |
| 3. Is `facesCamera` rejecting the point? | **No.** `true` in all 12 trials — 17° from the camera centre against a 69° horizon — and `true` inside the handler on the trials where it ran. |

**Verdict: harness, not app.** The failure sits entirely between "the browser delivered a
click to the canvas" and "globe.gl resolved it to a point" — inside the library's own
raycast, with our filter exonerated. `facesCamera` never rejected a front-facing marker;
the occlusion filter behind decision L1 is not implicated.

One caveat, stated rather than buried: this rules out an app defect *on this
configuration*. It does not prove a user on a genuinely slow device would not hit the same
dropped click, because the mechanism is globe.gl failing to resolve a click at a low frame
rate and a slow device is a low frame rate. What can be said is that no code in this
repository is dropping it.

Two instrumentation traps worth recording, since both nearly produced a false finding:

- **Reading the counter immediately after `mouseup` measured impatience, not behaviour.**
  At 1.7fps globe.gl can dispatch a frame or more later; the first run showed `0` on every
  trial *including the ones that passed*, which is self-evidently wrong. Re-reading after
  the arrival window produced a result that agrees with itself.
- **Rule 13 applies to diagnostics too.** The temporary counter was confirmed present in
  the bundle the preview server actually returned before any conclusion was drawn from it.
  A counter that reads zero because it was never shipped looks exactly like a callback
  that never fires.

**The click is still not fixed, only located.** No further fix should be written until
there is a mechanism that explains why globe.gl resolves the click on some frames and not
others.

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

### 18a. A verdict names a CAUSE, and the name can be wrong

**Recorded 2026-08-17, after I misreported four of them.**

`BUILD-FAILED` is defined above as *the compiler noticed*. That is what it means when the
build fails because the mutation was not compilable — which is the case it was written
for. But a build can fail for reasons that have nothing to do with the code, and the
verdict does not know the difference.

**What happened.** A mutation run reported `BUILD-FAILED` on four consecutive mutants. I
recorded them as results. They were not: the volume had filled, and child processes were
failing to spawn at all — on Windows, `0xC0000142`, before any compiler ran. The same run
then died outright on a `git status` subprocess. Nothing had been learned about those four
behaviours, and four rows saying `BUILD-FAILED` beside eight saying `CAUGHT` invited
exactly the reading rule 3 forbids.

**The tell was in the timing and I had it in front of me.** The four failed in seconds;
a real build takes minutes. On a fresh run with space available, the same mutant took
minutes and passed. *A verdict that arrives far faster than the work it claims to have
done is a verdict about the harness, not the tree.*

**Two responses, both landed:**

1. **The name is not the cause.** When a run reports a build failure, ask what failed to
   build before recording it. A compiler error names a file and a line; a spawn failure
   names nothing, because nothing ran.
2. **Check the precondition up front.** `scripts/disk-guard.mjs` refuses to start a
   mutation run below a measured free-space floor, in the same shape as the run lock:
   a precondition checked before the work rather than discovered as a corpse an hour in.
   The floor is derived from measurement — runs consumed ~100 MB, died between 0 and
   78 MB free — and `tests/disk-guard.test.ts` plants the exact 78 MB reading the real
   run died at.

**The general form:** every verdict in this harness attributes a cause. `CAUGHT` says the
assertion noticed; `BUILD-FAILED` says the compiler noticed; `TIMEOUT` says it hung.
**When the environment fails, it fails through whichever of those doors is nearest, and
wears that door's name.** A verdict is not stronger than its evidence — and it is not
more accurate than its label, either.

## 19. Ask whether content fits its box, not whether the box reached zero

`assertLayout` flagged a child only at exactly zero width or height. A mutation forcing
party-legend rows to `height: 0` left them **2px** tall — the row keeps 1px of padding
top and bottom — with their text clipped entirely away, and the check passed. Measured,
not assumed: 16.5px before, 2px after.

"Collapsed" was the wrong question. A child whose overflow is unreachable (`hidden` or
`clip`) and whose `scrollHeight` exceeds its `clientHeight` is now a failure — the
vertical counterpart to rule 9's horizontal `scrollWidth` test. It catches the whole
family of squashed rows rather than the single value zero.

## 20. An instrument must resemble the client whose behaviour it predicts

**Any probe or measurement must be configured to resemble the client whose behaviour it
claims to predict. A verdict that changes when the instrument changes is a finding about
the instrument first.**

Where this came from: `probe-sources.mjs` sent Node's default `User-Agent`, which
Wikimedia's UA policy rejects. `query.wikidata.org` answered 403, and the probe recorded
that as the source's posture — for the government tab's primary source.

```
no UA            403   ACAO: *
descriptive UA   200   ACAO: *
browser-like UA  200   ACAO: *
```

**A browser always sends a real User-Agent, so the 403 describes a state no browser can
ever occupy.** The instrument failed a policy the real client satisfies automatically,
and then reported its own failure as a property of the source. One architecture decision
later we would have built a Worker proxy for an API that never needed one.

The same defect had a second form, further upstream. `requiresCustomUserAgent` forced
WORKER-REQUIRED with the reason "requires a descriptive User-Agent, which browsers are
forbidden to set" — which has the causality backwards. The browser cannot set the header
and does not need to. The client that fails such a policy is an anonymous script. And the
flag was independently wrong: `openparliament-ca` answers 200 with `ACAO: *` with or
without a UA, and was scored WORKER-REQUIRED on the strength of the flag alone.

Two rules follow:

1. **Configure the instrument to look like the client.** Origin header, User-Agent,
   redirect policy, credentials mode — each one the probe gets wrong is a way for it to
   measure itself.
2. **When a verdict moves because the instrument moved, the instrument is the finding.**
   Two verdicts here flipped from WORKER-REQUIRED to CLIENT-FETCH with no upstream change
   whatsoever. Neither was ever a fact about the source.

This generalises past CORS. Any measurement whose subject can respond to the measurer —
rate limits, bot policies, feature detection, user-agent sniffing — can report the
measurer's identity as the subject's behaviour.

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
  against a page that never reached the expected state. **Three call sites**
  (`verify-render.mjs:674`, `:970`, `:1054`); all three consume the result.

  This row previously read "Both call sites consume the result" and was **false when
  written or false soon after**. There were three, and `:970` — `pickEvent`'s wait for
  the marker tooltip, inside the flakiest check in the suite — discarded its result, so a
  tooltip that never appeared scored the same as one naming the wrong event. A doc row
  asserting a class is clean, while an instance of that class sits in the check least
  able to afford it, is worse than no row: it is a reason not to look. Repaired, and the
  count is now stated so the next drift is visible.

  **Any row in this section claiming a class is clean must name the call sites it
  checked.** "Both call sites" was unfalsifiable at a glance; three cited line numbers
  are checkable in seconds, and go stale loudly rather than quietly.

Known and *not* fixed, stated so it is not mistaken for covered: **32 assertions match a
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

## 21. A summary marker must be computed from the outcome it summarises

**Any status glyph, badge, count or mark must derive from the result it claims to
summarise — never from the input, the intent, or the claimed status.**

Where this came from: the deploy gate printed its `[  ok  ]` / `[ BLOCK]` mark from
`source.verifiedAgainst`, the value being *checked*, rather than from whether the check
had passed. When a new rule started rejecting sources that claimed `live` without a
fixture, the offending row printed:

```
[  ok  ] nasa-eonet   LIVE WITHOUT COVERAGE — no fixture registered …
```

Green mark, failing row. The gate still exited non-zero and the problem was still listed
below, so nothing was *wrong* in a machine-checkable sense — which is exactly the danger.
**Readers scan marks, not detail columns.** A glyph that does not derive from the outcome
is a lie in the most-read position on the screen, and it is most convincing on the row
that most needs attention.

This generalises to every summary this project prints: the per-step assertion table, the
mutation verdicts, the probe's verdict column, the extraction's kept/dropped tally. Each
is a compression of a result, and a compression computed from anything other than the
result can disagree with it.

The fix is mechanical: compute the marker *after* the check, from what the check
recorded. Here that meant comparing the problem count before and after the row.

## 22. A numeric fact whose meaning depends on a unit carries the unit or does not render

**If a number means nothing without its unit, the unit is part of the value — not a label
beside it, and not optional.**

Where this came from: EONET publishes `magnitudeValue` alongside `magnitudeUnit` —
`9673 hectare` for a wildfire's burned area, `35 kts` for a storm's winds. The adapter
emits a measurement only when *both* are present and well-formed.

`9673` on its own tells a reader nothing, and it is worse than nothing: placed next to an
unlabelled `35`, it invites a comparison that is meaningless. A bare number in a numeric
surface reads as commensurable with the other bare numbers around it, which is a
wrong-value failure of the kind rule 7 ranks above absence.

This generalises past EONET. Any fact whose interpretation depends on a unit or basis —
currency and current/constant (decision E2), fatality counts against a best/high/low
estimate, seat counts against a chamber size, percentages against their denominator —
either carries that context to the point of render or does not render.

The corollary is the one that bites: **do not aggregate, average, rank or compare across
units.** Sorting `9673 hectare` against `35 kts` produces an ordering with no meaning,
presented with all the authority of a sorted list.

## 23. A defect report cites the line that exhibits the defect, not the line that would

**Before reporting a defect, read the code path that actually runs. Cite it. A report
built from a plausible derivation is a hypothesis, and hypotheses are reported as
questions.**

Where this came from: EONET's category *ids* are camelCase (`severeStorms`), and the
layer id is derived by lowercasing and hyphenating whitespace — which would yield
`eonet:severestorms` and fail to match the registered `eonet:severe-storms`. That was
written up as a shipped step-7 defect.

It is not one. The parser reads the category **title** (`"Severe Storms"`), not the id, so
it derives `eonet:severe-storms` correctly. The derivation was right; the input was
imagined. One `sed` of the parsing function was the difference between a finding and a
false alarm.

A false defect report costs more than silence: it sends someone to fix working code, and
if they "fix" it the working code becomes broken. It also spends the credibility that
makes real findings actionable.

Disposal matters too. A near-miss like this is recorded as an explicit **non-finding**,
with the reason it is not a bug, so the next reader who notices the same camelCase ids
does not re-derive the same wrong conclusion. An investigation that concludes "no defect"
has produced knowledge, and throwing it away means paying for it again.

## 24. Registering a layer is a claim that its marker represents the phenomenon

**Before adding a layer, state what its marker asserts about the thing it draws. If that
assertion is false for the phenomenon, the layer does not ship — visibly unmapped beats
mapped and wrong.**

Where this came from: EONET publishes 13 categories and the app registered 3. Deciding
what to do with the other 10 turned out not to be a coverage question at all. A point
marker asserts *this happened here*. That is true of a wildfire, a flood, a volcano and a
storm. It is false of a drought, a temperature extreme, sea-lake ice, snow cover, water
colour and dust haze — **a drought is not located at a coordinate**, and pinning one to
its centroid would be the position-precision error decision L3 exists to prevent, made
worse by being invisible: the marker looks exactly like a wildfire's.

Two further tests a layer must pass, both learned from the same decision:

- **Has its live path ever run?** `landslides` and `manmade` are honest point events, but
  neither appeared in a 200-event live sample. Registering them would ship a layer whose
  category mapping, marker, tooltip, click and provenance have never been exercised by
  real data — five code paths that could each be broken with nothing to show it.
- **Does another source already carry these events?** EONET publishes earthquakes and so
  does USGS. Registering both would double-count the same events under two provenances,
  and a user clicking one of a coincident pair would get a different answer depending on
  which marker the raycast happened to hit.

The general form: **a layer is a claim, and an unregistered layer that is visibly listed
as unmapped is more honest than a registered one that draws the wrong shape.**
`unregisteredLayers()` surfacing them in the rail is the design working, not a gap in it.

## 25. Assert the invariant, not an incidental property of the fixture

**An assertion must encode the property it means to protect. A number that happens to be
true of today's fixture is not that property.**

Where this came from: `layers.test.ts` asserted `events.length === 5` under the name
*keeps stale events in the data rather than deleting them*. The invariant is **no event is
dropped**; five was a coincidence of how many events the fixture held. Adding a sixth —
for an unrelated reason, a measured wildfire — broke a test about deletion.

Both failure directions matter, and the second is the dangerous one:

- **It breaks on unrelated changes.** A test that fails when its input legitimately grows
  trains people to update the number without reading what the test is for, and the next
  person updates it again.
- **It can pass while the invariant is violated.** If the fixture had gained one event and
  the parser had dropped a different one, the count would still have read 5 and the test
  would have stayed green over exactly the bug it was written to catch.

The fix is to derive the expectation from the input: `events.length === raw.events.length`
says *nothing was dropped* and stays true however the fixture grows. This is rule 2's
sibling — that one says name the test after the invariant, this one says **assert the
invariant you named.** A correct name over an incidental assertion is worse than either
alone, because the name is what the next reader trusts.

## 26. A contract test must issue the request the app issues

**Any divergence between a fixture's request URL and the request the app actually
constructs is a defect in the test, not a property of the source.**

Twice a fixture URL diverged and the test passed anyway:

- `wikidata-sparql` omitted `SERVICE wikibase:label` while its body carried `*Label`
  bindings — a request that could not have produced that response
- `wikimedia-commons` omitted `origin=*`, without which MediaWiki emits no
  `Access-Control-Allow-Origin` at all, so the request being measured had a different
  CORS posture than the one the app makes

Host equality is too weak to catch either. `tests/fixtures.test.ts` compares **query
parameters**: every parameter the app sends to a host must appear on the fixture's request
to that host, with the app's URLs read out of `src/` rather than kept as a second list
that would drift from the first.

### The guard's own first version passed vacuously

Worth recording, because it is the sharpest instance of this class so far. The scanner
matched `https?://[^\s'"`)]+`, which **stops at the first closing quote** — so a URL
assembled as

```ts
'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo' +
`&iiprop=url&origin=*&titles=${encodeURIComponent(title)}`
```

contributed only `action` and `prop`. A planted removal of `origin=*` **passed**. A guard
written against vacuous passes was itself passing vacuously, and only a planted violation
revealed it — rule 6 earning its keep on the check that exists to enforce rule 6's
neighbours.

The scanner now joins adjacent string-literal concatenations before matching. The general
lesson: **a static scanner's blind spots are invisible in its output**, because a pattern
that matches nothing and a codebase with nothing to match produce identical results. Every
such scanner needs a planted case that proves it can see the construct it claims to check.

## 27. Every scanner ships with a permanent planted case

**A static scanner, guard or lint rule without a planted-violation test that runs in the
suite is unverified, and its green output means nothing.**

Rule 6 said a rule that has never failed is not a rule, and was applied by hand: break the
thing, watch it go red, commit. That is not enough, because the check keeps working only
until something changes underneath it and nothing is watching. **The planted case must be
permanent and run every time.**

The class this closes is not one anyone outruns by being careful. A pattern that matches
nothing and a codebase with nothing to match produce **identical output**, so a scanner's
blind spots are invisible in its own results *by construction*. Being careful cannot see
past that; only an input known to contain a violation can.

Earned twice in one sitting, on the guard written specifically to prevent vacuous passes:

1. The URL scanner matched `https?://[^\s'"`)]+`, which stops at the first closing quote,
   so a URL assembled by concatenation contributed only its first fragment. A planted
   removal of `origin=*` **passed**.
2. Fixed, and the permanent planted case then caught a *second* blind spot the hand-check
   had missed: `${encodeURIComponent(x)}` contains a `)`, and the URL character class
   stops at one, so every templated URL was truncated at its first interpolation.

The second was found by the test, not by reading the regex — which is the entire argument
for the rule. It also immediately found a real divergence in the `gdelt-doc` fixture, the
third fixture recording a request the app does not make.

Guard logic therefore lives in `tests/guards.ts` as pure functions, so each can be run
against real input *and* against a synthetic violation. A guard embedded in the `it()`
block that uses it cannot be pointed at a planted case without inventing a whole codebase.

## 28. Count distinct entities, not result rows

**Any count taken from a SPARQL result is a count of rows unless you make it otherwise.**

A query with `OPTIONAL` clauses returns a cross product. A head of state with two recorded
parties yields two rows, and **a country whose leader has two parties is not a country
with two leaders** — but `rows.length` cannot tell those apart, and the number it produces
is confident, plausible, and wrong.

This bites hardest where the count carries meaning. The multi-holder guard refuses to
render a leader when more than one person concurrently holds the office; keyed on rows it
would have refused ordinary countries whose leader has a second party, a second image, or
a second start date. Counting `new Set` of holder identities is what makes it a count of
people.

Audited across the existing query parsers: the cabinet and legislature parsers already
deduplicate through `Map<string, …>` keyed on position and chamber QIDs, so their
`vacantCount`, `untranslatedCount` and party lists are per-entity and correct. Recorded so
the next reader does not re-derive it.

## 29. A guard keyed on a missing field fires on schema drift, not on its condition

**Choose the polarity so that an absent field degrades toward the normal path, and let
only an explicit signal trigger a refusal.**

`headOfStateIsPerson` defaults to **true** when the binding is absent, and only an
explicit `false` refuses. The opposite polarity looks safer — "refuse unless proven a
person" — and is a trap: if the query changes, the endpoint drops a variable, or the label
service times out, the field vanishes for *every* country and the app refuses to render
any leader at all. The guard would then be firing on schema drift, not on the condition it
was written for, and it would look exactly like a correct refusal.

The general form: **a guard reading a field it did not verify is present cannot
distinguish "the answer is no" from "there was no answer".** Where the two must be
distinguished, the absent case is its own state and is treated as such — the same
distinction rule 3 draws between an error response and evidence, and the same one P5 draws
between UNAVAILABLE and zero.

A refusal guard also needs a **positive control**: a case that must still resolve. A guard
that refuses everything passes every test written about what it refuses, which is the
vacuous-pass class pointed in the opposite direction.

## 30. "No answer" is not an answer of "no" — the register

This project has now rediscovered the same distinction three times in three places, each
time paying to learn it again. Registering it so the fourth instance is recognised rather
than re-derived, the way the P3 class register works in `DECISIONS.md`.

| Instance | The two states conflated | Rule |
| --- | --- | --- |
| An error response read as evidence about the success path | "the server said no" vs. "the server never answered" | rule 3 / A2 |
| A missing scoring input summed as zero | "the input measured zero" vs. "the input was unavailable" | P5 |
| A guard reading an absent binding as false | "Wikidata says not a person" vs. "Wikidata was not asked" | rule 29 |

**The shape:** a value that is absent, and a value that is present and negative, arrive at
the same call site looking identical — and the *absent* one is silently given the
negative's meaning. What makes it dangerous every time is that the resulting behaviour is
plausible: a WORKER-REQUIRED verdict, a score of zero, a refusal to render. None of them
looks like a bug.

**The test, applied to any new check:** if the field, response or input were simply
*missing*, what would this code do? If the answer is "the same thing it does when the
answer is no", the two states are conflated and one of them is wrong.

**The fix is always the same:** make absence its own state with its own name —
`INCONCLUSIVE`, `UNAVAILABLE`, `undetermined` — and choose the default polarity so that
absence degrades toward the ordinary path rather than toward a confident refusal
(rule 29).

## 31. Test a common cause before classifying errors individually

**When a batch of errors shares a plausible common cause, resolve one instance and re-run
before describing any of them. A raw list is honest; a raw list wearing confident labels
is not.**

Where this came from: bringing `tests/` under the type checker surfaced 160 errors, which
were reported as five groups — including **77 classified as genuine test weakness** and
**5 called a latent bug**. Both were wrong. `@types/node` was missing, so
`node:assert/strict` did not resolve; once it did, `assert.ok()`'s `asserts value`
signature narrowed the types and **all 82 vanished**. The tests had been narrowing
correctly the whole time; the checker could not see it.

Resolving the one root error and re-running would have collapsed 82 rows to zero *before*
any of them were described as defects. The cost of not doing so was a report that sent
attention at code that was already correct.

**The count was accurate and the classification was not, which is the more useful half to
get right.**

### This does not argue for pre-filtering

It argues that **enumeration and classification are separate steps**. Enumerate
everything, unfiltered — that is how the shipped-but-unvalidated sources, the unexercised
`eonet:floods` layer and the fifteen multi-holder countries were all found, and
pre-filtering to what looks suspicious would have missed each one. Then, before attaching
a label to any row, ask what the rows have in common and eliminate it.

A list presented as *"160 errors, cause not yet investigated"* would have been completely
honest. The same list presented as *"77 genuine test defects"* was not, and the difference
is a step that costs one re-run.

### Corollary — a second tsconfig is a second view of the codebase

The same change produced two errors in `src/countries.ts` that were not defects either:
the new test config did not include `src`, so `src/types/modules.d.ts` never loaded, the
`world-atlas` topology import lost its ambient declaration, and `feature()` resolved to
the wrong `topojson` overload.

**Two configs that disagree about which ambient declarations are in scope will report
errors about code neither config's owner has touched.** Any project config that narrows
`include` or `types` needs the ambient declarations its files depend on, or it invents
errors in code that compiles cleanly under the other view.

## 32. A guard that cannot be called directly has not been tested

**Every guard, gate, scanner and harness is factored so its logic is directly callable
with a synthetic input.** Not "has a test somewhere" — *reachable*, in one call, with a
hand-written argument, without starting a browser, a network request, or the suite it
belongs to.

This is stronger than rule 27, and it explains why rule 27 alone was not enough. Rule 27
says every scanner ships with a permanent planted case. Planting a case requires
*reachability*, and three separate guards did not have it:

| Guard | Where its logic lived | How its bug was found |
| --- | --- | --- |
| URL scanner (rule 26) | inline regex in the check | planted case, only after extraction — **twice**, two different bugs |
| Deploy gate verdict | inside the loop that used it | never; extracted and planted in queue item 3 |
| Mutation classifier | inside the mutation runner | a misconfigured environment, by luck |

Each read correctly. Each carried a comment stating its principle accurately. Each had gone
green hundreds of times. **A host suite going green says nothing about a guard inside it**,
because the suite exercises the guard on the inputs the suite happens to produce, and a
guard's failure mode lives on the inputs nobody produces.

The mutation classifier is the clearest case: its only exercise path was an hour-long
browser suite, so in practice it had been run against exactly one kind of input — a healthy
run — for its entire life. The input that broke it took thirty milliseconds to construct
once the function could be called at all.

**Testability is a property of the factoring, not an afterthought.** The shape that works,
used now by `deploy-gate-rules.mjs`, `unexercised-check.mjs`, `mutation-verdict.mjs` and
`chromium-path.mjs`: the caller does the I/O and passes everything in — including
predicates like "does this file exist" — and the rule does nothing but decide. A `.d.mts`
alongside each lets the TypeScript tests import it without `allowJs` or a cast.

**Auditing for this is standing, not one-off.** A new gate, scanner or harness is not
finished until its logic can be called with a synthetic input. `UNEXERCISED-PATHS.md` §9
holds the current audit.

### 32a. A guard testing a proxy is not testing its principle

Every one of the three stated its principle correctly in a comment, and tested something
adjacent to it:

| Principle the comment stated | Proxy the code tested | Where they diverge |
| --- | --- | --- |
| does the app request this URL | does this string appear before the next quote | concatenated and templated URLs |
| did any assertion run | did a `FAIL` line get parsed | the harness dies and prints its own FAIL |
| is this source exercised | is a fixture registered | a fixture that produces no event of that kind |

The proxy and the principle agree on every input anyone tries, and diverge **exactly at the
case the guard exists for**. That is not a coincidence: the ordinary inputs are why the
proxy looked equivalent when it was written, and the extraordinary input is the guard's
whole reason to exist. A proxy chosen because it agrees on normal data is therefore
*selected* to fail on the data that matters.

So when writing a guard, state the principle first, then ask what input would separate it
from the thing being measured — and if that input cannot be constructed and passed in, the
guard is not finished (rule 32).

## 33. A synthetic input must describe a state the real system can reach

Rule 32 says a guard must be callable with a synthetic input. This is its immediate
hazard: **a synthetic input can describe a world that cannot exist, and a test built on one
exercises a path the real function never takes.**

Found immediately, in the first test written under rule 32. A stub filesystem for
`findChromiumCandidates` claimed:

- `/opt/pw-browsers` — does **not** exist
- `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — **does** exist

No filesystem can be in that state. The real function checks the directory before reading
it, returned `[]`, and the test failed. The code was right and the test was wrong (rule 2),
but the interesting part is the near miss: **had the assertion been weaker — a length check,
a `deepEqual` against `[]`, an `ok(found)` — it would have passed, and it would have been
asserting that a function returns nothing when asked about an impossible directory.**

This is a distinct shape from the vacuous passes already catalogued. Those tested a real
state with a guard that could not see it. This tests a state that is not real at all, so no
guard could see it and nothing is learned either way.

**The check when writing a stub: could the system actually be in the state I have
described?** Existence predicates, status/header pairs, and cache entries are the usual
offenders, because each has internal consistency requirements that a hand-written literal
does not enforce — a 304 with a body, a `nodata` fact with a value, a directory whose
absence coexists with its contents.

Where the real states are recorded, replay them instead of inventing them:
`tests/probe-verdict.test.ts` replays all 32 rows of `data/probe-results.json` through the
extracted ladder. Synthetic cases prove the rule does what its author thinks; a replay of
recorded observations proves it does what the live run did.

### 32b. A union dispatch is exhaustive by construction, or it is a fall-through waiting to happen

`factHtml` branched on three of four fact states and let the rest fall through to the tier
badge. A fifth state was added and the fall-through rendered an **OFFICIAL badge over a
value that was never received**. It was found by reading the function. Nothing else caught
it and nothing else could have — the fall-through was type-correct.

**Every dispatch over a union ends in a `default` arm calling `assertNever`.** Adding a
member then fails to compile at every unhandled site.

The two unions here fail differently, and the difference is why "the compiler will catch it"
was false:

| Union | Shape | What the compiler does |
| --- | --- | --- |
| `Provenance` | object types | Errors **only if** the tail reads a property the new variant lacks. Accidental: a new kind carrying `sourceId` slid through `sourceName` unnoticed. |
| `FactState` | string literals | **Nothing.** There is no property to read, so a fall-through is always silent. |

All three of the dangerous sites were in the second class.

**Audit, 2026-08-12 — 9 sites, 8 lacked exhaustiveness:**

| Site | Union | Before |
| --- | --- | --- |
| `badgeMarkup` | state | if-chain, tier fall-through — **shipped the defect** |
| `factHtml` value | state | ternary chain, formatted-value fall-through |
| `factHtml` asOf | state | boolean condition; a new state defaulted to showing a date |
| inspector value wording | state | keyed on `value === null`, so **every** absence read "no data" |
| inspector "As of" row | state | **did not branch at all** — dated every fact including failed ones |
| `sourceName` | provenance | if-chain; a new kind with `sourceId` falls through silently |
| `renderProvenance` | provenance | accidental safety only (tail reads `raw`) |
| `provenanceState` | provenance | accidental safety only (tail reads `inputs`) |
| inspector broken banner | state | **fine** — a genuine binary predicate, not a dispatch |

Two of those were not merely at risk: the inspector rendered one state's wording for all
states, so a failed request already read "no data" inside the dialog — the same conflation
the fifth state was added to prevent, one click away from the badge that got it right.

**Verified by planting, not by inspection** (rule 27): adding a sixth `FactState` produces 4
compile errors; adding a sixth `Provenance` kind produces 3, including at `sourceName`,
which is the site whose old safety was accidental.

## 34. A mutation states what it removes, and why nothing else supplies it

The mutation suite is itself a guard, and rule 32's argument applies to it: **a guard that
has only ever been watched succeeding is a guard nobody has watched work.** For a mutation,
succeeding means being CAUGHT — and a CAUGHT verdict proves nothing if the failure it
produced would have been produced by some other defence anyway.

**Every mutation carries a written statement of the behaviour it removes and why no other
mechanism supplies that behaviour.** A mutation whose CAUGHT verdict is explicable by a
defence other than the one it names is not a valid mutation, however green it looks.

### Where this came from

The intended first fetch-layer mutation removed the selection-identity check in
`selection.ts`, to watch the browser suite catch France's data rendering into Jamaica's
dossier. It would have been CAUGHT — and for the wrong reason. `renderEconomyTab` keys its
loads by ISO3 and renders `loads.get(currentIso3)`, so a late France response is written to
France's key and never reaches a panel showing Jamaica. **The keying is the load-bearing
defence; the identity check is the second lock.**

Removing a second lock and finding the door still shut proves the door, not the lock.

Caught by asking *what would this mutation actually change* before running it — which is
the habit the whole suite depends on and which no verdict can supply, because both a real
catch and a vacuous one print the same word.

### The test to apply

For each mutation, answer in writing:

1. **What behaviour does the edit remove?** Not "which line" — which observable behaviour.
2. **Which named assertion should fail, and why is that assertion sensitive to exactly this
   behaviour?**
3. **What else in the system would produce the same failure?** If anything would, the
   mutation is measuring that instead.

Question 3 is the one that was missing.

### 20a. A flake rate is a property of the app UNDER A HARNESS CONFIGURATION

Rule 20 says the instrument must resemble the client whose behaviour it predicts. This is
the same rule from the other side: **the instrument's own cost can change the client's
behaviour, and then the number it reports describes the pair, not the app.**

Measured on step 7's marker-click check, which is frame-rate sensitive, while adding four
scenario switches to the economy step:

| Harness configuration | Step 7 failures |
| --- | --- |
| Before the fetch-layer work | 1 (the known flake) |
| Scenario switching by `page.goto`, placed before step 6 | 5 |
| Same, moved after step 7 | 4 |
| Scenario switching by an in-page hook, no reload | 2 |
| Same configuration, next run | **0** |

Reordering helped and did not fix it. Removing the page reloads did. Four extra WebGL
context teardowns ahead of a frame-rate-sensitive check took it from one failure to five.

**So every flake number is recorded with the harness configuration that produced it**, in
the same way the frame profile already is. "The marker click fails about 40% of runs" is
not a fact about the app; it is a fact about the app under a stated harness, and the two
diverge exactly when someone changes the harness for an unrelated reason.

### 20b. The standing conversion pattern, for every panel switched to live

Panels 2–9 each face this, and the economy panel is the worked example.

**A panel's hard cases come from specific subjects' real histories, and live data will not
reproduce them on demand.** The economy tab's difficult branches are a mid-series gap
(Kosovo), a redenomination spanning five orders of magnitude (Zimbabwe), an eight-year-old
latest observation (Eritrea), a single lone observation (Fiji), and an indicator with no
data at all (Somalia). None of those is guaranteed to exist in tomorrow's API response.

Left pointing at the live path, **those assertions quietly stop testing the branch they were
written for and start testing whatever the API returned that morning.** They keep passing,
which is what makes it dangerous.

So, when converting a panel:

1. **Keep the fixtures.** They become the contract test's input and the browser suite's
   deterministic input; they stop being the app's data source.
2. **Add a `fixtures` scenario** serving exactly what the panel's fixture provider served,
   per subject.
3. **Point every hard-case assertion at that scenario**, and say in the harness why.
4. **Point the state assertions** — loading, stale, degraded, unavailable — at their own
   scenarios, since each is reachable only through a specific remote failure.
5. **Prove the live path separately**, under `PROBE_LIVE=1`, against invariants rather than
   values: a live figure that changes yearly must not be pinned, or the test fails every
   spring for the wrong reason.

## 35. Before recording an environmental limitation, prove the mechanism is environmental

**A limitation written down without a mechanism is a reason to stop looking, wearing the
authority of a finding.**

Where this came from: `economy tab: clickable` failed twice on this machine and was recorded
in §15 as a second frame-rate flake, with the conclusion that "this machine cannot run the
browser suite to a clean sheet". Two runs of evidence appeared to confirm it. One commit
later it would have been a permanent fact about the repository.

It was a replaced DOM node. `selectCountry` parked for 250ms and 500ms — each under one frame
at 750ms/frame, and each already forbidden by rule 15 — so it returned mid-rebuild and
`clickOrFail` handed Playwright a selector whose node was about to be swapped. Playwright's
actionability wait handles an element that moves or is covered; it cannot help with one that
is replaced, because every retry re-resolves the selector and starts again. Instrumenting the
click took minutes and produced the answer immediately: 18 mutations, 2 node replacements,
`elementFromPoint` returning the tab itself, unobstructed.

**The evidence that "confirmed" the environmental reading was equally consistent with the real
cause**, which is what makes this failure mode dangerous rather than merely wrong. Both
readings predict an intermittent click timeout on a slow machine.

### The test to apply

Before attributing a failure to the environment, answer:

1. **What is the mechanism, stated concretely enough to be wrong?** "Low frame rate" is not a
   mechanism. "Playwright's stability check needs two consecutive frames with an unchanged
   box, and at 750ms/frame only 20 frames fit in the timeout" is.
2. **What measurement would distinguish it from a code defect?** If none exists, the
   attribution is a guess.
3. **Has that measurement been taken?**

An environmental attribution that cannot answer 3 is recorded as *unexplained*, not as
environmental. `UNEXERCISED-PATHS.md` has a register for exactly that state.

### Why the superseded reasoning is kept in §15 rather than deleted

Every principle in it was correct — do not raise timeouts, do not retry to green, do not skip
a failing check. That is precisely why it was persuasive. **Sound principles deployed as a
reason not to investigate produce a conclusion that looks rigorous and is false**, and the
next session needs to see what that looks like from the inside.

### 21a. One clean run is not a closed flake — L9 stays open

Recorded 2026-08-14, immediately after the marker-click check passed on its first attempt in a
273-assertion, zero-failure run — the first clean sheet this machine has produced.

**That is one data point, and it does not close L9.** The harness waits changed in the same
run, so the clean result is confounded by design: it is equally consistent with "the new
condition-based waits removed a source of churn that was also starving the raycast" and with
"this run happened to go well". Rule 21's principle applies to closing a flake as much as to
opening one — **a flake is closed with numbers, not with a good day.**

What stands unchanged:

- **L9 remains open.** The mechanism — globe.gl failing to resolve a click at low frame rate —
  was located but never explained, and nothing in this run explains it. `DECISIONS.md` L9/L10/L11
  are untouched.
- **The first-attempt assertion stays.** `check('the marker click worked on the first attempt',
  attempts === 1, …)` is what made the retry visible in the first place; removing it because a
  run was green would restore exactly the blindness §15 was written about.
- **This run is recorded with its configuration**, per 20a: swiftshader, `cf62bcd`+, i3-10110U,
  750ms/frame idle, under the new `waitForStableNode` / `waitForDomQuiet` waits.

**What a closure case would look like:** ten consecutive runs clean under the new waits, or a
`measure-frame-profile.mjs` rate measured under them and compared against the 20%/50%/30%
recorded above. Either produces a number. Until then this is a single encouraging observation,
and writing it up as a fix would be the same error as writing the click timeout up as
environmental — a conclusion outrunning its evidence, in the friendlier direction.

## 36. Equivalence between commits is per-step identity, never failure-count equality

**On a machine with a documented flake, two runs of the same code do not produce the same
number.** So "byte-identical" cannot mean what it sounds like, and a comparison that samples a
flake's distribution and calls the difference a diff will report a regression that is not
there — or, worse, miss one that is, because the noise was large enough to hide it.

Measured while gating a pure-refactor commit on exactly that criterion:

| Commit | Runs of unchanged code | Failure counts |
| --- | --- | --- |
| 3 | 4 | **2, 7, 2, 4** |
| 4 | 2 | **7, 1** |

The baseline moved by a factor of three and a half with no line changed, and the commit under
test scored *better* than its own baseline on one run and worse on another.

### What equivalence means instead

**AMENDED 2026-08-15 — criterion 1 below was wrong, and its own evidence was wrong.**

1. ~~**Per-step assertion counts identical**, step by step. These are structural: across six runs
   spanning two commits they did not vary once (279, per step, both sides).~~
   **False.** See the amendment below: per-step counts vary under flake, for the reason this
   very rule gives two paragraphs down. `clickOrFail`'s extra `clickable` check has to land
   inside *some* step, so it inflates that step's count as well as the total. The claim that
   the totals move while the per-step counts hold was not consistent with the mechanism the
   rule had already identified, and six runs happened not to expose it.
2. **Every assertion outside the documented flakes passing.**
3. **The failure set minus the documented flake clusters is empty.**

Criteria 2 and 3 are decidable in the presence of a flake. Raw failure-count equality is not,
and neither is per-step count identity.

### The amended criterion

**Compare what is comparable under flake:**

1. **The set of assertions that RAN in both runs must be identical**, and identical per step.
   This is the load-bearing clause.
2. **Any assertion present in one run and absent from the other must be explained by a
   documented flake's cascade** — named, not waved at. If it cannot be, the comparison is
   **inconclusive**, and the answer is to re-run, not to judge.
3. **The failure set minus the documented flake clusters is empty**, as before.

An inconclusive verdict is a real outcome, not a failure to reach one. It is the honest state
when the instrument's noise is the same size as the signal being looked for.

### Worked example: commit 3 against itself

The case that forced the amendment. A pure-refactor commit (4) was gated against its
predecessor (3), and produced what looked like a diff:

| Run | Total | Failures | Steps 7 / 7b / text |
| --- | --- | --- | --- |
| Commit 3, run 1 | 282 | 5 | **34 / 12 / 36** |
| Commit 3, **run 2** | **279** | **0 — all checks passed** | **33 / 11 / 35** |
| Commit 4, run 1 | **279** | 1 (L9) | **33 / 11 / 35** |

**Commit 3 differs from itself.** Same commit, same harness, same SwiftShader configuration,
nothing between the two runs but the flake. That alone disposes of per-step identity as a
criterion.

And the comparison the diff was blocking resolves in the refactor's favour on the strongest
possible footing: **commit 3's flake-free run and commit 4 are identical in all ten steps** —
not "explicable given flake" but the same vector, 279 assertions each. The apparent diff was
commit 3's *flaky* run being used as the baseline.

**The lesson is about which run to compare against.** A flaky configuration has a floor — the
run where nothing flaked — and that floor is the only stable baseline. Comparing against a run
that happened to flake measures the flake.

### What the cascade can and cannot explain

The amendment is only worth having if it can still fail a real regression. Measured limits, from
three runs — stated as measured, not as proven:

- **Observed: the cascade only ADDS assertions**, +1 per dropped click, and only in
  click-bearing steps (7, 7b, text fidelity). It did not alter a step with no click path.
- **Therefore a count change in a click-free step is not cascade-explicable**, and neither is
  any *reduction*. Both remain genuine diffs under the amended rule.
- **NOT established: that the cascade can never subtract.** A dropped click causing a step to
  bail out early would remove downstream assertions, and three runs do not rule that out. Until
  it is measured, a reduction is treated as a real diff — which is the fail-closed direction.

If a future measurement shows the cascade can explain an arbitrary difference on this
configuration, then verify comparisons between SwiftShader commits are inconclusive **by
construction**, and the honest disposition is to record them as such rather than pass them.
That is a live possibility, not a rhetorical one.

**Why the totals move at all**: `clickOrFail` emits a `clickable` check only when a click
fails, so a flaky run *inflates* the assertion total — 279 becomes 281 or 283. The count is a
derived signal, not an independent one, and comparing totals without comparing failure sets
reads a flaky run as a structural change.

### This is 20a, applied to comparison rather than to a rate

Rule 20a says a flake rate is a property of the app under a harness configuration. The same
follows for any number the harness produces: **a comparison inherits the variance of the
configuration it was measured on.** A criterion that assumes determinism is not wrong about
the code; it is wrong about the instrument. The right response is to state the criterion in
terms the instrument can actually decide — not to loosen it, and not to re-run until the
numbers agree, which is rule 15's failure wearing a comparison's clothes.

**Fix the comparison method before the deciding run, not after seeing its result.** That
ordering is what separates a verdict from a rationalisation, and it is cheap: the method
follows from the known flakes, which are already written down.

### 35a. A configuration is identified by what it reports, not by the flag that requested it

The sentence rule 35 was missing. Nothing ever asked the process which renderer it had, and
**the name was the only thing making it hardware** — an environment variable, a code comment,
a decision-log line and a `TESTING.md` table all said "hardware GL" over four sessions of
SwiftShader measurements.

The check costs one `getParameter` call. `scripts/gl-config.mjs` now asks, every run prints the
answer beside its numbers, and a run that requested the GPU and got software **fails** rather
than warning — a warning nobody reads is how the original mislabelling survived. Planted cases
in `tests/gl-config.test.ts` use the real strings, including the exact SwiftShader line that
went unnoticed.

### L9's historical rates were two mechanisms blended at a ratio set by frame rate

**This is why no two measurements of it ever agreed.** `pickEvent` was measuring a hover and a
click together and reporting one number, and the mix depended on how fast the machine rendered:

| Configuration | hover-missed | click-dropped | What was really being measured |
| --- | --- | --- | --- |
| SwiftShader, 1.3fps | **0 / 30** | all failures | the hover check was **vacuous** — the previous hover's tooltip never cleared, so `waitFor('.evt')` was satisfied instantly by a stale element carrying the right id |
| GPU, 59.9fps, before the fix | **22–24 / 30** | the rest | the tooltip now clears, so the guard is real — and it exposed a two-round-trip read race between "does `.evt` exist" and "what id does it carry" |
| **GPU, 59.9fps, after the fix** | **0 / 30** | **50 / 50** | hover is genuinely correct; the click is genuinely lost |

**The hover half was a harness defect and is fixed** (one evaluation returns presence and
identity together). **The click half is L9** — globe.gl's raycast failing to resolve — and at
60fps it fails **100% of the time**, deterministically, rather than the ~20% recorded at
1.3fps.

So every historical L9 rate — 93% first-attempt, 40% shipped, 90% single, later 20%/50%/30% —
was a blend of a real defect and a vacuous check, weighted by frame rate. None of them was
wrong to record; all of them were measuring two things at once, which is why 20a's insistence
on recording the configuration mattered more than anyone realised at the time.

**Per rule 21a this is an explanation, not a closure.** L9 stays open, the first-attempt
assertion stays as its canary, and MITIGATED still waits on S3's keyboard path. A failure that
reproduces every time is far more tractable than one that reproduces one time in five — which
is what makes the timeboxed diagnostic worth doing now and not before.

---

## 37. Success is a property of the body, and a parameter that shapes the response must be verified

**Three instances in one day, which is this project's threshold for a rule.**

| Instance | What the status said | What was true |
| --- | --- | --- |
| `exchangerate.host` unauthenticated | **200** | `{success: false, error}` — the key was missing |
| My own auth sweep, scoring on `res.ok` | **accepted** | it reported NO MECHANISM ACCEPTED for a source whose mechanism worked |
| `congress.gov` with `sort=bogus` | **200** | the sort was silently ignored; the order was arbitrary |

**A status code answers a question about transport. Every question worth asking here is
about content.** "Did the host answer" is not "did it answer what I asked for", and the gap
between them is where a panel renders confidently wrong.

### The rule, in two halves

1. **Establish success from the response body against the request's intent, never from
   transport status alone.** A 200 carrying `{success: false}` is a failure. A 403 carrying a
   documented "no data for this region" is not necessarily one.

2. **For any parameter that SHAPES the response — sort, filter, pagination, projection,
   units — the adapter verifies the shaping happened.** An API that ignores an unknown
   parameter rather than rejecting it will answer 200 to a request it did not honour, and that
   response is indistinguishable from a correct one unless something checks.

### Worked example: the congress.gov ordering check

`sort=updateDate+desc` is load-bearing — the default order returns bills from 2007 — and
`sort=bogus` returns 200 with arbitrary order and no error. There is a second route to the same
failure that looks *more* correct than the working code: the sort value contains a `+` meaning
"space", and `URLSearchParams` percent-encodes it to `%2B`, which makes the sort invalid, which
the API ignores. **Correct percent-encoding produces the broken request.**

So the builder constructs that parameter by hand with a test asserting `%2B` never appears, and
`parse` asserts the ordering it asked for.

### Detect and throw, never repair and conceal

`parse` does **not** re-sort locally, and this is the half to hold hardest.

Sorting the rows ourselves would hide the fact that the API ignored the request, and the next
symptom would surface somewhere harder to see: **page 2 of an unsorted result set is not the
continuation of page 1**, so a locally-sorted page 1 would look perfect while the sequence
beneath it meant nothing.

**A repaired symptom relocates the defect.** The repair is cheap, local and satisfying, and it
converts a loud failure at the boundary into a quiet one in the middle — which is rule 7's
distinction between absent provenance and wrong provenance, arriving at a different door.

---

## 38. A source whose rows mix granularities must have its aggregate discriminator identified at registration

**Three consecutive sources, same shape, same week.**

| Source | Discriminator | What a naive sum produces |
| --- | --- | --- |
| Ember | `is_aggregate_series` (and `is_aggregate_entity`) | `Renewables` and `Total generation` summed beside `Solar` and `Coal` |
| EIA | `countryRegionTypeId` = `c` / `r` | regional aggregates summed beside their own member countries |
| Comtrade | `cmdCode` `999999` / `TOTAL`, plus `isAggregate` | 100,000 HS lines summed beside the all-commodities row |

**In every case the source flags its own aggregates and a naive sum ignores the flag.**

### Why this needs a rule rather than care

**Double-counting does not look wrong. It looks big.** A total that is roughly twice a plausible
total is still a plausible total — it has the right units, the right order of magnitude, the
right shape on a chart, and it moves correctly year over year. There is no rendering artefact,
no null, no exception. Nothing in the pipeline objects, because nothing is malformed.

That is what separates this from an ordinary parsing bug: the failure has no symptom until
someone independently knows the right answer.

### The rule

1. **At registration**, a source whose rows can mix granularities has its aggregate
   discriminator identified and written into the registry notes — the field name, its values,
   and which value means "this row sums other rows".
2. **The contract test asserts the discriminator is present and populated**, before any code
   sums anything. If the field vanishes upstream, that must fail loudly rather than silently
   flatten every aggregate into a leaf.
3. **The filter keys on the source's own flag, never on a hand-written list of aggregate
   names.** A name list is a second source of truth that rots the first time the source adds a
   grouping — and it will read as correct until it does.

### The trap inside the rule

**A discriminator that happens to work is not a discriminator.** Ember's `is_aggregate_series`
is `true` for `Demand` and `false` for `Net imports`, because it means "sum of other series" —
not "not a generation source". Filtering flows on that flag removes `Demand` **by accident**
and keeps `Net imports`. Two different questions were being answered by one field, and only one
of the answers was right.

So the discriminator must be checked against what it *means*, not against whether the output
currently looks correct.

---

## 39. A comment that predicts a specific future mistake does work no test can do

**Evidence: one day of latency between the prediction and the attempt.**

`portwatch.ts` carried this beside its two tier decisions:

> Rendering `capacity` as OFFICIAL would assert a measured tonnage the source itself calls an
> estimate. **A future session tempted to "simplify" both families to one tier is reading two
> different kinds of number as one.**

The next day, writing PortWatch's missing live contract check, I asserted that a transit count
was `ESTIMATE` — collapsing exactly those two families, for exactly the reason predicted. The
comment was right about who, about what, and about why.

**There is no test for a change nobody has made yet.** A test pins behaviour that exists; this
kind of comment pins a *decision*, and decisions are what later sessions overwrite while
believing they are simplifying. The comment is the only artefact that can address someone who
has not arrived yet.

### What makes such a comment work

1. **Name the tempting change**, not the current behaviour. "These are different tiers" is
   documentation. "Someone will want to merge these, and here is why they must not" is a guard.
2. **Say who will be tempted and when.** A future session, mid-refactor, seeing two similar
   fields.
3. **Give the consequence in the reader's terms** — here, asserting a measured tonnage the
   source itself calls an estimate.

### And when the prediction fires, fix the invariant rather than the instance

The failed draft asserted one tier. The correction asserts **both**, so what is now pinned is
the *distinction* — the two families drifting into one — rather than either tier alone. That is
rule 25 applied to one's own mistake: the fix should assert the thing that was really at stake,
which is usually more general than what failed.

---

## 40. A two-state assertion must report which states its sample actually contained

**Composes rule 10's positive control with rule 16's decaying check.**

A check that reported zeros stay distinct from absences is only as exercised as its sample. If a
live response happens to contain no absences, the assertion runs, passes, and has proven
nothing — and nothing says so. Over time that check becomes a green tick with no content, which
is rule 16's failure arriving slowly instead of at once.

**The rule:** an assertion that distinguishes two states counts both in its sample, and **says
so loudly when the sample is one-sided.** Not a failure — a one-sided sample is usually the
world's fault, not the code's — but never silent.

```
unhcr: live sample had 412 reported zeros and 0 absences —
the zero-versus-absent distinction was not exercised this run
```

**Applies to every rule-30 check as it is touched:** zeros versus empty, reported versus dash,
known versus unknown. Each is only as exercised as its worst sample, and the worst sample
arrives on a day nobody is watching.

**Why stderr rather than a failure.** A source that legitimately reports no absences this week
has not broken anything, and failing the run would train people to ignore it — rule 15's
lesson. What must not happen is the check reporting success in a voice indistinguishable from a
check that actually discriminated.

---

## `--only` on verify: what it does, and what its name overstates

**Built 2026-08-15**, closing the last open item of the harness-speed goal.

```
node scripts/verify-render.mjs --only "1 —"     17 assertions,  10.4s
node scripts/verify-render.mjs                 287 assertions,  98.4s
```

**It runs up to and including the matching step, then stops. It does not run one step in
isolation, and it cannot.** The steps share one browser and one page: step 4 asserts against a
dossier step 1 navigated to, and step 7's markers exist because an earlier step selected a
country. Running step 4 alone would mean re-deriving its preconditions, which is a restructure
rather than a flag.

The flag is called `--only` because that is the name S4 and the goal document use. **The
discrepancy is documented at the flag itself**, not only here, because a name that overstates
what it does will be believed by whoever reads the name first.

**A stopped run is not a green run.** Every step that did not execute is listed as skipped and
the process exits non-zero — the same rule the harness already applies to an aborted run, for
the same reason: a check that did not run must not look like one that passed.

### The bug it introduced on the way in

`BASE` was `process.argv[2]`. Adding a flag made `--only` itself the base URL, and the run died
with `Cannot navigate to invalid URL` — a message naming the symptom and not the cause. The fix
takes the first POSITIONAL argument and skips flags and their values explicitly, so adding a
second flag cannot repeat it.

Worth recording because the failure mode was *silent about its own cause*: nothing said "you
passed a flag where a URL was expected", and the harness had been happy to treat any string as
a base URL for its entire life.

---

## 41. File content goes through an editor, never through shell interpolation

**Decided on arithmetic, not preference.** One session, one author, two tools:

| Tool | Writes attempted | Failures |
| --- | --- | --- |
| Edit / Write | dozens | **0** |
| shell heredoc, `node -e`, `sed` | ~15 | **5** |

### The five

1. Backticks in a `node -e` replacement — a fixture manifest entry silently not inserted.
2. Backticks in a DECISIONS row — `` `OPEN-QUESTIONS.md` `` executed, leaving a gap mid-sentence.
3. A `python - <<'PY'` fallback chained to `node -e` — the heredoc collapsed and the shell
   interpreted half the repository as commands.
4. Escaped backticks in a FIXTURES replacement — imports landed, the entry did not.
5. Backticks in a PROGRESS table — `` `nc` `` and `` `hdx@un.org` `` executed, blanking two cells.

### Why it is a rule and not a note

**Two of the five did not fail loudly.** They produced files that read correctly in a diff
summary and were missing a word in the middle of a sentence — a document asserting something
slightly false about itself, which is this project's own defining failure class arriving in its
tooling rather than its data.

**And the lesson was recorded after the first incident.** I reached for the shell four more
times, because it is one call instead of two and each string looked simple enough to survive.
That is the proof the rule needs: **a recorded lesson without a rule does not hold.** The
convenience is real, it is small, and it bought five incidents.

### A mechanical guard would be vacuous here, and that is worth saying

The obvious check — flag `echo`/heredoc/`sed` writing into `docs/` or `data/` — cannot see these
failures, because they were **ad-hoc commands, not committed scripts.** Nothing in the
repository ever contained them. A guard that scans the repo would pass every time while the
failure recurred, which is precisely the vacuity this project refuses elsewhere.

**So the rule stands on the tally rather than on a check**, and says so, rather than shipping a
guard that would look like coverage.

**The shell runs programs. It does not write prose into files.**

### Second clause: inline shell content also costs autonomy

The five incidents above are a **corruption** risk. There is a second cost, and for unattended
work it is the more expensive one.

**A long inline command exceeds the security scanner's analyzable length and forces a human
approval prompt.** During an autonomous goal that is not a delay — it is a stop. The run idles
until someone is present, which is precisely what the goal was structured to avoid.

Measured the same session: a diagnostic script written as a heredoc triggered an approval
prompt. The identical script, written to a file and run as `node <path>`, does not.

### The mechanical form

1. **Diagnostic and scratch scripts are WRITTEN with the Write tool** — to the scratchpad
   directory or a gitignored `scratch/` — and then **RUN with a short `node <path>`**.
2. **Never heredoc'd, never `echo`'d, never inlined into bash.** This applies to everything:
   probes, measurements, one-off comparisons, throwaway checks. There is no size below which
   inlining is worth it, because the two failure modes do not scale with size — a single
   backtick corrupts, and a moderately long command is unscannable.
3. **Write-then-run is one extra tool call.** It buys zero corruption and zero approval prompts.

**The throwaway nature of a script is not an argument for inlining it.** Every one of the five
corruption incidents was in a "quick" command, and the scanner does not care that a script was
meant to be temporary — this is the same reasoning as rule 37's corollary about scratch tools:
a throwaway's output still gets read as a measurement, and a throwaway's failure still costs the
run.

### Third clause: never `cd` into the directory you are already in

A compound command beginning with `cd` **defeats the auto-approval classifier**, which cannot
statically determine the working directory — so none of the pre-approved patterns match and the
command needs a human. `cd /repo && npm test` requires approval; `npm test` does not.

**The `cd` was never necessary.** The shell already runs in the repository. It was habit,
repeated across most of a session, and every instance was a potential silent pause.

- Run `npm`, `node`, `git` **bare**, so they match their approvals.
- If a command genuinely needs a different directory, **use a tool that sets the working
  directory** rather than a shell compound.

### What the three clauses have in common

They are one lesson: **a command shape that defeats the classifier defeats an unattended goal.**
Corruption is the visible cost and it is the smaller one — a mangled file fails loudly and gets
fixed in the next turn. **An approval prompt during unattended work is a goal paused for hours,
silently**, and nothing in the run reports it, because from the inside there is no difference
between waiting and working.

---

## 42. A disclosure ships with the case where it must NOT appear

**Either half alone passes on a mechanism that fires always, or never.** A check that a caveat
appears is satisfied by a panel that caveats everything; a check that it is absent is satisfied
by a panel that caveats nothing. Only the pair distinguishes a working disclosure from a stuck
one.

| Disclosure | Must appear | Must NOT appear |
| --- | --- | --- |
| P3's shortfall caveat | a contributing input came back empty | a *required* input came back empty — that suppresses the value instead |
| "None recorded" | Costa Rica, an empty deployment list | New Zealand, a real deployment |
| The no-equipment card | New Zealand, which has forces | Costa Rica, which abolished its military |

### The asymmetry is the design, not a special case

The no-equipment card is the clearest of the three. It exists to stop a reader inferring absence
from silence — so for a country with forces it corrects a false impression, and for a country
that abolished its military it would **create** one: "we hold no equipment inventories" implies
an inventory we are missing. **Where silence is the accurate answer, the disclosure must be
silent too.**

### How this rule arrived, which is the part worth keeping

1. **Caught.** P3's browser assertion covered only the required-input case, where the value is
   suppressed. An app that rendered every derivation as "no data" would have passed it. The gap
   was found by a checker, not by design.
2. **Corrected.** The contributing-shortfall case was added *against its opposite*, so neither
   passes alone.
3. **Internalised.** Step 8's none-recorded and no-equipment pairs were built paired from the
   start, and the step's mutation targets the absence half specifically — it makes the card
   render everywhere, and only the "Costa Rica must not show it" assertion can see that.

**That progression is what a rule maturing looks like**, and it is why this entry exists rather
than three separate notes: the third instance was cheaper than the first two because the shape
was already known.

### The mutation belongs on the absence half

A mutation that removes a disclosure is caught by the presence check, which would likely have
existed anyway. A mutation that makes it fire everywhere is caught **only** by the absence
check — so that is the one to write, because it is the one that proves the pair rather than
half of it.

## 43. A fixture captured from a defective query makes the defect the expected value

**A live capture proves the endpoint answered. It does not prove you asked the right
question** — and once the answer is committed as a fixture, every assertion written against it
inherits the defect as its definition of correct.

### Where this came from

`buildLegislatureQuery` returned the parent body as a chamber of itself: the United Kingdom
came back as Commons 650, Lords 808, and *Parliament of the United Kingdom* 1433 — the other
two added together. The defect was then blessed in **three places at once**, each of which
looked like diligence:

| Place | What it said | Why it passed review |
| --- | --- | --- |
| the builder's doc comment | "GBR 4.7s (Parliament 1433, Lords 808, Commons 650)" | it was recording a *timing* fix, and the timing was right |
| the captured fixture | 5 rows, 3 distinct chambers | a faithful capture of what the endpoint returned |
| the contract test | `assert.equal(chambers.length, 3)` | titled "three chambers from five rows (rule 28)" — and rule 28 *was* being applied correctly |

The test was not careless. It was testing the parser's row-collapsing behaviour, which works.
**It took its expected value from the fixture, and nobody asked whether three was right.**

The same file's other assertion recorded that Iceland "returns one party, which is data
sparsity and not a pass" — careful language about the wrong thing. The single row was
**"Member of the Althing"**, an office. `P527` is *has part(s)*; a chamber's parts are not its
parties. Measured across eight countries the clause returned committees, a library, offices and
bare Q-ids, and **not one political party**.

### The check

When a contract test's expected value comes from a capture, **one assertion must come from
outside the capture** — from the world, not from the response:

```ts
// from the capture — proves the parser reads what the endpoint sent
assert.deepEqual(rowsAndDistinct(raw, 'chamber'), { rows: 2, distinct: 2 });

// from the world — proves the endpoint was asked the right thing
assert.deepEqual(chambers.map((c) => c.label).sort(), ['House of Commons', 'House of Lords']);
```

The second assertion is the one that fails when the query is wrong and the capture is faithful.
**The United Kingdom is bicameral** is a fact about the United Kingdom; `length === 3` was a
fact about a broken query.

### How to spot it before it ships

Ask of every captured expectation: *would this number be different if the query were wrong?*
If the answer is "no, because the number came from the query", the assertion is a mirror. A
mirror never disagrees with you, which is why it reads as passing.

**This is rule 25 inverted.** Rule 25 says assert the invariant rather than an incidental
property of the fixture. Here the incidental property was promoted to an invariant and given a
rule number in its title — the citation made it look considered.

## 44. Piping a check into `tail` throws away its verdict — twice over

**`cmd | tail -2` reports the exit code of `tail`, which is always 0.** And it shows the last
two lines, which for a compiler is the last two *errors*, not the count of them.

### Measured, on this repository

```
npm run typecheck 2>&1 | tail -2 && git add -A && git commit …
```

The typecheck **failed with many errors**. `tail` exited 0, so `&&` proceeded and the commit
landed with a red typecheck. Two of the errors were visible; the rest were scrolled off by the
same pipe that hid the failure.

The errors were not cosmetic. A test file had invented `InputKind` values —
`'bloc'`, `'treaty'`, `'conflict'` — which are not members of the union. At runtime
`weights[finding.kind]` returned `undefined`, every weight resolved to 0 through `?? 0`, and
**every assertion in the file passed for the wrong reason**: "an empty input contributes nothing
to the score" is trivially true when no input contributes anything.

**The test run was green and the typecheck was red, and the pipe made them agree.**

### The rule

- **Never pipe a gate into `head`, `tail`, or `grep` when its exit code is going to be used.**
  Run it bare, or capture the exit code explicitly:

```bash
npm run typecheck; echo "EXIT=$?"          # verdict visible
npm run typecheck > /dev/null 2>&1; echo "EXIT=$?"   # verdict only
```

- **Never chain a commit off a piped gate.** `gate | tail && commit` is `commit`.
- If output must be trimmed to read it, run the command **twice**: once bare for the verdict,
  once piped for the excerpt. The second run is cheap next to a committed red gate.

### Why this is rule 6's shape, not a shell tip

This project already had the lesson — *"the failure line is the verdict; the counts are
commentary"* — recorded after a red suite was committed because the failing line printed first
and the summary looked fine. That lesson was about **reading** output. This is about
**destroying** it: the pipe removed the verdict before anyone could misread it.

**A test that passes for the wrong reason is worse than one that fails**, because it is counted
as coverage. The file involved now asserts its own premise — that every kind it uses resolves to
a non-zero weight — so the vacuity fails loudly instead of passing quietly.

### 41d. No quoted parentheses or braces in command text — and no compound chains

**The third shape, found 2026-08-16.** A quote character inside parentheses or braces makes
the command classifier refuse to scan the command at all — "expansion obfuscation". The
offender was pure decoration:

```bash
git push -q 2>&1|tail -1; git log --oneline -1; git status --porcelain; echo "(clean)"
```

**No allowlist entry can fix this**, which is what separates it from the first two clauses.
An approval rule matches a command the classifier has parsed; this shape stops it parsing.
The only fix is not to write it.

**Two rules, both cheap:**

1. **Never quote parentheses or braces in bash command text.** `echo "(clean)"` is
   decoration, and decoration that costs an approval prompt is decoration removed.
2. **Never echo a summary the command already proves.** `git status --porcelain` returning
   nothing IS the clean signal. An `echo` beside it adds a claim on top of evidence, which is
   the same anti-pattern this project rejects in a panel: a caption asserting what the data
   already shows, able to drift from it.

**And split the compound.** `push`, `log` and `status` each match an existing approval on
their own; chaining them into one line is what keeps creating unscannable composites. Three
short commands cost nothing and each is individually scannable.

## 45. The run lock protects the measurement's TREE, not just its CPU

**Beside the freshness check, and covering what it cannot.**

`requireCleanCheckout` runs at two points — before starting and after finishing. It is a
**freshness check**: it proves, afterwards, whether a result can be trusted. It cannot prevent
anything, and its verdict arrives twenty minutes late, when the only remaining option is to
throw the run away.

**`scripts/tree-guard.mjs` closes that window to one second.** While the lock is held it
samples the tracked tree every second and kills the run on the first change. A stray write
costs a second instead of the whole measurement, and it says so while the person who made the
edit still remembers making it.

The mutation harness starts it itself. **A mechanism you have to remember to switch on is the
same thing as a note**, which is the entire lesson below.

### Why this exists, and it is the third time

Two runs were voided in one session by writes to the tracked tree while they measured. **The
second happened after the first was recorded in `FOUND.md`, promoted to a lesson, and
restated aloud** — in the same breath as "I am leaving the tree untouched".

That is this project's own recurring proof that a recorded lesson without a mechanism does not
hold:

| Lesson | What it took to stop happening |
| --- | --- |
| shell escaping kept breaking commands | **rule 41** — file content through Edit/Write, never interpolation |
| a green summary read over a red failure line | **rule 44** — never pipe a gate whose exit code you will use |
| edits during a measurement | **this rule** — the lock guards the tree |

### The habit it defends against, named precisely

Not carelessness. **A long background job makes the repository feel free**, because the work is
happening elsewhere. Both leaks were documentation — work that feels like paperwork rather than
like touching the code under test. That is why the guard watches TRACKED files only: an
untracked scratch file cannot change what is being measured, and a guard that fired on those
would be ignored within a day.

### Two design points worth keeping

**It kills rather than warns.** Letting a contaminated run continue spends nineteen more
minutes producing a table the harness will refuse to stand behind — and a table that *looks*
complete is worse than none, because someone will read it.

**A git failure is INCONCLUSIVE, not a violation.** Rule 3 applied to the guard's own
instrument: `git` failing is not evidence the tree is dirty, and killing a valid run on a
transient error would make the guard worse than the problem it solves.

### And the ad-hoc version got this wrong, which is why the real one is shaped this way

A throwaway watcher written the same day used `tasklist | grep node` to decide whether the run
was still alive. Node processes exist for many reasons, so it kept watching after the run had
finished and flagged legitimate post-run work as contamination. **The permanent guard keys on
the LOCK** — `readLock()` plus `processIsAlive(lock.pid)` — so "is the measurement still
running" is answered by the thing that actually knows, not by a proxy that is usually right.

## 46. Exercise a parse-failure path with a REAL wrong body, not a synthetic one

**Rule 33 solved from the other direction.** Rule 33 says a synthetic input must describe a
state the real system can reach. The usual way to satisfy it is to construct a fake failure
carefully. The better way, when it is available, is not to construct one at all: **borrow a real
body from elsewhere in the suite that genuinely cannot parse.**

### The worked example

`tests/dossier-live.test.ts` drives the dossier header's parse-failure path by pointing it at
the `fixtures` scenario, which serves **legislature captures**. Those are real Wikidata
responses — captured live, through the app's own builder — and `parseCountryDossier` genuinely
cannot read them.

```ts
const load = await loadDossierLive(fetcherFor('?econ=fixtures'), 'GBR');
assert.equal(load.record, null);
assert.equal(load.failure.reason, 'shape');   // and NOT a null record
```

The assertion that matters is the second one: the failure surfaces as a **shape failure**, never
as a null record the header would render as *"no data"*. A synthetic malformed blob would have
tested the same line of code while proving less — nobody doubts that garbage fails to parse.
What was in question is whether a *plausible* wrong answer fails loudly, and only a real body
answers that.

### The asymmetry the same test exposed, which is the durable half

Two parsers, two case structures, and **the difference comes from their domains rather than
from their code**:

| Parser | Empty middle case? | Why |
| --- | --- | --- |
| `parseCountryDossier` | **no** | a country either has a Wikidata entity or the response is unreadable. There is no "a country with no country in it" |
| `parseLegislature` | **yes** | a country can legitimately have zero chambers recorded, which is a real fact about our source's coverage |
| `parseCabinet` | **yes**, and more broadly than expected | it collects rows matching its variables, so a well-formed response with no matching rows yields an empty cabinet rather than a `ShapeError` |

So the dossier's thrown parse is **always** a failed request, while the legislature's absence
has two legitimate readings that the panel must keep apart.

**Parsers inherit their case structure from their domain.** A suite that assumed one shape for
both would have invented a state one of them cannot occupy — asserting an "empty dossier" that
the world has no example of, and passing, because the assertion would never run.

### How this was found

By asserting the wrong thing first. Two tests expected `parseCabinet` to throw on a mismatched
body; it returned empty. The tests were corrected to the measured behaviour and the reason
recorded, because the finding — **shape failures on this source come from malformed envelopes,
not from wrong-but-valid ones** — is more useful than the assertion that produced it.

## 47. A stored number's lifecycle: where it came from, what it outlives, what it can still claim

Three clauses of one principle, all found in the TV build-time extract, all about a number
that would otherwise have been **silently wrong**.

### 47a. Provenance of a count is the STAGE that produced it

The extract removes 1,430 channels — 1,053 `dmca` and 377 `nsfw` — and the panel discloses
how many were removed. That count must come **from the removal stage**, not from the surviving
list.

**A disclosure recomputed from what survived a removal always reports zero removals.** The
panel would say "nothing was excluded" precisely because the exclusion worked, converting a
real disclosure into a false one — and it would look right, because zero is a plausible number.

Generalised: when a pipeline stage drops rows, only that stage knows how many. Any later stage
asking "how many were dropped?" is asking a question its input cannot answer.

### 47b. A count can outlive its rows, when the count IS the fact

The extract carries 9,908 channels and drops 29,733 that have no stream — but keeps a
**per-country count** of the dropped ones.

Shipping 29,733 rows to preserve what a single integer expresses would be the artefact serving
the disclosure instead of the reverse. Dropping **both** would silently erase the
listed-but-not-watchable distinction, which is a real fact about our source's coverage.

So: keep the rows when the reader needs to see them, keep the count when the reader needs to
know the number, and be explicit which one the surface actually uses. A distinction that
survives only in rows nobody renders is a distinction that is already gone.

### 47c. A stored measurement can only claim what was true when it was stored

Every channel in the extract reports `health: 'unchecked'`, never `online`.

**Liveness is a property of the network at a moment.** A build artefact recording "online"
ships a claim it has no evidence for — the check ran once, at build time, against a different
network, possibly weeks ago. `unchecked` is the honest state of a staleness-prone measurement
at rest, and it is what lets the panel say "not checked" rather than implying a check that is
no longer meaningful.

The same reasoning forbids a captured `fetchedAt` from being refreshed on read, and forbids a
cached tier from outliving the response that justified it.

### Why these three belong together

They are the same number at three points in its life: **where it came from**, **whether it
outlives the rows that produced it**, and **what a stored copy of it can still honestly claim**.
Each failure mode produces a plausible number rather than an obvious error, which is why none
of them is caught by a type and all three need saying.

## 48. Do not ask a SPARQL endpoint for a join you can do in JavaScript

**Three occurrences in one project is a pattern, not bad luck.** Every time, the expensive
clause was attaching an ISO country code — `?country wdt:P298 ?iso` — to a result set that was
otherwise cheap.

| Query | Without the ISO join | With it |
| --- | --- | --- |
| cabinet ministers | fine | **504 at 65s** |
| armed-forces entities | 338 rows, 820ms | **504 at 65s** |
| upcoming elections | 131 counted, 4.7s | **502 at 50s** |

The fix is the same each time and takes minutes: **two cheap queries, joined locally.** A few
hundred rows against a few hundred costs nothing in JavaScript, and the endpoint never has to
build the product.

### Why this keeps happening, which is the useful part

The join looks free in the query. `?country wdt:P298 ?iso` is one line, reads as a lookup, and
the property has only a few hundred subjects — so the instinct is that it *narrows*. What it
actually does is give the optimizer a second large set to reconcile, and the plan it picks may
scan that set per row.

**A cheap-looking clause is not a cheap clause, and only measurement tells them apart.**

### The diagnostic that settles it in two minutes

When a query dies, do not start rewriting it. Run these:

1. **A trivial control** — is the endpoint healthy at all? A 502 is a gateway error and a 504 is
   a timeout, and they point at different causes. Confusing "the endpoint is unwell" with "my
   query is too expensive" wastes rewrites on a healthy query.
2. **The same query with COUNT and no projection** — does the join set even resolve?
3. **Remove one clause at a time**, timing each. The one whose removal changes the outcome is
   the cost, and it is frequently not the one that looks expensive.

That sequence found the answer here in three queries after four rewrites had failed, and the
same sequence had already found it twice before — which is why it is written down rather than
rediscovered a fourth time.

## 49. An origin, path or host check is only as good as the nastiest string aimed at it — and the planted case IS that string

**Found 2026-08-17, while writing the edge Worker, by planting before shipping.**

The Worker proxies 27 sources. The client names a registered source id, never a
destination, so the upstream comes from `data/sources.json` and the reachable host set is
the set someone committed after reading a licence. The composition is the dangerous line:

```js
const upstream = new URL(`${upstreamPath}${search}`, registered);
```

I wrote a shape check first — reject a path starting with `//`, because a protocol-relative
path changes host while wearing the shape of a path. Then I wrote a test asserting that
`/\evil.test/x` does **not** escape, reasoning that only a leading `//` was dangerous.

**The test failed, and it was right.** WHATWG URL parsing normalises the backslash to a
slash, so `/\evil.test/x` resolves to `https://evil.test/x`. A single leading slash sails
straight past a `//` check. The only thing standing between this Worker and being an open
relay wearing our origin was the second defence:

```js
if (upstream.origin !== registered.origin) return refuse(400, 'composed URL left the registered origin');
```

### What this generalises to

**Any check that decides whether a string stays inside a trusted origin, host or directory
is a claim about an infinite set, and you are testing it with the finite set you thought
of.** The check will be exactly as strong as the nastiest input someone aimed at it —
never stronger, because the inputs nobody tried are the ones it silently admits.

So:

1. **Compare the RESULT, never the input.** Shape checks on the input are heuristics over
   a syntax you do not control the parser for. Compose the thing, then ask what it
   actually became — `upstream.origin !== registered.origin` is decidable; "does this look
   relative" is not.
2. **Keep the shape check anyway, as a second door.** Two independent refusals for one
   attack is not redundancy, it is depth. Ours are independent: one rejects by syntax, one
   by outcome, and the case that defeats the first is caught by the second.
3. **The planted case IS the evil string.** Not a paraphrase of it, not a comment
   describing it — the literal input, in a corpus that grows. `tests/worker-router.test.ts`
   keeps `HOSTILE_PATHS`, and every entry is asserted **twice**: that it genuinely escapes
   a naive `new URL(path, origin)`, and that the router refuses it. The first assertion is
   the one that stops the corpus filling with harmless strings that make the suite look
   thorough — rule 33 applied to attacks.
4. **A refusal must not echo the attacker's input.** The reason strings here are fixed
   text, so a caller cannot get their own host reflected back out of us.

### Why this belongs beside rule 27

Rule 27 says plant the case before you trust the guard. This is the sharpest instance of
it in the repo, because the planted case did not confirm my reasoning — **it overturned
it.** I believed the shape check was sufficient and wrote a test to demonstrate that
belief; the test demonstrated the opposite, before any of it shipped. A guard whose
planted case has only ever agreed with its author has not been tested, it has been
illustrated.
