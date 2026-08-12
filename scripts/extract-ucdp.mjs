#!/usr/bin/env node
/**
 * Build-time extraction of UCDP GED into per-country static slices.
 *
 * Why a build step rather than a runtime fetch or a bundled blob:
 *
 * - The UCDP REST API now requires a token on every endpoint, and this project
 *   runs with zero keys (decision 5). The bulk downloads are keyless.
 * - The bulk zip is 39MB compressed, 274MB expanded. That is not a per-visitor
 *   fetch and not a repository artifact.
 * - GED is released annually. A version-pinned preprocess gives a keyless
 *   source, no runtime dependency on UCDP being reachable, and a payload a
 *   browser can actually load.
 *
 * The pin is enforced, not documented: the SHA-256 below is checked against the
 * bytes actually downloaded and the build fails on a mismatch. A silent upstream
 * revision under the same filename is exactly the "the app starts lying" failure
 * this project is built to prevent, and it would otherwise be invisible.
 *
 * Usage:
 *   node scripts/extract-ucdp.mjs --dry-run   report the accounting, write nothing
 *   node scripts/extract-ucdp.mjs             extract and write slices
 *
 * The download is cached in .cache/ (gitignored). Delete it to re-fetch.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The pin. Version, URL, and the checksum of the exact bytes this extraction was
 * written against.
 *
 * `sha256` was recorded by downloading the file and hashing it. To move to a new
 * GED release: change `version` and `url`, run with UCDP_ACCEPT_NEW_CHECKSUM=1
 * once to learn the new digest, record it here, and re-run without the flag. The
 * two-step exists so that accepting new upstream bytes is a deliberate edit to
 * this file rather than something a build can do on its own.
 */
const PIN = {
  version: '26.1',
  url: 'https://ucdp.uu.se/downloads/ged/ged261-csv.zip',
  sha256: '8c941d84954e555ee2e54f40fa04d9203bf1e2f962203d0a9930966c4947c667',
  member: 'GEDEvent_v26_1.csv',
  bytes: 39122522,
  license: 'CC BY 4.0',
  citation:
    'Uppsala Conflict Data Program (UCDP), Georeferenced Event Dataset (GED) Global version 26.1.',
};

/**
 * Columns this extraction reads. Asserted against the real header before any row
 * is parsed: UCDP has renamed and reordered columns across releases, and reading
 * by position against a changed header would silently mis-assign every field.
 */
const REQUIRED_COLUMNS = [
  'id', 'year', 'type_of_violence', 'conflict_name', 'dyad_name', 'side_a', 'side_b',
  'latitude', 'longitude', 'country', 'region', 'where_prec', 'date_prec', 'event_clarity',
  'date_start', 'date_end', 'best', 'high', 'low', 'code_status',
];

/** Emitted per event. Everything else in the 49-column row is dropped on purpose. */
function slimEvent(row, col) {
  return {
    id: Number(row[col.id]),
    date: row[col.date_start].slice(0, 10),
    dateEnd: row[col.date_end].slice(0, 10),
    lat: Number(row[col.latitude]),
    lng: Number(row[col.longitude]),
    conflict: row[col.conflict_name],
    dyad: row[col.dyad_name],
    sideA: row[col.side_a],
    sideB: row[col.side_b],
    // UCDP's own best/high/low fatality estimate. Kept as a triple rather than
    // flattened to `best`: a range is what the source published, and collapsing
    // it here would make a point estimate look like a measurement.
    deaths: { best: Number(row[col.best]), high: Number(row[col.high]), low: Number(row[col.low]) },
    typeOfViolence: Number(row[col.type_of_violence]),
    // Precision codes travel with the event. where_prec 1 is an exact location;
    // 7 is "somewhere in this country". Rendering a 7 as a pin would be a
    // confident falsehood, so the renderer needs to see it.
    wherePrec: Number(row[col.where_prec]),
    datePrec: Number(row[col.date_prec]),
    clarity: Number(row[col.event_clarity]),
  };
}

/**
 * Streaming RFC 4180 parser, character by character over the whole stream.
 *
 * It has to be character-level rather than line-level because **GED quotes
 * fields that contain newlines** — `source_article`, `where_description` and
 * `source_headline` all carry them. A readline-based reader splits those
 * records mid-field, and the fragments then fail a column-count check.
 *
 * That is not hypothetical: the first version of this script did exactly that
 * and discarded **102,409 of 487,358 rows — 21% — as "malformed"**. The data was
 * fine; the parser was wrong. The only reason it was caught before the slices
 * shipped is that this script is required to account for every row it drops.
 * A filter that silently loses a fifth of a conflict dataset would have made
 * every country's history quietly incomplete, with no symptom anywhere.
 */
