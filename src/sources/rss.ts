import { ShapeError } from './adapter';

/**
 * The curated RSS fallback — item 7's blocking dependency, landed first.
 *
 * `SPEC-BREAKING-NEWS.md` fixes the build order and the reason: GDELT failed
 * **six of six** attempts across a full session and is recorded UNREACHABLE. A
 * ranking engine built on a source that has never once responded is a ranking
 * engine nobody has seen rank anything. So the feeds land, then the board wires
 * to them.
 *
 * ## Parsed with a regex, deliberately, and here is the honest cost
 *
 * There is no DOM in the test environment and no XML parser in the dependency
 * set, and adding one for fifteen well-formed feeds is a larger change than
 * this needs. Regex parsing of XML is genuinely fragile — it breaks on nested
 * CDATA, on attributes that contain angle brackets, and on any feed that nests
 * `<item>` inside something unexpected.
 *
 * What makes it acceptable here rather than merely convenient: **a feed that
 * does not parse produces zero items, and zero items is a state the caller
 * already has to handle** — an outlet that published nothing looks the same. So
 * the failure mode is under-counting a story's breadth, not inventing one. That
 * is the right direction for a significance score whose whole caveat is that it
 * measures our corpus rather than the world.
 *
 * If a feed ever needs its own parser, this is where the seam is.
 */

export interface FeedItem {
  title: string;
  link: string;
  /** ISO date, or null when the feed omits or malforms it. */
  published: string | null;
}

const ITEM = /<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g;

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  if (!match?.[1]) return null;
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFeed(xml: unknown, sourceId: string): FeedItem[] {
  if (typeof xml !== 'string') {
    throw new ShapeError(sourceId, `expected an XML string, got ${typeof xml}`);
  }

  /**
   * A body with no feed envelope at all is a SHAPE failure, not an empty feed.
   * An HTML error page is the common case, and treating it as "this outlet
   * published nothing today" would quietly reduce every story's measured
   * breadth — the under-count this parser is otherwise happy to accept, but
   * arriving from a cause the caller should know about.
   */
  if (!/<(rss|feed)[\s>]/i.test(xml)) {
    throw new ShapeError(sourceId, 'body is not an RSS or Atom feed');
  }

  const items: FeedItem[] = [];
  for (const block of xml.match(ITEM) ?? []) {
    const title = tag(block, 'title');
    if (!title) continue;

    const link =
      tag(block, 'link') ?? /<link[^>]*href="([^"]+)"/.exec(block)?.[1] ?? '';

    const raw = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated');
    const parsed = raw === null ? Number.NaN : Date.parse(raw);

    items.push({
      title,
      link,
      /**
       * An unparseable date is null rather than "now". Defaulting to now would
       * make every malformed item look freshly published, which feeds directly
       * into the coverage-duration input of the significance score.
       */
      published: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    });
  }

  return items;
}

/**
 * Group items across feeds into stories by headline similarity.
 *
 * Deliberately crude — normalised title equality — and the crudeness is stated
 * because it bounds the outlet-breadth input directly: two outlets running the
 * same story under different headlines count as two stories, so breadth is
 * under-counted rather than over-counted. Again the right direction: the score
 * claims less than the world, never more.
 */
export function groupIntoStories(
  byFeed: ReadonlyMap<string, readonly FeedItem[]>,
): Array<{ headline: string; outlets: string[]; articles: number; earliest: string | null }> {
  const stories = new Map<string, { headline: string; outlets: Set<string>; articles: number; earliest: string | null }>();

  for (const [feedId, items] of byFeed) {
    for (const item of items) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (key === '') continue;

      const existing = stories.get(key);
      if (existing) {
        existing.outlets.add(feedId);
        existing.articles += 1;
        if (item.published && (existing.earliest === null || item.published < existing.earliest)) {
          existing.earliest = item.published;
        }
      } else {
        stories.set(key, {
          headline: item.title,
          outlets: new Set([feedId]),
          articles: 1,
          earliest: item.published,
        });
      }
    }
  }

  return [...stories.values()].map((story) => ({
    headline: story.headline,
    outlets: [...story.outlets].sort(),
    articles: story.articles,
    earliest: story.earliest,
  }));
}
