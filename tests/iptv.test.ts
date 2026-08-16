import assert from 'node:assert/strict';
import registry from '../data/sources.json';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it } from 'node:test';
import {
  IPTV_CODE_OVERRIDES,
  classifyStream,
  iptvCountryCode,
  listingFor,
  parseBlocklist,
  parseChannels,
  parseStreams,
  sortForDisplay,
  type TvChannel,
} from '../src/sources/iptv';

/**
 * Contract test for iptv-org — step 11.
 *
 * The fixture is a SUBSET of a 9.8 MB index, chosen by case rather than by
 * convenience: channels with a stream, channels with none, blocklisted
 * channels, an `is_nsfw` channel, a closed channel, and one orphan stream with
 * `channel: null`. `scripts/capture-iptv.mjs` reports which cases a country
 * cannot supply rather than producing a fixture that silently cannot exercise
 * them.
 */
/**
 * The registry ids this file is the contract test FOR.
 *
 * Named explicitly because `verifiedAgainst: 'live'` is a claim that we have
 * seen a source's real response and pinned its shape, and the doc-tree audit
 * checks that claim by looking for the id in the suite. This file covered all
 * three sources and named none of them, so the audit reported them as untested
 * — correctly, since a test nobody can trace back to a registry entry does not
 * discharge that entry's claim.
 */
const COVERS = ['iptv-org-channels', 'iptv-org-streams', 'iptv-org-blocklist'] as const;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolvePath(import.meta.dirname, 'fixtures/iptv', `${name}.json`), 'utf8'));
}

const CHANNELS = parseChannels(fixture('channels'));
const STREAMS = parseStreams(fixture('streams'));
const BLOCKLIST = parseBlocklist(fixture('blocklist'));

describe('iptv: this file is the contract test for three registry entries', () => {
  it('covers every iptv source the registry marks live', () => {
    /**
     * Asserted rather than merely commented, so the list cannot drift from the
     * registry silently. If a fourth iptv source is registered live and not
     * added here, the doc-tree audit reports it and this test is where the fix
     * goes.
     */
    const registered = (registry as { sources: Array<{ id: string; verifiedAgainst?: string; excluded?: boolean }> }).sources
      .filter((source) => !source.excluded && source.verifiedAgainst === 'live' && source.id.startsWith('iptv-org'))
      .map((source) => source.id)
      .sort();

    assert.ok(registered.length > 0, 'no live iptv source is registered — this file would prove nothing');
    assert.deepEqual([...COVERS].sort(), registered);
  });
});

describe('iptv: the blocklist is a legal requirement, not a filter', () => {
  it('the fixture actually contains blocked channels, or this file proves nothing', () => {
    /**
     * Rule 40: a two-state assertion reports its sample's states. Without this,
     * every exclusion test below would pass vacuously on a fixture that
     * happened to contain nothing to exclude.
     */
    assert.ok(BLOCKLIST.length > 0, 'the fixture blocklist is empty, so no exclusion is being tested');
    const blockedIds = new Set(BLOCKLIST.map((entry) => entry.channel));
    const present = CHANNELS.filter((channel) => blockedIds.has(channel.id));
    assert.ok(present.length > 0, 'no blocked channel is present in the channel fixture');
  });

  it('excludes every blocklisted channel from a country listing', () => {
    /**
     * MEASURED 2026-08-15: blocklist.json lists 1578 channels — 1211 dmca, 367
     * nsfw — and ALL 1420 that still exist are present in channels.json. The
     * index does not have the blocklist applied. Rendering it as it arrives
     * ships channels removed on copyright demand.
     */
    const listing = listingFor('GBR', CHANNELS, STREAMS, BLOCKLIST);
    const blockedIds = new Set(BLOCKLIST.map((entry) => entry.channel));
    for (const channel of listing.channels) {
      assert.ok(!blockedIds.has(channel.id), `${channel.id} is blocklisted and was rendered anyway`);
    }
    assert.ok(
      listing.blocked.dmca + listing.blocked.nsfw > 0,
      'nothing was excluded, so the exclusion path did not run',
    );
  });

  it('reports how many it removed, rather than silently dropping them', () => {
    // A surface that silently drops rows cannot be told apart from one that had
    // none. The count is returned so the panel can say so.
    const listing = listingFor('GBR', CHANNELS, STREAMS, BLOCKLIST);
    assert.equal(typeof listing.blocked.dmca, 'number');
    assert.equal(typeof listing.blocked.nsfw, 'number');
  });

  it('honours is_nsfw independently of the blocklist', () => {
    // Two separate flags that do not fully overlap. Neither is assumed to imply
    // the other, because assuming it would leak whichever one is missing.
    const nsfwFlagged = CHANNELS.filter((channel) => channel.isNsfw);
    assert.ok(nsfwFlagged.length > 0, 'the fixture has no is_nsfw channel, so this path is untested');
    const listing = listingFor('GBR', CHANNELS, STREAMS, BLOCKLIST);
    for (const channel of listing.channels) {
      const source = CHANNELS.find((candidate) => candidate.id === channel.id);
      assert.equal(source?.isNsfw, false, `${channel.id} is flagged is_nsfw and was rendered`);
    }
  });

  it('refuses an unrecognised block reason rather than treating it as unblocked', () => {
    /**
     * PLANTED. Rule 29: a guard keyed on a value it does not recognise must
     * fail loudly. A lenient parse would let a future third reason fall through
     * to "not blocked", which fails open on the one guard that must not.
     */
    assert.throws(
      () => parseBlocklist([{ channel: 'X.us', reason: 'court-order', ref: '' }]),
      /unknown blocklist reason/,
    );
    // positive control: the two real reasons parse
    assert.equal(parseBlocklist([{ channel: 'X.us', reason: 'dmca', ref: '' }])[0]?.reason, 'dmca');
    assert.equal(parseBlocklist([{ channel: 'Y.us', reason: 'nsfw', ref: '' }])[0]?.reason, 'nsfw');
  });
});