function makeCsvParser(onRecord) {
  let field = '';
  let record = [];
  let inQuotes = false;
  /**
   * Saw `"` while inside a quoted field, and do not yet know whether it closes
   * the field or is the first half of an escaped `""`.
   *
   * This is a state rather than a lookahead because **the deciding character can
   * be in the next chunk**. The previous version peeked `chunk[i + 1]`, which is
   * `undefined` at a chunk boundary, so an escaped quote split across a read
   * boundary was misread as a closing quote — the field then absorbed the rest
   * of the record and commas inside it became field separators.
   *
   * It cost 14 records out of 417,968, which is 0.003% and would have rounded to
   * "100.00% kept" in the report. It was found by cross-checking the record count
   * against an independent CSV reader, not by reading the code. Any parser whose
   * correctness is asserted by its own accounting needs one of those.
   */
  let pendingQuote = false;

  return {
    push(chunk) {
      for (let i = 0; i < chunk.length; i += 1) {
        const ch = chunk[i];

        if (pendingQuote) {
          pendingQuote = false;
          if (ch === '"') { field += '"'; continue; }
          inQuotes = false;
          // Fall through: this character is outside the quotes.
        } else if (inQuotes) {
          if (ch === '"') { pendingQuote = true; continue; }
          field += ch;
          continue;
        }

        if (ch === '"' && field === '') { inQuotes = true; continue; }
        if (ch === ',') { record.push(field); field = ''; }
        else if (ch === '\n') { record.push(field); onRecord(record); record = []; field = ''; }
        else if (ch !== '\r') field += ch;
      }
    },
    end() {
      // A file ending in a newline has already flushed its last record; emitting
      // one here would invent a row of empty fields.
      if (field !== '' || record.length > 0) { record.push(field); onRecord(record); }
    },
  };
}

const exec = promisify(execFile);

async function ensureDownload() {
  const cacheDir = join(ROOT, '.cache');
  await mkdir(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, `ged-${PIN.version}.zip`);

  const cached = await stat(zipPath).catch(() => null);
  if (!cached) {
    process.stderr.write(`downloading ${PIN.url} …\n`);
    const res = await fetch(PIN.url, {
      headers: { 'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) build-extract' },
    });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(zipPath, buffer);
  }

  const digest = createHash('sha256').update(await readFile(zipPath)).digest('hex');
  if (digest !== PIN.sha256) {
    if (process.env.UCDP_ACCEPT_NEW_CHECKSUM === '1') {
      process.stderr.write(`\nobserved sha256: ${digest}\nrecord it in PIN.sha256 and re-run.\n`);
      process.exit(2);
    }
    throw new Error(
      `UCDP checksum mismatch for ${PIN.url}\n` +
        `  expected ${PIN.sha256}\n  observed ${digest}\n` +
        'Upstream bytes changed under the same filename. This is a finding, not a build\n' +
        'hiccup: re-read the release notes, confirm what changed, then update PIN.',
    );
  }
  return zipPath;
}

