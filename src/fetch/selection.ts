/**
 * Whether a response that has just arrived may be rendered.
 *
 * ## The defect this exists to prevent (decision F6)
 *
 * A user selects France, then Jamaica two seconds later. France's requests
 * resolve AFTER Jamaica's dossier has rendered, and France's GDP appears in
 * Jamaica's dossier — with a correct OFFICIAL badge, real provenance, a real
 * value, and the wrong country.
 *
 * Every defence in this project passes that. The value is real, the source is
 * right, the provenance is traceable, the tier is accurate, the badge is
 * honest. Only the country is wrong, and nothing in the fact model has an
 * opinion about which country a fact was fetched for.
 *
 * ## Identity matching, NOT recency (F6c)
 *
 * "Discard anything late" is a different rule and the wrong one. A user who
 * selects France, switches to Jamaica, and switches BACK to France should get
 * France's in-flight response — it is an answer to the question currently on
 * screen. The test is whether the response's identity matches the CURRENT
 * selection, not whether it arrived later than expected.
 *
 * Getting this wrong in the other direction is a real cost, not a hypothetical:
 * discarding on recency throws away good data and refetches it, which on a
 * rate-limited free tier is how a back-and-forth click costs a user their quota.
 *
 * ## Pure, so it is testable without a UI (F6b)
 *
 * The rule is a function of two identities. A browser-level test is necessary —
 * it proves the wiring — and is not sufficient, because it can only reach the
 * timings it can provoke.
 */

/**
 * What a request was issued for.
 *
 * `epoch` distinguishes two selections of the SAME country: select France,
 * switch away, switch back, and the first France request is still valid by
 * country. Keeping it is correct (F6c) — the epoch exists so a caller that needs
 * to tell the two apart can, without changing the default behaviour.
 */
export interface SelectionIdentity {
  /** ISO3, or whatever identifies the subject a panel is showing. */
  subject: string;
  epoch: number;
}

export type Disposition =
  | { render: true }
  | { render: false; why: 'subject-changed'; issuedFor: string; currentlyShowing: string }
  | { render: false; why: 'no-selection'; issuedFor: string };

/**
 * @param issued  identity the request was issued under
 * @param current identity on screen now; null when nothing is selected
 */
export function disposition(issued: SelectionIdentity, current: SelectionIdentity | null): Disposition {
  if (current === null) {
    return { render: false, why: 'no-selection', issuedFor: issued.subject };
  }

  /**
   * Subject only. The epoch is deliberately NOT compared.
   *
   * Comparing epochs would implement "discard anything issued before the
   * current selection began", which fails the return-to-selection case: the
   * response is a correct answer to the question on screen, and throwing it away
   * costs a refetch against a rate-limited origin for no gain in correctness.
   */
  if (issued.subject !== current.subject) {
    return {
      render: false,
      why: 'subject-changed',
      issuedFor: issued.subject,
      currentlyShowing: current.subject,
    };
  }

  return { render: true };
}

/**
 * Tracks the current selection and hands out identities.
 *
 * Deliberately tiny and separate from any DOM: the panel calls `current()` when
 * a response lands and passes both identities to `disposition`.
 */
export class SelectionTracker {
  #current: SelectionIdentity | null = null;
  #epoch = 0;

  select(subject: string): SelectionIdentity {
    this.#epoch += 1;
    this.#current = { subject, epoch: this.#epoch };
    return this.#current;
  }

  clear(): void {
    this.#epoch += 1;
    this.#current = null;
  }

  current(): SelectionIdentity | null {
    return this.#current;
  }

  /** True when a response issued under `issued` may be rendered now. */
  accepts(issued: SelectionIdentity): boolean {
    return disposition(issued, this.#current).render;
  }
}
