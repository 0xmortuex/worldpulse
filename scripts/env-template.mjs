/**
 * Does `.env.example` still describe the registry?
 *
 * ## Why this exists
 *
 * `.env` did not exist on this machine until 2026-08-15 — only `.env.example`.
 * Every "KEY-GATED" probe verdict recorded before that date was measuring a
 * missing FILE, not a missing key, and nothing said so. The template had also
 * drifted: `EMBER_API_KEY` was in the registry and absent from the template, so
 * the one document a person copies to provision keys did not mention the key
 * they were blocked on.
 *
 * That is the failure this guard exists to prevent: a provisioned key sitting
 * useless because the template that would have named it lagged the registry.
 *
 * ## The second rule, and why it is not the obvious one
 *
 * A source with `keyRequired: true` and **no `keyEnv`** cannot be satisfied by
 * any environment file at all — there is no variable name to fill. The
 * template check alone would skip it, having no name to look for, so the source
 * would stay permanently blocked while every check reported clean.
 *
 * `acled` is in exactly that state today and is correctly parked (`excluded`),
 * so it is not a defect. It becomes one the moment someone un-excludes it,
 * which is when this fires.
 *
 * Pure, per rule 32: the caller reads the registry and the template and passes
 * both in.
 */

/**
 * @param {{sources: Array<Record<string, unknown>>}} registry
 * @param {ReadonlySet<string>} templateNames variable names present in .env.example
 * @returns {string[]} one problem per contradiction, empty when consistent
 */
export function envTemplateProblems(registry, templateNames) {
  const problems = [];

  for (const source of registry.sources) {
    // Excluded sources are parked records, not live configuration. They are
    // still checked for the unsatisfiable case below — see that comment.
    const excluded = Boolean(source.excluded);
    const id = String(source.id);
    const keyEnv = source.keyEnv == null ? null : String(source.keyEnv).trim();
    const keyRequired = Boolean(source.keyRequired);

    /**
     * UNSATISFIABLE BY CONSTRUCTION: needs a key, names no variable.
     *
     * Skipped while excluded, because a parked record is not claiming to work.
     * Fails closed the moment it is un-excluded, which is the only moment the
     * contradiction can start costing anything.
     */
    if (keyRequired && (keyEnv === null || keyEnv === '')) {
      if (!excluded) {
        problems.push(
          `${id}: keyRequired is true but keyEnv is ${JSON.stringify(source.keyEnv)} — ` +
            'no environment variable can satisfy it, so the source is permanently blocked ' +
            'while every other check reports clean. Give it the variable name it reads, ' +
            'or set keyRequired to false',
        );
      }
      continue;
    }

    if (keyEnv === null || keyEnv === '') continue;
    if (excluded) continue;

    if (!templateNames.has(keyEnv)) {
      problems.push(
        `${id}: registry declares keyEnv "${keyEnv}" but .env.example does not mention it — ` +
          'the template a person copies to provision keys does not name the key they need. ' +
          `Add a commented "${keyEnv}=" line`,
      );
    }
  }

  return problems;
}

/**
 * Variable names in a dotenv-style file. Names only — this never returns, logs
 * or retains a value, because the only question asked of a template is which
 * names it declares.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function templateNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== '') names.add(name);
  }
  return names;
}