async function main() {
  const zipPath = await ensureDownload();
  const outDir = join(ROOT, 'data/ucdp');

  // Stream the member out of the zip rather than expanding 274MB to disk.
  const child = execFileStream('unzip', ['-p', zipPath, PIN.member]);

  /** Every row is counted into exactly one bucket. The buckets must sum to `read`. */
  const tally = {
    read: 0,
    kept: 0,
    dropped: {
      'no coordinates': 0,
      'coordinates out of range': 0,
      'unparseable id or date': 0,
      'country not resolvable to a slice': 0,
      'malformed row (wrong column count)': 0,
    },
  };

  const byCountry = new Map();
  let col = null;
  let header = null;

  const parser = makeCsvParser((row) => {
    if (header === null) {
      header = row;
      col = Object.fromEntries(header.map((name, index) => [name, index]));
      const missing = REQUIRED_COLUMNS.filter((name) => !(name in col));
      if (missing.length > 0) {
        throw new Error(
          `UCDP CSV header does not carry the columns this extraction reads: ${missing.join(', ')}.\n` +
            'Reading by position against a changed header would mis-assign every field.',
        );
      }
      return;
    }

    tally.read += 1;
    if (row.length !== header.length) { tally.dropped['malformed row (wrong column count)'] += 1; return; }

    const lat = Number(row[col.latitude]);
    const lng = Number(row[col.longitude]);
    if (row[col.latitude] === '' || row[col.longitude] === '' || Number.isNaN(lat) || Number.isNaN(lng)) {
      tally.dropped['no coordinates'] += 1;
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      tally.dropped['coordinates out of range'] += 1;
      return;
    }
    const id = Number(row[col.id]);
    if (!Number.isFinite(id) || !row[col.date_start]) { tally.dropped['unparseable id or date'] += 1; return; }

    const country = row[col.country];
    if (!country) { tally.dropped['country not resolvable to a slice'] += 1; return; }

    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(slimEvent(row, col));
    tally.kept += 1;
  });

  child.stdout.setEncoding('utf8');
  for await (const chunk of child.stdout) parser.push(chunk);
  parser.end();

  const accounted = tally.kept + Object.values(tally.dropped).reduce((a, b) => a + b, 0);
  if (accounted !== tally.read) {
    throw new Error(`accounting does not balance: read ${tally.read}, accounted ${accounted}`);
  }

  report(tally, byCountry);

  if (DRY_RUN) {
    process.stderr.write('\ndry run — nothing written\n');
    return;
  }

  await mkdir(outDir, { recursive: true });
  const index = [];
  for (const [country, events] of [...byCountry].sort()) {
    events.sort((a, b) => a.date.localeCompare(b.date));
    const slug = country.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const payload = {
      $comment: `Extracted from UCDP GED ${PIN.version} by scripts/extract-ucdp.mjs. Do not edit by hand.`,
      source: 'ucdp-ged',
      version: PIN.version,
      license: PIN.license,
      citation: PIN.citation,
      country,
      events,
    };
    const file = `${slug}.json`;
    await writeFile(join(outDir, file), JSON.stringify(payload) + '\n');
    index.push({ country, file, events: events.length, from: events[0].date, to: events[events.length - 1].date });
  }

  await writeFile(
    join(outDir, 'index.json'),
    JSON.stringify(
      {
        $comment: 'Generated by scripts/extract-ucdp.mjs. Do not edit by hand.',
        source: 'ucdp-ged',
        version: PIN.version,
        sha256: PIN.sha256,
        license: PIN.license,
        citation: PIN.citation,
        extraction: tally,
        countries: index,
      },
      null,
      2,
    ) + '\n',
  );
  process.stderr.write(`\nwrote ${index.length} country slices and index.json to data/ucdp/\n`);
}

function report(tally, byCountry) {
  const droppedTotal = Object.values(tally.dropped).reduce((a, b) => a + b, 0);
  const lines = [
    '',
    'UCDP GED extraction',
    `  version        ${PIN.version} (sha256 verified)`,
    `  read           ${tally.read.toLocaleString()} rows`,
    `  kept           ${tally.kept.toLocaleString()} (${((tally.kept / tally.read) * 100).toFixed(2)}%)`,
    `  dropped        ${droppedTotal.toLocaleString()} (${((droppedTotal / tally.read) * 100).toFixed(2)}%)`,
  ];
  for (const [reason, count] of Object.entries(tally.dropped)) {
    lines.push(`    ${reason.padEnd(38)} ${count.toLocaleString()}`);
  }
  lines.push(`  countries      ${byCountry.size}`);
  // Payload size is part of the accounting. A slice small enough to be correct
  // and too large to load is still a slice nobody can use.
  const sizes = [...byCountry]
    .map(([country, events]) => [country, events.length, JSON.stringify(events).length])
    .sort((a, b) => b[2] - a[2]);
  const totalBytes = sizes.reduce((sum, [, , bytes]) => sum + bytes, 0);
  lines.push(`  total payload  ${(totalBytes / 1e6).toFixed(1)} MB of JSON across ${byCountry.size} files`);
  lines.push('  largest slices:');
  for (const [country, count, bytes] of sizes.slice(0, 6)) {
    lines.push(
      `    ${country.padEnd(30)} ${String(count.toLocaleString()).padStart(8)} events  ${(bytes / 1e6).toFixed(1)} MB`,
    );
  }
  process.stderr.write(lines.join('\n') + '\n');
}

/** execFile with a live stdout stream, since the CSV is 274MB. */
function execFileStream(command, args) {
  const child = execFile(command, args, { maxBuffer: Infinity });
  child.on('error', (error) => {
    process.stderr.write(`failed to run ${command}: ${error.message}\n`);
    process.exit(1);
  });
  return child;
}

void exec;
void Readable;
void createReadStream;

await main();
