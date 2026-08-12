#!/usr/bin/env node
/**
 * CORS + reachability probe for every source in data/sources.json.
 *
 * For each source it runs a CORS preflight (OPTIONS with Origin and
 * Access-Control-Request-Method) followed by a real GET carrying an Origin
 * header, records the Access-Control-* response headers from both, and derives
 * a routing verdict.
 *
 * The verdict answers one architectural question per source: can the browser
 * fetch this directly, or does it have to go through the edge Worker?
 *
 *   CLIENT-FETCH     ACAO permits our origin. No proxy needed.
 *   WORKER-REQUIRED  Reachable, but the browser cannot read the response:
 *                    no ACAO, or an ACAO naming a different origin, or a secret
 *                    key that must not ship to the client.
 *
 *                    NOT "the host wants a descriptive User-Agent". That was the
 *                    old rule and it had the situation backwards: a browser
 *                    cannot set the header but never needs to, because it sends
 *                    its own real UA, which is what those policies ask for. The
 *                    client that fails them is an anonymous script — which is
 *                    what this probe was until it started identifying itself.
 *   KEY-GATED        Needs a key before the question can even be asked. The
 *                    probe runs unauthenticated on purpose, to record the
 *                    failure mode the app must degrade to.
 *   INCONCLUSIVE     Upstream answered 4xx/5xx. Error responses routinely omit
 *                    Access-Control-* headers, so the absence of an ACAO here
 *                    says nothing about the success path. Never downgrade one
 *                    of these to WORKER-REQUIRED — re-probe instead.
 *   UNREACHABLE      Network or policy failure. Not a CORS verdict.
 *
 * Usage:  npm run probe            (all sources)
 *         npm run probe -- usgs-quakes worldbank    (subset by id)
 *
 * Writes data/probe-results.json and docs/CORS-VERDICT.md.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The origin the deployed static site will actually use. */
const ORIGIN = process.env.PROBE_ORIGIN ?? 'https://worldpulse.pages.dev';
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 20_000);
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 4);

/**
 * Identify the probe. Wikimedia's User-Agent policy rejects clients that do not,
 * and being an anonymous script hammering free public infrastructure is rude
 * regardless of whether anyone enforces it.
 *
 * This is also a correctness fix, not just manners. Node's fetch sends a default
 * UA that `query.wikidata.org` answers 403 to, which the probe then recorded as
 * that source's posture. Measured directly:
 *
 *   no UA            403   ACAO: *
 *   descriptive UA   200   ACAO: *
 *   browser-like UA  200   ACAO: *
 *
 * A browser always sends a real User-Agent, so the situation the probe was
 * reporting is one no browser is ever in.
 */
const PROBE_UA =
  process.env.PROBE_USER_AGENT ??
  'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) source-reachability-probe';

const VERDICT = {
  CLIENT: 'CLIENT-FETCH',
  WORKER: 'WORKER-REQUIRED',
  KEY: 'KEY-GATED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  UNREACHABLE: 'UNREACHABLE',
};

const CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-max-age',
  'access-control-expose-headers',
];

function pickCorsHeaders(headers) {
  const out = {};
  for (const name of CORS_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/**
 * Does the observed Access-Control-Allow-Origin let OUR origin read the body?
 * '*' works only when credentials are not in play, which is our case — we never
 * send cookies to these APIs.
 */
function originIsAllowed(acao) {
  if (!acao) return false;
  return acao === '*' || acao.toLowerCase() === ORIGIN.toLowerCase();
}

async function timedFetch(url, init) {
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    return { res, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { error: err, ms: Math.round(performance.now() - started) };
  }
}

/**
 * Read at most MAX_BODY_BYTES, then cancel.
 *
 * This used to be `res.arrayBuffer()`, which pulls the whole response. That was
 * harmless while every probe target was a small JSON reply and became wrong the
 * moment `ucdp-ged` was pointed at a 39MB bulk zip: a reachability probe that
 * downloads the dataset is a probe nobody will run often, and the rate rule now
 * says run it seldom and targeted. Headers — which is all the verdict is drawn
 * from — arrive before any of the body.
 */
const MAX_BODY_BYTES = 64 * 1024;

async function readCapped(res) {
  if (!res.body) return { bytes: 0, truncated: false };
  const reader = res.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes, truncated: false };
      bytes += value.byteLength;
      if (bytes >= MAX_BODY_BYTES) {
        await reader.cancel();
        return { bytes, truncated: true };
      }
    }
  } catch {
    return { bytes, truncated: false };
  }
}

