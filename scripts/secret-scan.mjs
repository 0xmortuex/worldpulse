/**
 * Does a secret appear anywhere it will be recorded?
 *
 * ## A secret has three lifecycles, and each has now almost leaked
 *
 *   SENT      the request carries it            — guarded: the builder emits no key,
 *                                                 and the capture refuses if it does
 *   RECEIVED  the response echoes it back       — guarded: redactKeys over anything
 *                                                 derived from a response body
 *   RECORDED  it is written into provenance,    — GUARDED HERE. Nothing covered this.
 *             rendered, or committed to disk
 *
 * The third one is the reason this file exists. `loadSample` recorded the KEYED
 * url in `ctx.requestUrl`, which flows into `FetchProvenance` and is rendered by
 * the inspector — the subsystem whose entire job is showing where a number came
 * from would have shown the key. Both existing guards passed throughout, because
 * both watched the wire and neither watched the ledger.
 *
 * Pure, per rule 32: the caller supplies the values to look for.
 */

/**
 * Walk any JSON-ish structure and report every place a secret value appears.
 *
 * Values are compared by containment rather than equality, because the leak this
 * was written for was a key EMBEDDED in a URL string, not a key stored on its
 * own.
 *
 * @param {unknown} value the structure to scan — a Fact, a Provenance, a ctx, a parsed file
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} keyEnvNames which environment variables hold secrets
 * @returns {string[]} one problem per appearance, empty when clean
 */
export function secretsIn(value, env, keyEnvNames) {
  /** Only non-empty values are secrets. An unset variable must not match everything. */
  const secrets = [];
  for (const name of keyEnvNames) {
    const held = env[name];
    if (typeof held === 'string' && held.trim() !== '') secrets.push([name, held]);
  }
  if (secrets.length === 0) return [];

  const problems = [];
  const seen = new Set();

  const walk = (node, path) => {
    if (node === null || node === undefined) return;

    if (typeof node === 'string') {
      for (const [name, held] of secrets) {
        if (node.includes(held)) {
          problems.push(
            `${path} contains the value of ${name} — a secret reached a recorded field. ` +
              'Record the unkeyed form and apply the key only for the duration of the request',
          );
        }
      }
      return;
    }

    if (typeof node !== 'object') return;

    // Guard against cycles: provenance trees are finite but callers may pass
    // anything, and a scan that hangs is a scan that gets removed.
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      // The KEY of a property can be a secret too, though it is far less likely
      // than a value. Checked because the cost is one comparison.
      for (const [name, held] of secrets) {
        if (key.includes(held)) problems.push(`${path}.${key} — a property NAME contains ${name}`);
      }
      walk(child, `${path}.${key}`);
    }
  };

  walk(value, 'root');
  return problems;
}

/**
 * The environment variables this repository treats as secrets.
 *
 * Derived from the registry rather than listed here, so a source added tomorrow
 * is covered without anyone remembering to extend a list. `VITE_`-prefixed
 * variables ARE included: they are public by design, but a public key appearing
 * in provenance is still noise the inspector should not carry, and excluding
 * them would make the scan's coverage depend on a naming convention.
 *
 * @param {{sources: Array<Record<string, unknown>>}} registry
 * @returns {string[]}
 */
export function secretEnvNames(registry) {
  const names = new Set();
  for (const source of registry.sources) {
    const keyEnv = source.keyEnv;
    if (typeof keyEnv === 'string' && keyEnv.trim() !== '') names.add(keyEnv.trim());
  }
  return [...names];
}
