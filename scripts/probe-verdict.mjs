/**
 * Decide a source's CORS posture from one observed response.
 *
 * ## Why this is a module (rule 32)
 *
 * This ladder used to live inside `probeSource`, between two `await timedFetch`
 * calls, in a module that exported nothing. There was no way to ask "what
 * verdict does a 403 carrying `ACAO: *` produce" without making a live request
 * to a real host and waiting out a rate limit.
 *
 * It has the worst defect record in the repository — three separate bugs, every
 * one found by re-probing and noticing an inconsistent answer, every one
 * reproducible from a status code and a header map:
 *
 *   1. `!res.ok && !allowed` let an error response carrying `*` reach a
 *      conclusive verdict. `wikidata-sparql` scored WORKER-REQUIRED twice off a
 *      403 that happened to carry `*` and INCONCLUSIVE once off a 429 that did
 *      not — same source, same question, verdict decided by a header on a failed
 *      request.
 *   2. `requiresCustomUserAgent` decided the verdict on its own, on a premise
 *      that was backwards: a browser cannot set that header and does not need
 *      to, because it sends its own real one.
 *   3. The probe sent no User-Agent at all, so it measured a client the app is
 *      not (rule 20). That one is about the request, not this ladder, and is
 *      fixed at the call site.
 *
 * All three are now planted cases in `tests/probe-verdict.test.ts`, which turns
 * three anecdotes in comments into three permanent regression tests.
 *
 * ## Why this matters beyond tidiness
 *
 * `CORS-VERDICT.md` is the fetch layer's routing input: it decides which sources
 * the browser may call directly and which must go through the Worker. A
 * misclassification here ships as a broken panel or an unnecessary proxy hop, so
 * the fetch layer cannot be built on a table produced by untested logic.
 */

export const VERDICT = {
  CLIENT: 'CLIENT-FETCH',
  WORKER: 'WORKER-REQUIRED',
  KEY: 'KEY-GATED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  UNREACHABLE: 'UNREACHABLE',
  /**
   * The measuring network could not reach the host at all, so this run produced
   * no evidence about the source.
   *
   * `UNREACHABLE` conflates two different facts: *the host is down* and *we
   * could not get to it*. The first is about the source, the second about us,
   * and rule 30 says those are different answers. `riksdagen` resets at the TCP
   * layer from one network and answers 200 from another; `smartraveller` times
   * out from both. They are indistinguishable from a single failed request.
   *
   * **This verdict is never inferred.** The probe cannot tell the two apart, so
   * it keeps recording `UNREACHABLE` and a human records this instead, with the
   * evidence, when they have grounds. Inferring it would convert a genuinely
   * dead source into one that reports its last good verdict forever — failing
   * toward optimism, which is the direction every false report in this project
   * has failed toward.
   */
  UNMEASURABLE: 'UNMEASURABLE',
};

/**
 * Verdicts that decide a transport. Everything else says nothing about the
 * success path (rule 3), and a carry-forward annotation survives them.
 */
export const CONCLUSIVE = new Set([VERDICT.CLIENT, VERDICT.WORKER, VERDICT.KEY]);

/**
 * Does the observed Access-Control-Allow-Origin let OUR origin read the body?
 *
 * `*` works only when credentials are not in play, which is our case — we never
 * send cookies to these APIs.
 */
export function originIsAllowed(acao, origin) {
  if (!acao) return false;
  return acao === '*' || acao.toLowerCase() === origin.toLowerCase();
}

/**
 * @typedef {object} Observation
 * @property {number} status              HTTP status observed
 * @property {boolean} ok                 status in 200-299
 * @property {Record<string,string>} cors  observed CORS response headers
 * @property {string} origin              the origin we probed as
 * @property {{keyRequired?: boolean, keyEnv?: string|null, requiresCustomUserAgent?: boolean}} source
 */

/**
 * @param {Observation} observation
 * @returns {{verdict: string, reason: string}}
 */
export function verdictForResponse({ status, ok, cors, origin, source }) {
  const acao = cors['access-control-allow-origin'];
  const allowed = originIsAllowed(acao, origin);
  const observed = acao ?? 'none';

  // Ordering matters. A secret key beats a permissive ACAO: even if the browser
  // *could* read the response, we will not put the key in front of the user.
  if (source.keyRequired) {
    const keyIsSecret = !(source.keyEnv ?? '').startsWith('VITE_');
    return {
      verdict: VERDICT.KEY,
      reason: keyIsSecret
        ? `Key ${source.keyEnv} is server-side; routed through the Worker regardless of ACAO (observed: ${observed}).`
        : `Public key ${source.keyEnv}; ACAO observed: ${observed}.`,
    };
  }

  /**
   * An error response tells us nothing about the success path, whatever headers
   * it happens to carry.
   *
   * This is defect 1 above. The condition is `!ok` alone — deliberately NOT
   * `!ok && !allowed`, which guarded only the case where the error also lacked
   * an ACAO, and let an error carrying `*` fall through to a conclusive verdict
   * inferred from a failed request. That is the inference rule 3 forbids, one
   * condition away.
   *
   * A declared key requirement is checked before this and is unaffected: that is
   * a property of the source, not something inferred from a response.
   */
  if (!ok) {
    return {
      verdict: VERDICT.INCONCLUSIVE,
      reason:
        `Upstream returned HTTP ${status}; an error response is not evidence about the ` +
        `success path (ACAO observed on it: ${observed}). ` +
        'Re-probe with a request that succeeds.',
    };
  }

  /**
   * Defect 2. The flag means "this host rejects anonymous scripts", NOT "this
   * host needs a proxy", so it no longer decides the verdict on its own — it
   * only matters when the response is ALSO unreadable.
   *
   * Measured: with a descriptive UA, query.wikidata.org answers 200 with ACAO
   * `*`, and api.openparliament.ca answers 200 with ACAO `*` with or without
   * one. Both were scored WORKER-REQUIRED under the old rule.
   */
  if (source.requiresCustomUserAgent && !allowed) {
    return {
      verdict: VERDICT.WORKER,
      reason: `Host requires an identifying User-Agent and its ACAO does not permit our origin (observed: ${observed}).`,
    };
  }

  if (allowed) return { verdict: VERDICT.CLIENT, reason: `ACAO: ${acao}` };
  if (acao) return { verdict: VERDICT.WORKER, reason: `ACAO present but does not match our origin: ${acao}` };
  return { verdict: VERDICT.WORKER, reason: 'No Access-Control-Allow-Origin on the response.' };
}
