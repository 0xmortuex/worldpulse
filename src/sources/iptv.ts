import isoCountries from 'i18n-iso-countries';
import { ShapeError } from './adapter';

const SOURCE_ID = 'iptv-org-channels';

/**
 * iptv-org: the channel index, the stream index, and the blocklist.
 *
 * ## The blocklist is not optional, and it is not applied upstream
 *
 * MEASURED 2026-08-15: `blocklist.json` lists **1578 channels — 1211 `dmca`,
 * 367 `nsfw`** — and **all 1420 of the ones that exist are still present in
 * `channels.json`.** The index does not have the blocklist applied to it. An
 * app that renders the channel list as it arrives ships channels that were
 * removed on copyright demand and channels flagged as adult.
 *
 * That is emergency 2 in `OPEN-QUESTIONS.md` — shipping content whose terms we
 * have read and which forbids it — so the exclusion happens in the parser, not
 * in a view that a future refactor could route around.
 *
 * ## The licence, actually read (L15)
 *
 * `iptv-org/api` and `iptv-org/iptv` are both **The Unlicense** — public
 * domain, commercial use permitted. That is the FIRST licence in this project
 * that turned out to be as permissive as the plan assumed; the previous five
 * were all narrower than recorded.
 *
 * The Unlicense covers the **index**. It does not and cannot cover the streams,
 * which are third-party URLs. The project's own Legal section is explicit: no
 * video is stored, the links point at publicly posted streams, and they have no
 * control over the destination. So: **never proxy or re-host video, link to the
 * upstream URL only, and attribute iptv-org visibly.**
 */

export interface Channel {
  id: string;
  name: string;
  /** iptv-org's two-letter code, which is NOT always ISO alpha-2. See below. */
  country: string;
  categories: string[];
  isNsfw: boolean;
  /** Present when the channel has shut down. A closed channel is not a dead stream. */
  closed: string | null;
}

export interface Stream {
  channelId: string | null;
  url: string;
  quality: string | null;
}

export type BlockReason = 'dmca' | 'nsfw';

export interface BlockEntry {
  channel: string;
  reason: BlockReason;
  ref: string;
}

/**
 * ## iptv-org uses `UK`, and ISO 3166-1 says `GB`
 *
 * MEASURED: `UK` has **680 channels**; `GB` has **zero**. A straight
 * alpha-3 → alpha-2 conversion maps `GBR` to `GB` and returns nothing for the
 * United Kingdom — a major country vanishing with no error, which is the
 * silent-disappearance failure this project keeps finding.
 *
 * Recorded as an explicit override table rather than a special case inside the
 * lookup, so the next divergence is a data change instead of a code change, and
 * so a test can assert the table is actually consulted.
 */
export const IPTV_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  GBR: 'UK',
  /**
   * Kosovo. `XK` is user-assigned rather than ISO-official — the same status
   * this app already gives it on the globe — and iptv-org lists 72 channels
   * under it.
   */
  XKX: 'XK',
};

export function iptvCountryCode(iso3: string): string | null {
  const override = IPTV_CODE_OVERRIDES[iso3];
  if (override) return override;
  const alpha2 = isoCountries.alpha3ToAlpha2(iso3);
  return alpha2 ?? null;
}

/* ------------------------------------------------------------------ parsing */

function asArray(raw: unknown, what: string): unknown[] {
  if (!Array.isArray(raw)) throw new ShapeError(SOURCE_ID, `${what} is not an array`);
  return raw;
}

export function parseChannels(raw: unknown): Channel[] {
  return asArray(raw, 'channels.json').map((row) => {
    const record = row as Record<string, unknown>;
    const id = record['id'];
    if (typeof id !== 'string' || id === '') {
      throw new ShapeError(SOURCE_ID, `a channel has no id: ${JSON.stringify(row).slice(0, 120)}`);
    }
    return {
      id,
      name: typeof record['name'] === 'string' ? record['name'] : id,
      country: typeof record['country'] === 'string' ? record['country'] : '',
      categories: Array.isArray(record['categories']) ? (record['categories'] as string[]) : [],
      isNsfw: record['is_nsfw'] === true,
      closed: typeof record['closed'] === 'string' ? record['closed'] : null,
    };
  });
}

export function parseStreams(raw: unknown): Stream[] {
  return asArray(raw, 'streams.json')
    .map((row) => {
      const record = row as Record<string, unknown>;
      const url = record['url'];
      if (typeof url !== 'string' || url === '') return null;
      return {
        /**
         * MEASURED: 1969 of 16589 streams have `channel: null` — a titled
         * stream with nothing to attach it to. They are kept as parsed rows
         * with a null id rather than dropped, so the count of what the source
         * actually returned stays honest, and skipped at join time.
         */
        channelId: typeof record['channel'] === 'string' && record['channel'] !== '' ? record['channel'] : null,
        url,
        quality: typeof record['quality'] === 'string' ? record['quality'] : null,
      };
    })
    .filter((stream): stream is Stream => stream !== null);
}

export function parseBlocklist(raw: unknown): BlockEntry[] {
  return asArray(raw, 'blocklist.json').map((row) => {
    const record = row as Record<string, unknown>;
    const channel = record['channel'];
    const reason = record['reason'];
    if (typeof channel !== 'string' || channel === '') {
      throw new ShapeError(SOURCE_ID, `a blocklist entry has no channel: ${JSON.stringify(row).slice(0, 120)}`);
    }
    if (reason !== 'dmca' && reason !== 'nsfw') {
      /**
       * Rule 29: a guard keyed on a value it does not recognise must fail
       * loudly. If iptv-org adds a third reason, the safe behaviour is to stop
       * — not to let an unrecognised block reason fall through to "not
       * blocked", which is what a lenient parse would do.
       */
      throw new ShapeError(SOURCE_ID, `unknown blocklist reason ${JSON.stringify(reason)} for ${channel}`);
    }
    return { channel, reason, ref: typeof record['ref'] === 'string' ? record['ref'] : '' };
  });
}

