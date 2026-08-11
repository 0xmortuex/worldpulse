# Leader-resolution fixtures

> **Hand-authored from the documented Wikidata schema. NOT captured responses.**
> No request in this repository has ever reached `query.wikidata.org`.

## These are a permanent regression suite

When we go live and Wikidata contradicts one of these fixtures, **that is a finding to
investigate, not a fixture to quietly update.** A country changing resolution class is
either real news (a coup, a constitutional change) or a bug in the resolver — both are
worth a human look. Silently re-recording the fixture destroys the only signal.

Update one only after establishing which of those it is, and say so in the commit.

## The people are synthetic on purpose

Every person here is named `<Given> Fixture`. Hand-typing a real officeholder would be
asserting a political fact this app has not verified, and it would go stale the moment
an election happened.

The invariant under test is **which rule fires and what shape the header takes** — not
who holds office. That invariant is exactly what should be compared against live data:
"Iran still resolves to rule 1" is meaningful; "the Supreme Leader is still X" is a
question for the live pipeline, not for a checked-in file.

Office titles, form-of-government labels and country Q-ids **are** real, because those
are structural and the resolver keys off them.

## Coverage

One fixture per branch of the five-rule resolution order, plus the degraded paths.

| Fixture | Branch | Expected |
| --- | --- | --- |
| `presidential.json` | Rule 2 | Head of state leads, single portrait |
| `parliamentary-monarch.json` | Rule 3 | PM leads, monarch as labelled secondary |
| `parliamentary-republic.json` | Rule 3 | Chancellor leads, ceremonial president secondary |
| `de-facto-authority.json` | Rule 1 | Supreme authority leads, formal head of state secondary |
| `de-facto-authority-missing-holder.json` | Rule 1 fallback | Override present, office returns nobody → falls through **with a warning** |
| `executive-monarchy.json` | Rule 4 | Monarch leads |
| `transitional.json` | Rule 5 | Literal title preserved, never normalised to "President" |
| `missing-image.json` | Portrait fallback | No P18 → initials placeholder |
| `no-leader.json` | No data | Neither office recorded |
| `degraded-vitals.json` | Partial person | No date of birth, no party, no image |
| `wikipedia-summary.json` | Bio present | Lead paragraph renders |
| `wikipedia-summary-404.json` | No article | Bio degrades, dossier still renders |
| `commons-imageinfo.json` | Attribution | CC BY-SA licence and photographer credit extracted |
| `commons-imageinfo-missing.json` | Attribution absent | Credit assumed required, failing safe |

Two deliberate cross-checks worth preserving:

- The Iran fixture's form of government is `"Islamic republic"`, which matches **no**
  classification rule. Rule 1 must therefore fire on the override alone, proving it does
  not depend on the form table.
- The `missing-holder` variant proves the override fails **loudly**. A silent fallback
  would show the President as though he were the top authority, which is precisely the
  error the override exists to prevent.
