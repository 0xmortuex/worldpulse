/**
 * How does a key-gated source's key reach the request?
 *
 * ## Why this exists
 *
 * The prober could assign the verdict `KEY-GATED` but could never clear it: it
 * had no code to send a key at all. So a key-gated source stayed KEY-GATED after
 * the key was provisioned, and the verdict looked like a property of the source
 * when it was a property of the prober.
 *
 * Ember made that concrete. Its key was obtained, placed in `.env`, and the
 * source still probed KEY-GATED — because nothing read `.env` and nothing knew
 * where Ember wants the key.
 *
 * ## Measured, not assumed
 *
 * Ember's v1 API was asked directly which mechanism it accepts:
 *
 *   no auth                 403 {"detail":"No API key set"}
 *   ?api_key=               200 {stats, data}
 *   Authorization: Bearer   403 {"detail":"No API key set"}
 *   X-API-Key               403 {"detail":"No API key set"}
 *
 * A query parameter, and only a query parameter. Guessing between these is how a
 * plausible adapter that never worked gets written.
 *
 * ## Consequence for transport
 *
 * A key carried in a QUERY PARAMETER can never be sent from the browser: it
 * would be inlined into the bundle and served to every visitor. This is a
 * stronger reason for `transport: "worker"` than CORS, and it does not go away
 * if the source later sends permissive CORS headers.
 *
 * Pure, per rule 32: the caller passes the source record and the environment.
 */

/**
 * @param {Record<string, unknown>} source registry record
 * @param {Record<string, string | undefined>} env
 * @returns {{url: string, keyed: boolean, reason: string | null}}
 *   `url` carries the key when one could be applied. IT MUST NOT BE PERSISTED —
 *   see the caller, which records the unkeyed `probeUrl` in its output.
 */
export function keyedProbeUrl(source, env) {
  const url = String(source.probeUrl ?? '');
  const unkeyed = { url, keyed: false };

  if (!source.keyRequired) return { ...unkeyed, reason: null };

  const keyEnv = source.keyEnv == null ? '' : String(source.keyEnv).trim();
  if (keyEnv === '') {
    return {
      ...unkeyed,
      reason:
        'keyRequired but no keyEnv — no environment variable can satisfy it, so this can ' +
        'never be probed with a key',
    };
  }

  const value = env[keyEnv];
  if (value === undefined || value.trim() === '') {
    return { ...unkeyed, reason: `${keyEnv} is not set` };
  }

  /**
   * The mechanism must be DECLARED, never inferred.
   *
   * Defaulting to a query parameter would send the key to sources that want a
   * header, which fails as an ordinary 403 — indistinguishable from having no
   * key, and therefore the failure most likely to be misread as "still blocked
   * on provisioning".
   */
  const param = source.keyParam == null ? '' : String(source.keyParam).trim();
  if (param === '') {
    return {
      ...unkeyed,
      reason:
        `${keyEnv} is set, but the registry does not declare HOW this source takes its key. ` +
        'Add "keyParam" with the query parameter name once the mechanism has been measured',
    };
  }

  let built;
  try {
    built = new URL(url);
  } catch {
    return { ...unkeyed, reason: `probeUrl is not a valid URL: ${url}` };
  }
  built.searchParams.set(param, value);
  return { url: built.toString(), keyed: true, reason: null };
}

/**
 * Redact a key value wherever it appears in a string.
 *
 * The prober writes its results to a file that is committed. A keyed URL must
 * never reach it, and a source that echoes the key in an error body must not
 * either. Belt and braces: the caller records the unkeyed URL by construction,
 * and anything derived from a response passes through here.
 *
 * @param {string} text
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} keyEnvNames
 * @returns {string}
 */
export function redactKeys(text, env, keyEnvNames) {
  let out = String(text);
  for (const name of keyEnvNames) {
    const value = env[name];
    if (value === undefined || value.trim() === '') continue;
    out = out.split(value).join(`«${name}»`);
  }
  return out;
}