/* -------------------------------------------------------------------- join */

/**
 * ## Four states, because measurement found four
 *
 * A first draft had three — online, offline, unchecked. Probing the fixture's
 * streams produced a fourth that neither of the others describes honestly:
 *
 * ```
 * 200  hls.afintl.com                    online
 * 200  ruvlive.akamaized.net             online
 * ERR  45.77.66.224:1935     8015ms      offline (timeout)
 * ERR  althingi-live...         2ms      offline (DNS/TLS)
 * 401  customer-...cloudflarestream.com  ???
 * ```
 *
 * **A 401 is a live server refusing.** Calling it `online` sends a viewer to a
 * stream they cannot watch; calling it `offline` states something false about
 * the server. It is `restricted`, and it renders as its own thing.
 *
 * Every responding server sent `access-control-allow-origin: *`, so a browser
 * can read these results — the check does not have to live server-side.
 */
export type StreamHealth = 'online' | 'offline' | 'restricted' | 'unchecked';

/**
 * Classify a probe result. Exported for rule 32 — the mapping is the whole
 * guard, and a mapping that can only be reached through a network call is a
 * mapping nobody can test at the boundaries.
 *
 * `status` is null when the request threw: DNS failure, TLS failure, timeout,
 * connection refused. All of those mean the same thing to a viewer.
 */
export function classifyStream(status: number | null): StreamHealth {
  if (status === null) return 'offline';
  if (status === 401 || status === 403) return 'restricted';
  if (status >= 200 && status < 400) return 'online';
  return 'offline';
}

export interface TvChannel {
  id: string;
  name: string;
  categories: string[];
  /** Null when the index lists the channel but no stream references it. */
  url: string | null;
  quality: string | null;
  health: StreamHealth;
  closed: string | null;
}

export interface TvListing {
  channels: TvChannel[];
  /** How many channels the blocklist removed, by reason — reported, not hidden. */
  blocked: Record<BlockReason, number>;
  /** Channels the index lists with no stream at all. Known to exist, not watchable. */
  withoutStream: number;
}

/**
 * Build a country's listing.
 *
 * **Blocked channels are removed before anything else**, and the count is
 * returned rather than swallowed: a surface that silently drops rows cannot be
 * distinguished from one that had none.
 *
 * **A channel with no stream is kept**, with `url: null`. It is a different
 * fact from a channel whose stream is dead, and from a country with no
 * channels — rule 30, and the reason `withoutStream` is counted separately.
 */
export function listingFor(
  iso3: string,
  channels: readonly Channel[],
  streams: readonly Stream[],
  blocklist: readonly BlockEntry[],
): TvListing {
  const code = iptvCountryCode(iso3);
  const blocked = new Map(blocklist.map((entry) => [entry.channel, entry.reason]));

  const streamByChannel = new Map<string, Stream>();
  for (const stream of streams) {
    if (stream.channelId === null) continue;
    if (!streamByChannel.has(stream.channelId)) streamByChannel.set(stream.channelId, stream);
  }

  const counts: Record<BlockReason, number> = { dmca: 0, nsfw: 0 };
  const listed: TvChannel[] = [];

  for (const channel of channels) {
    if (code === null || channel.country !== code) continue;

    const reason = blocked.get(channel.id);
    if (reason) {
      counts[reason] += 1;
      continue;
    }
    /**
     * `is_nsfw` is a second, independent flag from the blocklist's `nsfw`
     * reason, and they do not fully overlap. Both are honoured; neither is
     * assumed to imply the other.
     */
    if (channel.isNsfw) {
      counts.nsfw += 1;
      continue;
    }

    const stream = streamByChannel.get(channel.id);
    listed.push({
      id: channel.id,
      name: channel.name,
      categories: channel.categories,
      url: stream?.url ?? null,
      quality: stream?.quality ?? null,
      health: 'unchecked',
      closed: channel.closed,
    });
  }

  return {
    channels: sortForDisplay(listed),
    blocked: counts,
    withoutStream: listed.filter((channel) => channel.url === null).length,
  };
}

/**
 * ## Dead streams are sorted last, never hidden
 *
 * `BUILD-ORDER` specifies this and the reason is a rule-30 one: a country whose
 * every stream is dead would render identically to a country with no streams
 * catalogued, and those are different facts. Hiding them misreports coverage.
 *
 * Order: online, then unchecked, then offline, then channels with no stream at
 * all; alphabetical within each band so the list is stable between renders.
 */
const HEALTH_ORDER: Record<StreamHealth, number> = {
  online: 0,
  unchecked: 1,
  /**
   * Restricted sorts above offline: the stream exists and a viewer with access
   * can watch it, which is more useful than one that does not answer at all.
   */
  restricted: 2,
  offline: 3,
};

export function sortForDisplay(channels: readonly TvChannel[]): TvChannel[] {
  // 4 = "no stream at all", which sorts below every checked state.
  return [...channels].sort((a, b) => {
    const aBand = a.url === null ? 4 : HEALTH_ORDER[a.health];
    const bBand = b.url === null ? 4 : HEALTH_ORDER[b.health];
    return aBand - bBand || a.name.localeCompare(b.name);
  });
}