describe('iptv: the United Kingdom is UK, not GB', () => {
  it('maps GBR to the code the source actually uses', () => {
    /**
     * MEASURED: `UK` has 680 channels and `GB` has zero. A straight
     * alpha-3 → alpha-2 conversion returns nothing for the United Kingdom, with
     * no error — a major country vanishing silently.
     */
    assert.equal(iptvCountryCode('GBR'), 'UK');
    assert.notEqual(iptvCountryCode('GBR'), 'GB');
  });

  it('still converts ordinary countries the ordinary way', () => {
    assert.equal(iptvCountryCode('ISL'), 'IS');
    assert.equal(iptvCountryCode('FRA'), 'FR');
    assert.equal(iptvCountryCode('JPN'), 'JP');
  });

  it('returns null for a code the mapping cannot resolve, rather than guessing', () => {
    assert.equal(iptvCountryCode('ZZZ'), null);
  });

  it('the override table is consulted, not bypassed', () => {
    // If someone reimplements the lookup without the table, this fails.
    for (const [iso3, code] of Object.entries(IPTV_CODE_OVERRIDES)) {
      assert.equal(iptvCountryCode(iso3), code);
    }
  });

  it('the United Kingdom actually returns channels through the override', () => {
    const listing = listingFor('GBR', CHANNELS, STREAMS, BLOCKLIST);
    assert.ok(listing.channels.length > 0, 'GBR returned no channels — the override is not working');
  });
});

describe('iptv: a channel with no stream is not a dead channel', () => {
  it('keeps channels the index lists with no stream, marked as such', () => {
    /**
     * MEASURED: 41068 channels against 16589 streams. For the United Kingdom,
     * 400 of 680 channels have no stream at all. "Listed" and "watchable" are
     * different facts, and collapsing them would either hide 400 channels or
     * imply 400 dead ones.
     */
    const listing = listingFor('GBR', CHANNELS, STREAMS, BLOCKLIST);
    assert.ok(listing.withoutStream > 0, 'the fixture has no streamless channel, so this path is untested');
    const streamless = listing.channels.filter((channel) => channel.url === null);
    assert.equal(streamless.length, listing.withoutStream);
  });

  it('survives a stream with no channel id', () => {
    // 1969 of the real streams have `channel: null`. They parse, and they are
    // skipped at join time rather than crashing or being attached to nothing.
    const orphans = STREAMS.filter((stream) => stream.channelId === null);
    assert.ok(orphans.length > 0, 'the fixture has no orphan stream, so this path is untested');
    assert.doesNotThrow(() => listingFor('GBR', CHANNELS, STREAMS, BLOCKLIST));
  });
});

describe('iptv: dead streams are sorted last, never hidden', () => {
  function channel(name: string, health: TvChannel['health'], url: string | null = 'https://x.invalid/s.m3u8'): TvChannel {
    return { id: name, name, categories: [], url, quality: null, health, closed: null };
  }

  it('orders online, unchecked, restricted, offline, then no-stream', () => {
    /**
     * BUILD-ORDER specifies this, and the reason is rule 30: a country whose
     * every stream is dead would render identically to one with no streams
     * catalogued. Hiding them misreports coverage.
     */
    const sorted = sortForDisplay([
      channel('e', 'offline'),
      channel('d', 'unchecked', null),
      channel('a', 'online'),
      channel('c', 'restricted'),
      channel('b', 'unchecked'),
    ]);
    assert.deepEqual(sorted.map((entry) => entry.name), ['a', 'b', 'c', 'e', 'd']);
  });

  it('every state survives the sort — nothing is dropped', () => {
    const input = [channel('x', 'offline'), channel('y', 'online'), channel('z', 'restricted')];
    assert.equal(sortForDisplay(input).length, input.length);
  });
});

describe('iptv: a live server refusing is not a dead server', () => {
  it('classifies a 401 and a 403 as restricted, not offline', () => {
    /**
     * MEASURED against the fixture's own streams: one returns 401 from
     * cloudflarestream.com. Calling it "online" sends a viewer somewhere they
     * cannot watch; calling it "offline" states something false about a server
     * that answered in 477ms.
     */
    assert.equal(classifyStream(401), 'restricted');
    assert.equal(classifyStream(403), 'restricted');
  });

  it('classifies a thrown request as offline', () => {
    // DNS failure, TLS failure, timeout, connection refused — measured at 2ms
    // and at 8015ms. All the same fact to a viewer.
    assert.equal(classifyStream(null), 'offline');
  });

  it('classifies 2xx and 3xx as online', () => {
    assert.equal(classifyStream(200), 'online');
    assert.equal(classifyStream(302), 'online');
  });

  it('classifies a server error as offline', () => {
    assert.equal(classifyStream(500), 'offline');
    assert.equal(classifyStream(404), 'offline');
  });
});
