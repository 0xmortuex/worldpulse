/**
 * Capture a small, honest iptv-org fixture.
 *
 * channels.json is 9.8 MB and streams.json is 3.3 MB. Committing those would
 * make the suite slow and the diff unreadable, so the fixture is a SUBSET — and
 * a subset is a place where hard cases quietly vanish.
 *
 * So the subset is chosen by case, not by convenience. It keeps, for each
 * country included:
 *
 *   - channels with a working stream reference
 *   - channels the index lists with NO stream        (known, not watchable)
 *   - channels on the blocklist                       (must be excluded)
 *   - channels flagged is_nsfw                        (excluded by a second flag)
 *   - a closed channel where one exists               (shut down, not dead)
 *
 * If a case is not present for a country, the script SAYS SO rather than
 * quietly producing a fixture that cannot exercise it.
 *
 *   npx tsx scripts/capture-iptv.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = 'https://iptv-org.github.io/api';
const HEADERS = { 'User-Agent': 'worldpulse/0.0 (https://github.com/0xmortuex/worldpulse) fixture-capture' };

// UK is deliberate: iptv-org uses UK where ISO says GB, and the fixture must
// exercise the override. IS is a small country that keeps the fixture small.
const COUNTRIES = ['UK', 'IS'];

async function get(name) {
  const res = await fetch(`${API}/${name}.json`, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const [channels, streams, blocklist] = await Promise.all([
  get('channels'),
  get('streams'),
  get('blocklist'),
]);

const blockedIds = new Set(blocklist.map((entry) => entry.channel));
const streamed = new Set(streams.map((stream) => stream.channel).filter(Boolean));

const keptChannels = [];
const report = [];

for (const country of COUNTRIES) {
  const mine = channels.filter((channel) => channel.country === country);

  const withStream = mine.filter((c) => streamed.has(c.id) && !blockedIds.has(c.id) && !c.is_nsfw);
  const noStream = mine.filter((c) => !streamed.has(c.id) && !blockedIds.has(c.id) && !c.is_nsfw);
  const blocked = mine.filter((c) => blockedIds.has(c.id));
  const nsfwFlagged = mine.filter((c) => c.is_nsfw && !blockedIds.has(c.id));
  const closed = mine.filter((c) => c.closed && !blockedIds.has(c.id) && !c.is_nsfw);

  const take = (list, n) => list.slice(0, n);
  const chosen = [
    ...take(withStream, 6),
    ...take(noStream, 3),
    ...take(blocked, 2),
    ...take(nsfwFlagged, 1),
    ...take(closed, 1),
  ];

  // Deduplicate: a closed channel may also be one of the streamed ones.
  const seen = new Set();
  for (const channel of chosen) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);
    keptChannels.push(channel);
  }

  report.push({
    country,
    total: mine.length,
    withStream: withStream.length,
    noStream: noStream.length,
    blocked: blocked.length,
    nsfwFlagged: nsfwFlagged.length,
    closed: closed.length,
  });
}

const keptIds = new Set(keptChannels.map((channel) => channel.id));
const keptStreams = streams.filter((stream) => stream.channel && keptIds.has(stream.channel));

/**
 * One orphan stream is kept deliberately. 1969 of the real ones have
 * `channel: null`, and a fixture without one cannot prove the parser survives
 * them.
 */
const orphan = streams.find((stream) => !stream.channel);
if (orphan) keptStreams.push(orphan);

const keptBlocklist = blocklist.filter((entry) => keptIds.has(entry.channel));

const dir = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'iptv');
writeFileSync(resolve(dir, 'channels.json'), `${JSON.stringify(keptChannels, null, 2)}\n`);
writeFileSync(resolve(dir, 'streams.json'), `${JSON.stringify(keptStreams, null, 2)}\n`);
writeFileSync(resolve(dir, 'blocklist.json'), `${JSON.stringify(keptBlocklist, null, 2)}\n`);

console.log(`captured ${keptChannels.length} channels, ${keptStreams.length} streams, ${keptBlocklist.length} blocklist entries`);
console.log('\nper-country case coverage in the LIVE data:');
for (const row of report) {
  console.log(`  ${row.country}: ${row.total} channels — withStream ${row.withStream}, noStream ${row.noStream}, blocked ${row.blocked}, is_nsfw ${row.nsfwFlagged}, closed ${row.closed}`);
  for (const [name, n] of Object.entries(row)) {
    if (name !== 'country' && name !== 'total' && n === 0) {
      console.log(`      !! no "${name}" case exists for ${row.country} — the fixture cannot exercise it`);
    }
  }
}
console.log(`\norphan stream (channel: null) included: ${orphan ? 'yes' : 'NO — parser path unexercised'}`);
