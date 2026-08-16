import blocklistFixture from '../../tests/fixtures/iptv/blocklist.json';
import channelsFixture from '../../tests/fixtures/iptv/channels.json';
import streamsFixture from '../../tests/fixtures/iptv/streams.json';
import { listingFor, parseBlocklist, parseChannels, parseStreams, type TvListing } from '../sources/iptv';

/**
 * TV listings for step 11.
 *
 * Fixture-backed, per 20b: the hard cases — a blocklisted channel, an
 * `is_nsfw` channel, a channel with no stream, an orphan stream — come from a
 * captured subset of the real index and are the regression suite. The live path
 * arrives with step 10's pipeline.
 *
 * The fixture is captured by `scripts/capture-iptv.mjs`, which selects by CASE
 * rather than by convenience and reports which cases a country cannot supply.
 */

const CHANNELS = parseChannels(channelsFixture);
const STREAMS = parseStreams(streamsFixture);
const BLOCKLIST = parseBlocklist(blocklistFixture);

export function tvListingFor(iso3: string): TvListing {
  return listingFor(iso3, CHANNELS, STREAMS, BLOCKLIST);
}
