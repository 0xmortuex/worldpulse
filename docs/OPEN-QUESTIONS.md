# Open questions

Decisions that are not mine to make, surfaced during autonomous work so that work does not
stop for them.

## The protocol

During a long-running goal I **append here and keep going** whenever I hit:

- **a decision that isn't mine** — which of two defensible behaviours the app should have,
  what a policy should be, what something is called in the UI
- **a tradeoff with no clearly correct answer** — where both options cost something real
  and the choice depends on priorities I don't set
- **a defect whose fix would change specced behaviour** — the fix is clear, but shipping it
  means the app no longer does what a decision said it should

Each entry carries **enough context to answer without reading the code**: what was found,
why it needs a decision rather than a judgement call, the options with their costs, and my
recommendation where I have one. An entry that cannot be answered without opening the repo
is an entry I have written badly.

## What stops work immediately

Three things, and only three. Everything else gets appended and the work continues.

| # | Emergency | Why it cannot wait |
| --- | --- | --- |
| 1 | **Destructive or irreversible** | Deleting data, force-pushing over history, dropping a source's only copy. The cost of asking is a pause; the cost of proceeding cannot be undone. |
| 2 | **Licence violation** | Redistributing data a licence forbids, or shipping content whose terms we have not read. This project's non-commercial standing (decision 3) and its per-feed restrictions are load-bearing, and a violation is not fixed by a later commit — it has already happened. |
| 3 | **The app would assert a false fact to a user** | A wrong value rendered with confidence. Rule 7's category: absent provenance is loud and self-correcting, wrong provenance is silent and self-justifying. This is the failure the whole project is built to prevent, so it outranks finishing the task it was found during. |

A defect that is *latent* — real but not reachable by a user today, like the form-of-government
coin flip while the app makes no runtime fetches — is **not** an emergency. It is recorded
here or fixed in place, and the work continues.

## Status

**No open questions.** Entries appear below as they are found.

---
