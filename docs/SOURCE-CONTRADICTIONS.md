# Live data versus what the shipped panels assumed

Steps 3, 4 and 7 were built against EONET, Wikipedia REST and Commons without a fixture,
a contract test, or a single observed response. This is what those three sources actually
return, measured 2026-08-12, set against what the code predicted.

**Reported before anything is changed.** Nothing here has been acted on.

---

## EONET — decision L8 is false

**L8 says:** *"A layer with no magnitude concept carries no magnitude fact at all …
EONET does not measure magnitude, so rendering 'no data' for one would invent a missing
value rather than report an absent one."*

**EONET does measure magnitude.** Every geometry object carries the fields:

```
geometry[0] keys: ["magnitudeValue","magnitudeUnit","date","type","coordinates"]
```

Observed values across 200 live events:

| magnitudeValue | magnitudeUnit | Event kind |
| --- | --- | --- |
| 9673 | `hectare` | wildfire — burned area |
| 35, 30, 25 | `kts` | severe storm — wind speed |

`src/sources/eonet.ts:149` hardcodes `magnitude: null` for every EONET event, so the app
is currently **discarding a published measurement** on the strength of a claim about the
source that is not true.

The nuance that makes this a decision rather than a bug fix: these magnitudes are
**heterogeneous and unit-bearing**. Hectares and knots are not comparable to each other,
and neither is comparable to an earthquake's moment magnitude, which is the number the
marker-sizing and clustering paths use. So the correct response is *not* to feed
`magnitudeValue` into the existing magnitude field — that would size a wildfire against a
quake and produce exactly the confident-nonsense this project exists to avoid.

L8's **conclusion** may still be right for sizing. Its **stated reason** is wrong, and a
decision resting on a false premise needs re-deciding rather than quiet retention.

### Other EONET shapes confirmed present

| Case | Observed in 200 live events |
| --- | --- |
| `Point` geometry | 250 |
| `Polygon` geometry | **6** — the derived-centroid path is exercised by real data |
| Events with multiple geometries over time | **3** — the "most recent geometry wins" rule is load-bearing |
| Open events (`closed: null`) | 27 |
| Closed events | 173 |
| Categories present | `wildfires` 191, `floods` 6, `severeStorms` 3 |

Only three of the app's mapped categories appear in a 200-event sample. `volcanoes` did
not appear at all, so the volcano layer has never rendered a real event and its toggle
count would read zero.

---

## Wikipedia REST — the degraded path is shaped differently than assumed

| Case | HTTP | `type` | Thumbnail | Notes |
| --- | --- | --- | --- | --- |
| Ordinary person | 200 | `standard` | yes | — |
| Disambiguation | 200 | **`disambiguation`** | no | 152-char extract that describes nothing |
| Redirect (`Macron`) | 200 | `disambiguation` | no | 20-char extract |
| Non-Latin title (岸田文雄) | 200 | `standard` | yes | resolves to `Fumio Kishida` via `titles.normalized` |
| No article at all | **404** | `Internal error` | no | body carries only `status,type` |

Two findings:

1. **A disambiguation page returns HTTP 200 with a plausible-looking extract.** Step 3's
   bio path has no `type` check, so a leader whose name collides with a disambiguation
   page would render a bio that is really a list of unrelated meanings — presented with
   the same confidence as a real biography. That is a wrong-value failure, not a missing
   one, and rule 7 ranks it worse than absence.
2. **The 404 body is `{status, type}` with `type: "Internal error"`** — no `title`, no
   `extract`. Any parser reading fields off the error body gets `undefined`, and the
   degraded-bio path needs to key on the status code rather than on missing fields.

A redirect resolves silently and exposes the real title in `titles.normalized`, which is
the correct field to record provenance against — not the requested title.

---

## Commons — works, with one shape the credit path must handle

Probed with `origin=*` (decision A1a), which is what made this measurable at all.

| Case | HTTP | Page state | `LicenseShortName` | `Artist` |
| --- | --- | --- | --- | --- |
| Licensed file | 200 | present | `Public domain` | present |
| Second file | 200 | present | `Public domain` | present |
| **File that does not exist** | **200** | **`missing` key present** | absent | absent |

**A missing file is HTTP 200 with a `missing` marker on the page object**, not a 404.
`parseCommonsAttribution` returns `creditRequired: true` when it cannot read a licence,
which is the correct fail-closed behaviour (D5) — but it must reach that path via the
`missing` key rather than via a status code that never arrives.

`extmetadata` carried 15–16 fields on real files, and both `LicenseShortName` and
`Artist` were populated, so the fields the credit line renders do exist.

---

## What this changes

| Source | Verdict |
| --- | --- |
| EONET | **L8's premise is false.** Re-decide: keep the conclusion with a correct reason, or carry unit-bearing magnitudes as their own fact type. |
| Wikipedia REST | Two unhandled shapes in a shipped path — disambiguation-as-biography is the serious one. |
| Commons | Shape confirmed; one branch (`missing`) needs to key on the right field. |

None of these three has a fixture or contract test yet. These captures are what those
fixtures should be built from — including the hard cases, which are the whole point:
a fixture set containing only the happy path would have predicted every one of the
behaviours above correctly and caught none of them.
