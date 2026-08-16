import { iptvCountryCode, sortForDisplay, type TvChannel, type TvListing } from '../sources/iptv';

/**
 * The TV panel's live path — the build-time extract, loaded on demand.
 *
 * ## Why a dynamic import and not a static one
 *
 * The extract is **1.8 MB against a 570 KB app-chunk budget**. A static import
 * would put the whole catalogue in the initial bundle for every visitor,
 * including everyone who never opens this tab, and the bundle budget would fail
 * the build — which is the guard working rather than an obstacle.
 *
 * So it is a separate chunk, fetched the first time the tab is opened. That is
 * the same reasoning as the runtime fetch it replaces, moved to build time: the
 * point was never to avoid transferring the data, it was to avoid transferring
 * 9.8 MB of it and to apply the blocklist before anything could render what it
 * excludes.
 *
 * ## What this file does NOT have to do
 *
 * Filter the blocklist. `scripts/extract-iptv.mjs` applies it before bundling,
 * so a blocked channel is not in the artefact at all — and `listingFor` in the
 * parser keeps its own check for the fixture path. Two guards, one rule, failing
 * independently: one bounds what ships, the other bounds what renders.
 */

interface ExtractChannel {
  id: string;
  name: string;
  country: string;
  categories: string[];
  closed: string | null;
  url: string;
  quality: string | null;
}

interface Extract {
  extractedOn: string;
  removed: Record<string, number>;
  withoutStream: Record<string, number>;
  channels: ExtractChannel[];
}

let cached: Promise<Extract> | null = null;

/**
 * Loaded once and shared. A second tab-open must not fetch 1.8 MB again, and
 * the promise is cached rather than the value so two rapid opens share one
 * request instead of racing.
 */
export function loadExtract(): Promise<Extract> {
  cached ??= import('../../data/iptv-extract.json').then((module) => module.default as unknown as Extract);
  return cached;
}

/** Test seam: drop the cache so a test can observe the load happening. */
export function resetExtractCache(): void {
  cached = null;
}

export async function tvListingLive(iso3: string): Promise<TvListing> {
  const extract = await loadExtract();
  const code = iptvCountryCode(iso3);

  const channels: TvChannel[] = extract.channels
    .filter((channel) => code !== null && channel.country === code)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      categories: channel.categories,
      url: channel.url,
      quality: channel.quality,
      /**
       * Every channel in the extract has a stream URL, and none has been health
       * checked at build time — a stream's liveness is a property of the
       * network at a moment, so recording it in a build artefact would ship a
       * measurement that was already stale. `unchecked` is the honest state
       * until the panel checks.
       */
      health: 'unchecked',
      closed: channel.closed,
    }));

  return {
    channels: sortForDisplay(channels),
    /**
     * The counts come from the extract rather than from this list, because the
     * removals happened before the data reached us. Recomputing them here would
     * always yield zero and quietly turn a real disclosure into a false one.
     */
    blocked: {
      dmca: extract.removed['dmca'] ?? 0,
      nsfw: extract.removed['nsfw'] ?? 0,
    },
    /**
     * Channels the index lists with no stream, per country. They are not rows
     * in the extract — 29,733 of them would dominate it — so the count is
     * carried instead, which is all the panel needs to say "listed but not
     * watchable".
     */
    withoutStream: code === null ? 0 : (extract.withoutStream[code] ?? 0),
  };
}
