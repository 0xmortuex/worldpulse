/**
 * Guard logic, extracted from the suites that use it so each guard can be run
 * against a PLANTED VIOLATION as well as against the real codebase.
 *
 * TESTING.md rule 27: a scanner without a permanent planted case is unverified,
 * and its green output means nothing. This file exists because that was not true
 * of the guards added alongside it — every one had been checked by hand, once,
 * and nothing would have noticed if it stopped working.
 *
 * The rule was earned expensively: the parameter-parity guard PASSED a planted
 * removal of `origin=*` because its URL scanner stopped at the first closing
 * quote and never saw the concatenated second fragment. A guard written against
 * vacuous passes was passing vacuously.
 */

/**
 * Extract http(s) URLs from source text.
 *
 * Adjacent string-literal concatenations are joined first. Without that, a URL
 * assembled as `'https://host/p?a=1' + '&b=2'` yields only `a`, which is exactly
 * the blind spot that let a planted violation through.
 */
export function urlsInSource(text: string): string[] {
  // Order matters. Template placeholders are neutralised FIRST, because
  // `${encodeURIComponent(x)}` contains a `)` and the URL character class stops
  // at one — so a templated URL was truncated at its first interpolation. That
  // was a second blind spot in this scanner, found by the planted case in
  // guards.test.ts rather than by reading the regex.
  const neutralised = text.replace(/\$\{[^}]*\}/g, 'X');
  const joined = neutralised.replace(/['"`]\s*\+\s*['"`]/g, '');
  return [...joined.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((match) => match[0]);
}

/** Parameter names on a URL, with template placeholders neutralised. */
export function paramsOf(rawUrl: string): Set<string> {
  const cleaned = rawUrl.replace(/\$\{[^}]*\}/g, 'X');
  try {
    return new Set(new URL(cleaned).searchParams.keys());
  } catch {
    return new Set();
  }
}

/** Parameters the app sends that the fixture does not. Empty means parity. */
export function missingAppParams(fixtureUrl: string, appParams: ReadonlySet<string>): string[] {
  const fixtureParams = paramsOf(fixtureUrl);
  return [...appParams].filter((param) => !fixtureParams.has(param));
}

/**
 * `*Label` bindings in a SPARQL body whose request never invoked the label
 * service. Non-empty means the recorded request could not have produced the
 * recorded response.
 */
export function labelBindingsWithoutService(body: unknown, requestUrl: string): string[] {
  const bindings = (body as { results?: { bindings?: Array<Record<string, unknown>> } })?.results
    ?.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) return [];

  const labelVars = [...new Set(bindings.flatMap((row) => Object.keys(row)))].filter((key) =>
    key.endsWith('Label'),
  );
  if (labelVars.length === 0) return [];
  if (/SERVICE\s+wikibase:label/i.test(decodeURIComponent(requestUrl))) return [];
  return labelVars;
}

/** Hosts appearing in source that no registry entry and no exemption accounts for. */
export function unaccountedHosts(
  hosts: readonly string[],
  registryHosts: ReadonlySet<string>,
  exempt: ReadonlySet<string>,
): string[] {
  return [...new Set(hosts)].filter((host) => !registryHosts.has(host) && !exempt.has(host));
}
