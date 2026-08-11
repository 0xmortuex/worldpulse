# Fixtures

> **These are hand-authored from published API documentation. They are NOT captured
> responses.** No request in this repository has ever reached these APIs — the build
> environment's egress policy blocks all of them. Every fixture here must be replaced
> with a real capture once egress opens, and the corresponding source's
> `verifiedAgainst` field in `data/sources.json` flipped from `documentation` to `live`.
>
> **Nothing ships to a real deployment while any source it depends on is still
> `documentation`.**

## What they are for

Contract tests assert the *shape* of a response and *sanity ranges* on key fields, so
that an upstream format change fails loudly instead of quietly corrupting the UI.
Those assertions do not care whether the bytes came from a fixture or the network —
so the same test runs against both:

```bash
npm test                 # parses fixtures
PROBE_LIVE=1 npm test    # fetches probeUrl and runs the identical assertions
```

Same assertions, swapped input. When a live run passes, capture its body over the
fixture and mark the source `live`.

## Values are deliberately non-committal

The shapes are faithful to the documented schemas. The *values* are chosen so they
cannot be mistaken for real records:

- `worldbank-indicator.json` — real indicator code and country, with a trailing
  null-valued year, because the World Bank publishes the current year before the
  figure exists and the adapter has to skip it.
- `wikidata-sparql.json` — capital of France. Uncontroversial and stable. Deliberately
  not an officeholder query: a hand-typed head of state would read as a claim about
  who currently holds office.
- `usgs-quakes.json` — synthetic network code `ffx`, event ids `ffx0000001/2`, and
  ocean coordinates, so no entry resembles a specific historical earthquake. Includes
  one reviewed and one automatic event, and one with `felt`/`cdi` populated and one
  with nulls, because both shapes occur.
- `gdelt-doc.json` — `.test` domains, which are reserved and cannot resolve.

## Adding one

1. Write the response exactly as the documentation specifies, including fields the
   adapter ignores. Fixtures that contain only the fields we read cannot catch a
   format change in the fields we do not.
2. Include at least one null or missing optional field. Most adapter bugs are
   null-handling bugs.
3. Register it in `index.ts` with its `sourceId` and the URL it would have come from.
4. Do not add metadata keys to the JSON itself. The fixture must be byte-identical in
   shape to a real response, or it is not testing the real shape.
