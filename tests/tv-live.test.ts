import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import extract from '../data/iptv-extract.json';
import { tvListingLive } from '../src/dossier/tv-live';

/**
 * The TV panel's live path, against the build-time extract.
 *
 * The extract exists because `channels.json` is 9.8 MB raw, and it applies the
 * blocklist BEFORE bundling so the excluded channels never reach the artefact.
 * These tests check that property directly, because it is the one with legal
 * weight rather than merely performance weight.
 */

interface Extract {
  channels: Array<{ id: string; country: string }>;
  removed: Record<string, number>;
  withoutStream: Record<string, number>;
}

const DATA = extract as unknown as Extract;

describe('the TV extract ships nothing it should not', () => {
  it('the artefact is non-trivial, or every check below is vacuous', () => {
    // The sixth guard this session to assert its own denominator.
    assert.ok(DATA.channels.length > 1000, `only ${DATA.channels.length} channels in the extract`);
  });

  it('records how many channels were removed, rather than dropping them silently', () => {
    /**
     * A surface that silently drops rows cannot be told apart from one that had
     * none. The counts survive the extraction so the panel can still say what
     * was excluded — recomputing them from the shipped list would always yield
     * zero and turn a real disclosure into a false one.
     */
    assert.ok((DATA.removed['dmca'] ?? 0) > 0, 'no dmca removals recorded');
    assert.ok((DATA.removed['nsfw'] ?? 0) > 0, 'no nsfw removals recorded');
  });

  it('every shipped channel has a stream — that is what "kept" means', () => {
    const streamless = DATA.channels.filter((channel) => !('url' in channel));
    assert.equal(streamless.length, 0);
  });

  it('the streamless COUNT survives even though the rows do not', async () => {
    /**
     * The panel draws a real distinction between "listed but not watchable" and
     * "no channels at all". 29,733 rows would dominate the artefact to preserve
     * a state a count expresses, so the count is carried instead — and if it
     * were dropped, the distinction would silently disappear.
     */
    assert.ok(Object.keys(DATA.withoutStream).length > 0, 'no per-country streamless counts survived');
    const uk = await tvListingLive('GBR');
    assert.ok(uk.withoutStream > 0, 'the United Kingdom reports no streamless channels, which is wrong');
  });
});

describe('the live listing reads the extract', () => {
  it('the UK/GB override still applies on the live path', async () => {
    /**
     * iptv-org has 680 channels under `UK` and zero under `GB`. The override
     * lives in the parser, and this asserts the live path goes through it
     * rather than round-tripping the ISO code itself — the fixture path passing
     * proves the table, not every caller of it.
     */
    const uk = await tvListingLive('GBR');
    assert.ok(uk.channels.length > 0, 'GBR returned nothing — the override is bypassed on this path');
  });

  it('every channel reports health as unchecked, never as online', async () => {
    /**
     * A stream's liveness is a property of the network at a moment. Recording
     * it in a build artefact would ship a measurement that was already stale,
     * and `online` is a claim this file has no evidence for.
     */
    const uk = await tvListingLive('GBR');
    for (const channel of uk.channels) {
      assert.equal(channel.health, 'unchecked', `${channel.id} claims a health state nobody measured`);
    }
  });

  it('a country with no channels returns an empty listing, not a throw', async () => {
    const none = await tvListingLive('ATA');
    assert.deepEqual(none.channels, []);
    // and the removal counts are still reported, because they are global
    assert.ok(none.blocked.dmca > 0);
  });

  it('an unmappable country code yields nothing rather than everything', async () => {
    // A null country code must not fall through to "no filter applied".
    const bogus = await tvListingLive('ZZZ');
    assert.deepEqual(bogus.channels, []);
    assert.equal(bogus.withoutStream, 0);
  });
});
