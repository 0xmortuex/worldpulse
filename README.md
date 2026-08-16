# worldpulse

A single-page 3D globe that acts as an intelligence dashboard for every country on Earth:
government, legislature, military, economy, news, live TV, natural events and derived
relations between states.

**v1.0.0 — core complete.** Fourteen build steps, all panels, the breaking-news board, the
coverage choropleth, URL-shareable view state and a time scrub.

The interesting thing about this repository is not the globe. It is that **the green is
real**, and most of the code exists to keep it that way.

---

## Part 1 — Provenance: what the app is allowed to say

### Every rendered fact carries a tier and a date

| Tier | Meaning |
| --- | --- |
| `[OFFICIAL]` | From a government or IGO primary source. |
| `[ESTIMATE]` | From a research body that publishes it as an estimate. FAS warhead counts are `ESTIMATE` because FAS says so. |
| `[DERIVED]` | Computed by this app from other facts. The relations score, the coverage figure, the significance rank. |
| `[UNVERIFIED]` | Present, but its provenance could not be established. |

This is enforced through the type system and a scanner, not by convention. A number that
reaches the DOM outside the badge component **fails the test suite** — and if it genuinely
is not a fact (a pixel width, a slider position, an array index) it must be wrapped with a
written justification saying so. There are 14 registered exceptions and each one explains
itself.

### The inspector shows the whole chain

Click any value: the request URL, the HTTP status, when it was fetched, whether it came
from cache, the raw response body, the licence class of the source, and — for derived
values — the arithmetic with every input listed. A `DERIVED` score shows its sum and the
weights that produced it.

### No authored content

The app never writes prose about a country. Every sentence a reader sees is either a
template, a value from a source, or a disclosure about the app's own limits. Where a fact
is missing, the app says which kind of missing it is:

- **"Not recorded"** — we did not ask.
- **"None recorded"** — we asked and the source had nothing.
- **"No party-composition source connected"** — the gap is ours, not the country's.

Those are three different facts and collapsing any two of them is treated as a defect.
That distinction has its own rule, its own guards, and a browser assertion on every
surface that draws it.

---

## Part 2 — The trust machinery

Anyone can make a test suite go green. These are the mechanisms that make the green mean
something.

### The mutation suite

Twelve deliberate defects are injected into a throwaway git worktree — a relations score
that returns neutral for every pair, an inspector that stops showing the request URL, an
occlusion test that lets markers be clicked through the planet — and the suite must catch
**each one by the assertion written for it**, not incidentally.

> `12 mutations: 12 caught by the named assertion, 0 caught elsewhere, 0 SURVIVED`

A mutation caught by the wrong test is reported separately, because that means the
intended guard is not working. The harness refuses to stand behind a run if the tracked
tree changed while it measured, and a watcher kills the run on the first change rather
than discovering it twenty minutes later.

### The doc-versus-tree audit

Documentation that describes behaviour the code does not have is the failure this project
has actually committed: for four days, every reference to "the caveat on the panel"
described something that had never been built.

`npm run audit` checks 23 claims mechanically — every "done" in the build order has a
module behind it, every non-pending tab renders, every verified entity carries a date,
every armed-forces override carries a citation, every live-verified source is named by a
contract test, and any sentence a doc quotes as user-visible exists in the source.

### Paired disclosures

A disclosure that renders unconditionally discloses nothing. Every caveat in this app
ships with the case where it must **not** appear, and both are asserted:

- The military panel's *"this app holds no equipment data"* card renders for a country with
  forces — and is deliberately **absent** for one that abolished its military, where it
  would invent a gap rather than disclose one.
- The relations `SEED` badge is present while seeded and **absent** when the live provider
  lands. The absent case is driven by a test seam, because a disclosure with no test that
  it goes away will still be there long after it stopped being true.
- The time scrub's caveat appears when scrubbed and vanishes at the present.

### The canaries that fail by design

**Five browser assertions fail on every run**, and they are supposed to.

They are `L9`: on hardware with a working GPU, clicking a marker on the globe does not
work. Not intermittently — 100%, deterministically. It was recorded as a 20% flake for
weeks because the measurements ran under a software rasteriser at 1.3fps, where the failure
was rare. Under a real renderer at 59.9fps it fails every time.

