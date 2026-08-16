import { tvListingFor } from '../dossier/tv-provider';
import type { StreamHealth, TvChannel, TvListing } from '../sources/iptv';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * Step 11 — Live TV, via iptv-org.
 *
 * ## Three things this panel must never do
 *
 * **Never proxy or re-host video.** The index is public domain; the streams are
 * third-party URLs whose copyright status iptv-org explicitly does not warrant.
 * Every playable channel is an anchor to the upstream URL and nothing else — no
 * `<video>` element served from us, no rewriting through a worker.
 *
 * **Never render a blocklisted channel.** MEASURED: all 1420 blocklisted
 * channels that still exist are present in `channels.json`; the index does not
 * have the list applied. The exclusion is in the parser, and this panel reports
 * the count it removed.
 *
 * **Never hide a dead stream.** A country whose every stream is dead must not
 * render like a country with no streams catalogued. Dead streams are marked and
 * sorted last.
 */
export function renderTvTab(iso3: string, countryName: string): string {
  const listing = tvListingFor(iso3);

  if (listing.channels.length === 0) {
    return `<div class="gov tv">
      <section class="gov-block">
        <h3>Live TV</h3>
        <p class="gov-pending">No channels are catalogued for ${escapeHtml(countryName)} in the
        channel index. That is a gap in the index, not a finding that the country has no
        television.</p>
        ${removedNote(listing)}
      </section>
      ${attribution()}
    </div>`;
  }

  return `<div class="gov tv">
    <section class="gov-block">
      <h3>Live TV</h3>
      ${summary(listing)}
      ${removedNote(listing)}
      <ul class="tv-list">${listing.channels.map(row).join('')}</ul>
    </section>
    ${attribution()}
  </div>`;
}

function summary(listing: TvListing): string {
  const playable = listing.channels.filter((channel) => channel.url !== null).length;
  return `<p class="tv-summary">
    ${n(listing.channels.length, 'channels listed for this country after blocked entries are removed')}
    channels listed,
    ${n(playable, 'channels that have a stream URL in the index')} with a stream.</p>`;
}

/**
 * The removed-count disclosure, and the case where it must NOT appear.
 *
 * Rule 42: a disclosure that renders unconditionally discloses nothing. A
 * country with no blocked channels gets no sentence about blocking, so the
 * sentence means something when it does appear.
 */
function removedNote(listing: TvListing): string {
  const total = listing.blocked.dmca + listing.blocked.nsfw;
  if (total === 0) return '';

  const parts: string[] = [];
  if (listing.blocked.dmca > 0) {
    parts.push(`${n(listing.blocked.dmca, 'channels removed by the upstream index on copyright demand')} on copyright demand`);
  }
  if (listing.blocked.nsfw > 0) {
    parts.push(`${n(listing.blocked.nsfw, 'channels flagged adult by the upstream index or its own flag')} flagged adult`);
  }

  return `<p class="tv-removed gov-caveat">${parts.join(' and ')} — not shown.
    The upstream index publishes these exclusions separately and does not apply them to the
    channel list, so this app applies them.</p>`;
}

const HEALTH_LABEL: Record<StreamHealth, string> = {
  online: 'Online',
  offline: 'Offline',
  restricted: 'Restricted',
  unchecked: 'Not checked',
};

const HEALTH_NOTE: Record<StreamHealth, string> = {
  online: 'The stream answered when it was last checked.',
  offline: 'The stream did not answer when it was last checked. It is listed rather than hidden, because hiding it would misreport how much coverage this country has.',
  restricted: 'The server answered but refused access. It is alive; a viewer without credentials cannot watch it.',
  unchecked: 'This stream has not been checked. That is not a claim that it works.',
};

function row(channel: TvChannel): string {
  /**
   * A channel with no stream is not offline. The index knows it exists and
   * lists no way to watch it, which is a third thing — and it must not borrow
   * the word "offline", which would assert a failed check that never happened.
   */
  if (channel.url === null) {
    return `<li class="tv-row tv-row--no-stream">
      <span class="tv-name">${escapeHtml(channel.name)}</span>
      <span class="tv-health tv-health--no-stream">No stream listed</span>
      <span class="tv-note">The index lists this channel and records no stream for it.</span>
    </li>`;
  }

  return `<li class="tv-row tv-row--${channel.health}">
    <a class="tv-name" href="${escapeHtml(channel.url)}" rel="noopener noreferrer nofollow"
      target="_blank">${escapeHtml(channel.name)}</a>
    <span class="tv-health tv-health--${channel.health}">${escapeHtml(HEALTH_LABEL[channel.health])}</span>
    ${channel.quality ? `<span class="tv-quality">${escapeHtml(channel.quality)}</span>` : ''}
    <span class="tv-note">${escapeHtml(HEALTH_NOTE[channel.health])}</span>
  </li>`;
}

function attribution(): string {
  return `<section class="gov-block tv-attribution">
    <p class="gov-caveat">Channel and stream index from
      <a href="https://github.com/iptv-org/api" rel="noopener noreferrer">iptv-org</a>,
      released into the public domain under The Unlicense.</p>
    <p class="gov-caveat"><strong>Streams are third-party.</strong> This app links to stream URLs
    published by the index and neither hosts nor proxies any video. It makes no claim about the
    copyright status of what a link points at, and the index's maintainers state that they have
    no control over the destination.</p>
  </section>`;
}
