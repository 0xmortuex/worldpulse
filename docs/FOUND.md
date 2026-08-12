# Found while doing something else

Findings surfaced mid-item during autonomous work. **Recorded here and not acted on** —
they do not reprioritise the queue.

Each entry says what was found, where, and what it would take to act on it. Nothing here
is a decision for the reader; decisions go to `OPEN-QUESTIONS.md`.

---

## The legislature SPARQL query never completes against live Wikidata

Found while capturing contract-test fixtures for the six query builders (queue item 2).

| Query | Country | Result |
| --- | --- | --- |
| `buildLegislatureQuery` | GBR | **HTTP 504** |
| `buildLegislatureQuery` | ISL (Iceland) | **HTTP 500 after 60.6s** |
| `buildLegislatureQuery` | VAT (Vatican City) | **HTTP 504 after 65.5s** |
| `buildCabinetQuery` | GBR | **HTTP 504** |
| `buildCabinetQuery` | ISL | 200 — **52.6s**, 33 rows |
| `buildCabinetQuery` | TUV | 200 — fast, 17 rows |

**It is not country size.** Vatican City has one legislative body and Iceland has one
chamber; both fail at the ~60s mark, which is WDQS's server-side query timeout. The
legislature query does not complete for *any* country tried.

The cabinet query is not failing but is not healthy either: **52.6 seconds for Iceland**
against a 60s ceiling, and a 504 for the United Kingdom. It works today for small
countries and will fail for large ones.

**Consequence.** The government tab's legislature section can never load live data as
written, and its cabinet section will fail for exactly the countries most users open
first. Both are latent rather than user-visible, because the app makes no runtime fetches
(`UNEXERCISED-PATHS.md` §8) — which is the only reason this is not an emergency under the
`OPEN-QUESTIONS.md` criteria.

**Not acted on.** Fixing it means rewriting two SPARQL queries — narrowing the optional
clauses, splitting the round trip, or moving the work to the Worker — which is query
design, not queue work. It also means the legislature contract test in item 2 cannot be
written against a real capture, which is recorded as deliberately-not-done rather than
silently skipped.