The defect is in globe.gl's raycast and is still unexplained. It is **mitigated**: every
marker is reachable from a keyboard-navigable event list that calls the same handler, and
that equivalence is asserted as a set equality in two places. It is **not closed**, because
a route around a defect is not an explanation of one, and the canaries stay red so nobody
forgets which is which.

### Other standing guards

- **Contract tests** issue the request the app issues, against a live capture taken through
  the app's own query builder — not a hand-written sample.
- **Layout and text-fidelity checks** at three viewport widths, with self-tests that
  deliberately break the layout to prove the checker can see it.
- **A bundle budget** per chunk, set from measurement rather than a round number. Frame
  rate is measured and *not* gated, because it varies 46× between renderers on one machine
  and a budget that wide asserts nothing.
- **A licence posture check** — a source declaring restricted terms cannot also declare a
  fetch transport.

---

## Part 3 — What it does

**The globe.** Country polygons coloured by their relation to the selected country, or by
this app's own data coverage. Event markers for earthquakes, wildfires, storms and other
natural events, clustered by proximity, with occlusion so far-side markers are not
clickable through the planet.

**Relations.** A weighted score over shared defence blocs, treaties, intelligence sharing,
economic blocs, historical alliances, active conflicts, severed relations, sanctions and
territorial disputes. Every weight is a slider; the score re-ranks live; the popover shows
the arithmetic. Arcs are drawn for classified pairs only — `nodata` and `neutral`
deliberately draw nothing, because a line where the app has no finding is a claim it cannot
support.

**Dossier panels.** Government (system, cabinet, judiciary, leadership timeline),
Legislature (chambers, seats, status), Military (personnel, expenditure, nuclear status,
command, overseas presence), Economy (indicator series with gaps preserved), News, Live TV.

**Coverage choropleth.** A map of *this app's own gaps*, dual-encoded in hue, lightness and
words, where "not assessed" is visually distinct from "assessed and found nothing".

**Breaking news.** Stories ranked by a `DERIVED` significance score over five normalised
inputs, with ties rendered as bands rather than a false ordering.

**Time scrub, URL state, watchlist.** Score relations as of a past date; share any view as a
link; see the predictions this project made before it saw live data, including the ones it
got wrong.

---

## Part 4 — Honest limits

Everything here is disclosed in the app itself, on the surface it affects.

**L9 is mitigated, not fixed.** Marker clicks fail on GPU hardware. The keyboard route
works and is the supported path. Five assertions fail every run to keep this visible.

**Relations run on a hand-checked seed table.** Not live ingests. The panel carries a `SEED`
badge saying so, and coverage is deliberately partial — most country pairs read as *no
data*, which is correct rather than a bug.

**The breaking-news board ranks one captured feed of fifteen.** Outlet breadth and
syndication volume cannot exceed what has been captured, so every story currently shows as
single-source. The surface says this above the first card and on every card, because a
reader would otherwise read a limit of our capture as a measure of a story's reach.

**Party composition is unsourced.** The reference data records chamber membership through a
property that returns committees, libraries and parliamentary offices rather than parties —
measured across eight countries, zero real parties. The panel states the gap; the
composition bar renders only against fixtures.

**Saudi Arabia has no legislature data** because its reference entry points at the
government rather than at a legislative body, and that reaches no chamber type at any depth
including an unbounded walk. An upstream gap, located and stated rather than papered over.

**One disclosure mechanism is armed but unreachable.** The contributing-shortfall caveat
fires when a derivation rests on fewer inputs than were consulted. The engine can now
express that state; no production provider emits it yet. A test fails the moment one does.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit and contract tests
npm run typecheck  # both projects
npm run verify     # browser assertions, 20 steps
npm run audit      # doc-versus-tree, 23 checks
npm run mutate     # the mutation suite, ~30 minutes
```

`?econ=<scenario>` drives the fetch states — `ok`, `stale`, `degraded`, `unavailable`,
`loading`, `fixtures` — on the panels converted to the live path.

## Documentation

`docs/TESTING.md` holds 47 numbered rules, each with the measured failure that produced it.
`docs/DECISIONS.md` records every judgement call. `docs/FOUND.md` records what went wrong
and how it was found — including the times the tooling was right and the author was not.
`docs/OPEN-QUESTIONS.md` holds decisions that are not the author's to make.

## Licence and data

Sources are used within their published terms; the registry records a licence class per
source and a check refuses a restricted source that declares a fetch transport. Live TV
links to third-party streams and hosts nothing; channels on the upstream blocklist are
excluded at build time.