async function probeOne(source) {
  const result = {
    id: source.id,
    name: source.name,
    panel: source.panel,
    url: source.probeUrl,
    keyRequired: Boolean(source.keyRequired),
    keyEnv: source.keyEnv ?? null,
    licenseClass: source.licenseClass,
    preflight: null,
    get: null,
    verdict: null,
    reason: null,
  };

  // 1. Preflight. A source that never sees a non-simple request does not need
  //    to answer this, so a failure here is informational, not disqualifying.
  const pre = await timedFetch(source.probeUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'User-Agent': PROBE_UA,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  result.preflight = pre.error
    ? { error: String(pre.error?.cause?.message ?? pre.error?.message ?? pre.error), ms: pre.ms }
    : { status: pre.res.status, ms: pre.ms, cors: pickCorsHeaders(pre.res.headers) };

  // 2. The real request, carrying Origin exactly as a browser would.
  const got = await timedFetch(source.probeUrl, {
    method: 'GET',
    headers: { Origin: ORIGIN, 'User-Agent': PROBE_UA },
  });

  if (got.error) {
    result.get = { error: String(got.error?.cause?.message ?? got.error?.message ?? got.error), ms: got.ms };
    result.verdict = VERDICT.UNREACHABLE;
    result.reason = result.get.error;
    return result;
  }

  const { res } = got;
  const cors = pickCorsHeaders(res.headers);
  const read = await readCapped(res);

  result.get = {
    status: res.status,
    ms: got.ms,
    contentType: res.headers.get('content-type'),
    bytes: read.bytes,
    truncated: read.truncated,
    contentLength: res.headers.get('content-length'),
    cors,
    cacheControl: res.headers.get('cache-control'),
  };

  const acao = cors['access-control-allow-origin'];
  const allowed = originIsAllowed(acao);

  // Ordering matters. A secret key beats a permissive ACAO: even if the browser
  // *could* read the response, we will not put the key in front of the user.
  const keyIsSecret = source.keyRequired && !(source.keyEnv ?? '').startsWith('VITE_');

  if (source.keyRequired) {
    result.verdict = VERDICT.KEY;
    result.reason = keyIsSecret
      ? `Key ${source.keyEnv} is server-side; routed through the Worker regardless of ACAO (observed: ${acao ?? 'none'}).`
      : `Public key ${source.keyEnv}; ACAO observed: ${acao ?? 'none'}.`;
  } else if (!res.ok) {
    /**
     * An error response tells us nothing about the success path, whatever
     * headers it happens to carry.
     *
     * This used to read `!res.ok && !allowed`, which guarded only the case
     * where the error ALSO lacked an ACAO — so an error carrying `*` fell
     * through to a conclusive verdict inferred from a failed request. That is
     * exactly the inference rule 3 was written to forbid, one condition away.
     *
     * It was not hypothetical. Across three runs `wikidata-sparql` scored
     * WORKER-REQUIRED twice off a 403 that happened to carry `*`, and
     * INCONCLUSIVE once off a 429 that did not: same source, same question,
     * verdict decided by a header on an error path. Its true posture, measured
     * directly, is a 200 with `ACAO: *`.
     *
     * A declared key requirement is checked before this and is unaffected: that
     * is a property of the source, not something inferred from the response.
     */
    result.verdict = VERDICT.INCONCLUSIVE;
    result.reason =
      `Upstream returned HTTP ${res.status}; an error response is not evidence about the ` +
      `success path (ACAO observed on it: ${acao ?? 'none'}). ` +
      'Re-probe with a request that succeeds.';
  } else if (source.requiresCustomUserAgent && !allowed) {
    /**
     * The flag means "this host rejects anonymous scripts", NOT "this host
     * needs a proxy", and it no longer decides the verdict on its own.
     *
     * It used to read `else if (source.requiresCustomUserAgent)` with the
     * reason "requires a descriptive User-Agent, which browsers are forbidden
     * to set" — which has the situation backwards. A browser cannot set the
     * header, but it does not need to: it sends its own real UA, and that is
     * exactly what these policies ask for. The client that fails such a policy
     * is an anonymous script, which is what this probe used to be.
     *
     * Measured: with a descriptive UA, query.wikidata.org answers 200 with
     * ACAO `*`, and api.openparliament.ca answers 200 with ACAO `*` with or
     * without one. Both were scored WORKER-REQUIRED on the old rule. If ACAO
     * does permit our origin, the browser can read it and no proxy is needed;
     * only a genuinely unreadable response should reach this branch now.
     */
    result.verdict = VERDICT.WORKER;
    result.reason =
      `Host requires an identifying User-Agent and its ACAO does not permit our origin ` +
      `(observed: ${acao ?? 'none'}).`;
  } else if (allowed) {
    result.verdict = VERDICT.CLIENT;
    result.reason = `ACAO: ${acao}`;
  } else if (acao) {
    result.verdict = VERDICT.WORKER;
    result.reason = `ACAO present but does not match our origin: ${acao}`;
  } else {
    result.verdict = VERDICT.WORKER;
    result.reason = 'No Access-Control-Allow-Origin on the response.';
  }

  return result;
}

/** Bounded-concurrency map, so we do not open 30 sockets at free public APIs. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
      process.stderr.write('.');
    }
  });
  await Promise.all(workers);
  process.stderr.write('\n');
  return results;
}

function markdownTable(results, refreshed) {
  const rows = results.map((r) => {
    const acao = r.get?.cors?.['access-control-allow-origin'] ?? '—';
    const status = r.get?.status ?? 'ERR';
    const ms = r.get?.ms ?? r.preflight?.ms ?? '—';
    // When did THIS row's verdict come from? A merged table without per-row
    // dating reads as though every row was measured together.
    const when = r.probedAt ? r.probedAt.replace('T', ' ').slice(0, 16) : 'unknown';
    const mark = refreshed.includes(r.id) ? '**this run**' : when;
    return `| \`${r.id}\` | ${r.panel} | ${status} | \`${acao}\` | **${r.verdict}** | ${ms}ms | ${mark} |`;
  });
  return [
    '| Source | Panel | HTTP | Access-Control-Allow-Origin | Verdict | Latency | Probed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function summarise(results) {
  const counts = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  return counts;
}

async function main() {
  if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1') {
    console.error(
      "warning: HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not. Node's fetch will ignore the proxy.\n" +
        '         Run via `npm run probe`, which sets it.\n',
    );
  }

  const registry = JSON.parse(await readFile(resolve(ROOT, 'data/sources.json'), 'utf8'));
  const filter = process.argv.slice(2);

  const targets = registry.sources.filter(
    (s) => s.probeUrl && !s.excluded && (filter.length === 0 || filter.includes(s.id)),
  );
  const skipped = registry.sources.filter((s) => !s.probeUrl || s.excluded);

  console.error(`probing ${targets.length} sources as Origin: ${ORIGIN}`);
  const fresh = await mapLimit(targets, CONCURRENCY, probeOne);
  const stamp = new Date().toISOString();
  for (const result of fresh) result.probedAt = stamp;

  /**
   * A subset run MERGES into the previous results; it does not replace them.
   *
   * This file used to be rewritten with only whatever was probed, so
   * `npm run probe -- wikidata-sparql` silently discarded the other verdicts and
   * the published table shrank to one row. That is unusable under the rule this
   * project now works to — no more than one full probe per host per hour, and a
   * 429-driven INCONCLUSIVE re-run individually after a quiet interval — because
   * that rule requires targeted re-probes and this tool could not do one without
   * throwing the rest away.
   *
   * Every row therefore carries its own `probedAt`. A merged table where one row
   * is fresh and twenty-six are from this morning is honest only if each row
   * says which it is.
   */
  const previous = await readFile(resolve(ROOT, 'data/probe-results.json'), 'utf8')
    .then((raw) => JSON.parse(raw).results ?? [])
    .catch(() => []);

  const merged = new Map(previous.map((result) => [result.id, result]));
  for (const result of fresh) merged.set(result.id, result);
  const results = registry.sources
    .map((source) => merged.get(source.id))
    .filter((result) => result !== undefined);

  const refreshed = fresh.map((result) => result.id);
  const carried = results.filter((result) => !refreshed.includes(result.id));
  if (carried.length > 0) {
    console.error(
      `refreshed ${refreshed.length}, carried forward ${carried.length} from earlier runs`,
    );
  }

  const counts = summarise(results);

  await mkdir(resolve(ROOT, 'docs'), { recursive: true });
  await writeFile(
    resolve(ROOT, 'data/probe-results.json'),
    JSON.stringify(
      { probedAt: stamp, origin: ORIGIN, refreshedThisRun: refreshed, counts, results },
      null,
      2,
    ) + '\n',
  );

  const doc = `# CORS and reachability verdicts

Generated by \`npm run probe\` at ${stamp}
Probed as \`Origin: ${ORIGIN}\`

Verdicts: **CLIENT-FETCH** the browser can read it directly · **WORKER-REQUIRED** it
must go through the edge proxy · **KEY-GATED** needs a key first · **UNREACHABLE**
network or policy failure.

Summary: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}

${markdownTable(results, refreshed)}

## Reasoning per source

${results.map((r) => `- \`${r.id}\` — **${r.verdict}**. ${r.reason}`).join('\n')}

## Not probed

${skipped.map((s) => `- \`${s.id}\` — ${s.excluded ? 'excluded' : 'no runtime fetch'}. ${s.notes ?? s.probeNote ?? ''}`).join('\n')}
`;

  await writeFile(resolve(ROOT, 'docs/CORS-VERDICT.md'), doc);

  console.log(markdownTable(results, refreshed));
  console.log('\n' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  '));
  console.log('\nwrote data/probe-results.json and docs/CORS-VERDICT.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
