import { expectObject, ShapeError } from '../sources/adapter';

/**
 * Portrait resolution.
 *
 * Order: Wikidata P18 -> Commons thumbnail, then the Wikipedia REST summary
 * thumbnail, then a neutral silhouette carrying the person's initials.
 *
 * The one hard rule: never substitute a photograph of a different person, and
 * never fall back to a search-engine image. A wrong face is a factual error
 * that reads as authoritative, and no amount of caption fixes it. If nothing
 * resolves, the placeholder says so.
 */

export type PortraitOrigin = 'commons' | 'wikipedia' | 'placeholder';

export interface Portrait {
  origin: PortraitOrigin;
  /** null for the placeholder, which is drawn rather than loaded. */
  url: string | null;
  /** Initials shown by the placeholder, and as the img alt fallback. */
  initials: string;
  /** Commons file title, needed to look up licence and credit. */
  fileTitle: string | null;
  attribution: PortraitAttribution | null;
}

export interface PortraitAttribution {
  licenseShortName: string | null;
  licenseUrl: string | null;
  artist: string | null;
  /** True when the licence obliges us to display credit. */
  creditRequired: boolean;
}

/**
 * Up to two initials. Takes the first and last name parts so that
 * "Ursula von der Leyen" yields UL rather than UV.
 */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => /\p{L}/u.test(part));
  if (parts.length === 0) return '?';
  const first = [...(parts[0] as string)][0] ?? '';
  if (parts.length === 1) return first.toUpperCase();
  const last = [...(parts[parts.length - 1] as string)][0] ?? '';
  return (first + last).toUpperCase();
}

/**
 * P18 arrives as a Special:FilePath URL. Special:FilePath takes a width
 * parameter and serves a scaled rendition, so the thumbnail is requested at the
 * size actually needed instead of pulling a multi-megabyte original for a 96px
 * slot.
 */
export function commonsThumbnail(p18Url: string, width: number): string {
  const separator = p18Url.includes('?') ? '&' : '?';
  return `${p18Url}${separator}width=${Math.round(width)}`;
}

/** "…/Special:FilePath/Foo%20bar.jpg" -> "File:Foo bar.jpg" */
export function fileTitleFromUrl(p18Url: string): string | null {
  const marker = '/Special:FilePath/';
  const index = p18Url.indexOf(marker);
  if (index === -1) return null;
  const encoded = p18Url.slice(index + marker.length).split(/[?#]/)[0];
  if (!encoded) return null;
  try {
    return `File:${decodeURIComponent(encoded).replace(/_/g, ' ')}`;
  } catch {
    return `File:${encoded.replace(/_/g, ' ')}`;
  }
}

export function resolvePortrait(
  name: string,
  p18Url: string | null,
  wikipediaThumbnailUrl: string | null,
  width = 192,
): Portrait {
  const initials = initialsOf(name);

  if (p18Url) {
    return {
      origin: 'commons',
      url: commonsThumbnail(p18Url, width),
      initials,
      fileTitle: fileTitleFromUrl(p18Url),
      attribution: null,
    };
  }

  if (wikipediaThumbnailUrl) {
    return { origin: 'wikipedia', url: wikipediaThumbnailUrl, initials, fileTitle: null, attribution: null };
  }

  return { origin: 'placeholder', url: null, initials, fileTitle: null, attribution: null };
}

/** Licences that require the photographer to be credited wherever the image appears. */
function requiresCredit(licenseShortName: string | null): boolean {
  if (!licenseShortName) return true; // unknown licence: assume the stricter case
  const licence = licenseShortName.toLowerCase();
  if (licence.includes('public domain') || licence.startsWith('cc0')) return false;
  return licence.includes('cc');
}

/**
 * Pull licence and photographer credit out of a Commons imageinfo response.
 *
 * Many of these images are CC-BY and legally require attribution, so a missing
 * credit is a compliance problem, not a cosmetic one — hence `creditRequired`
 * defaults to true whenever the licence cannot be read.
 */
export function parseCommonsAttribution(raw: unknown, sourceId = 'wikimedia-commons'): PortraitAttribution {
  const root = expectObject(sourceId, raw, 'root');
  const query = expectObject(sourceId, root['query'], 'query');
  const pages = expectObject(sourceId, query['pages'], 'query.pages');

  const firstPage = Object.values(pages)[0];
  if (firstPage === undefined) throw new ShapeError(sourceId, 'query.pages is empty');
  const page = expectObject(sourceId, firstPage, 'query.pages[0]');

  if ('missing' in page) {
    return { licenseShortName: null, licenseUrl: null, artist: null, creditRequired: true };
  }

  const imageinfo = page['imageinfo'];
  if (!Array.isArray(imageinfo) || imageinfo.length === 0) {
    throw new ShapeError(sourceId, 'query.pages[0].imageinfo is missing or empty');
  }
  const info = expectObject(sourceId, imageinfo[0], 'imageinfo[0]');
  const extmetadata = expectObject(sourceId, info['extmetadata'], 'imageinfo[0].extmetadata');

  const field = (key: string): string | null => {
    const entry = extmetadata[key];
    if (typeof entry !== 'object' || entry === null) return null;
    const value = (entry as Record<string, unknown>)['value'];
    if (typeof value !== 'string') return null;
    // Commons returns HTML in Artist. Strip tags rather than injecting them.
    return value.replace(/<[^>]*>/g, '').trim() || null;
  };

  const licenseShortName = field('LicenseShortName');

  return {
    licenseShortName,
    licenseUrl: field('LicenseUrl'),
    artist: field('Artist'),
    creditRequired: requiresCredit(licenseShortName),
  };
}
