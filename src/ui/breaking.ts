import fixture from '../../tests/fixtures/news/stories.json';
import nprFeed from '../../tests/fixtures/news/rss-npr.xml?raw';
import { groupIntoStories, parseFeed } from '../sources/rss';
import {
  CURATED_FEED_COUNT,
  SIGNIFICANCE_CAVEAT,
  contributionsOf,
  rank,
  type StoryMeasurements,
} from '../news/significance';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * The breaking-news board — item 7.
 *
 * ## Built against fixtures, and that is the spec's instruction
 *
 * GDELT failed **six of six** attempts across a full session and is recorded
 * UNREACHABLE. A ranking engine built on a source that has never once responded
 * is a ranking engine nobody has seen rank anything, so the order is: curated
 * RSS fallback, then this board against fixtures, then wire to real feeds. Per
 * D6 the fixtures are the regression suite — the feed replaces the source, not
 * the tests.
 *
 * ## The caveat is the headline
 *
 * It renders above the cards, not under them, and it says three things: this
 * ranks coverage volume rather than importance, a story the press ignores
 * scores zero, and **whose** coverage — fifteen curated English-language feeds.
 * A reader who assumes a global corpus reads our ceiling as a finding about the
 * world.
 */

interface Story extends StoryMeasurements {
  id: string;
  headline: string;
  note: string;
}

const STORIES = (fixture as { stories: Story[] }).stories;

/**
 * ## Stories from real feed data, when a capture is available
 *
 * The fixtures proved the engine. This proves the INPUTS: outlet breadth,
 * syndication volume and coverage duration recomputed from actual feed items
 * rather than from numbers someone typed.
 *
 * A single captured feed can only ever produce single-source stories, and that
 * is not hidden — every such story renders a marker saying so, because
 * "carried by one outlet" is a fact about our corpus that a reader would
 * otherwise read as a fact about the story's reach.
 */
function storiesFromFeeds(): Story[] {
  const grouped = groupIntoStories(new Map([['rss-npr', parseFeed(nprFeed, 'rss-npr')]]));
  const now = Date.now();

  return grouped.map((story, index) => ({
    id: `feed-${index}`,
    headline: story.headline,
    outlets: story.outlets.length,
    articles: story.articles,
    /**
     * Days of coverage, from the earliest item this app has seen — which is
     * bounded by when we started capturing, not by when the story began. Both
     * halves of that are honest only because the caveat says the corpus is
     * ours.
     */
    days: story.earliest === null ? 0 : Math.max(0, Math.floor((now - Date.parse(story.earliest)) / 86_400_000)),
    countries: story.outlets.length > 0 ? 1 : 0,
    /**
     * NOT CONSULTED, not false. No event index is wired to this board yet, so
     * every story's linkage is unchecked — and question 13's distinction means
     * that is null rather than a `no` the score would treat as evidence.
     */
    linkedToTrackedEvent: null,
    note: '',
  }));
}

export function renderBreakingBoard(): string {
  /**
   * Real feed stories when the capture yields any, fixtures otherwise. The
   * fixtures are not a fallback for missing data — they are the regression
   * suite (D6), and they carry the tie band and corpus-ceiling cases a single
   * live feed cannot produce.
   */
  const fromFeeds = storiesFromFeeds();
  const usingFeeds = fromFeeds.length > 0;
  const stories = usingFeeds ? fromFeeds : STORIES;
  const ranked = rank(stories, (story) => story);

  return `<section class="gov-block breaking">
    <h3>Breaking <span class="badge badge--derived">DERIVED</span></h3>

    <p class="breaking-caveat">${escapeHtml(SIGNIFICANCE_CAVEAT)}</p>

    ${
      /**
       * THE INPUTS-BOUNDED CAVEAT, LIVE ON THE SURFACE.
       *
       * Two of the five inputs cannot exceed what the curated feeds carry, and
       * right now the capture is one feed — so every story is single-source by
       * construction. A reader shown "1 outlet" without this reads a fact about
       * our capture as a fact about the story's reach.
       */
      usingFeeds
        ? `<p class="breaking-bounded gov-caveat"><strong>Ranked from
           ${n(1, 'feeds currently captured, out of the fifteen the curated list names')} of
           ${n(CURATED_FEED_COUNT, 'feeds in the curated list this score is bounded by')} curated
           feeds.</strong> Outlet breadth and syndication volume cannot exceed what has been
           captured, so every story below is single-source — that is a limit of this capture,
           not a measure of how widely the story was covered.</p>`
        : `<p class="breaking-bounded gov-caveat">Ranked from fixtures, not from live feeds.
           These are the regression suite: they carry the tied band and corpus-ceiling cases a
           single captured feed cannot produce.</p>`
    }

    <ol class="breaking-list">
      ${ranked.map((entry) => breakingCard(entry.story, entry.rank, entry.tied, entry.score)).join('')}
    </ol>
  </section>`;
}

function breakingCard(
  story: Story,
  rankNumber: number,
  tied: boolean,
  score: ReturnType<typeof rank>[number]['score'],
): string {
  /**
   * A TIED BAND IS NOT AN ORDERING.
   *
   * The spec forbids presenting near-equal scores as ranks 4, 5, 6. A
   * hundredth of a point between two stories is noise in the inputs, and a
   * confident ordering asserts precision the measurement does not have — so
   * tied cards say "=" and name the tie.
   */
  const rankLabel = tied
    ? `=${n(rankNumber, 'position in the ranking, shared with the other stories in this tied band')}`
    : n(rankNumber, 'position in the ranking computed from the weighted inputs below');

  const unconsulted =
    score.unconsulted.length > 0
      ? `<p class="breaking-shortfall">Ranked from fewer inputs than were consulted:
         ${escapeHtml(score.unconsulted.join(', '))} could not be checked. That is not the same
         as an input that came back empty.</p>`
      : '';

  /**
   * The single-source marker. "Carried by one outlet" is a fact about our
   * corpus, and a reader would otherwise take it for a fact about the story's
   * reach — which is the same confusion the corpus-ceiling caveat exists for,
   * arriving one row at a time.
   */
  const singleSource =
    story.outlets === 1
      ? '<span class="breaking-single">1 outlet — a limit of our capture, not of the coverage</span>'
      : '';

  return `<li class="breaking-card${tied ? ' breaking-card--tied' : ''}">
    <div class="breaking-head">
      <span class="breaking-rank">${rankLabel}</span>
      <span class="breaking-headline">${escapeHtml(story.headline)}</span>
      ${singleSource}
    </div>
    ${tied ? '<p class="breaking-tie">Tied — these scores are within the ranking\'s margin, so their order is not meaningful.</p>' : ''}
    ${unconsulted}
    ${inspector(story, score)}
  </li>`;
}

/**
 * The "why this ranked here" inspector — the relations popover applied to news.
 *
 * It shows the RAW measurement beside its NORMALISED contribution, which is not
 * decoration: rule 22 makes the normalisation part of the score's definition,
 * and a reader has to be able to see that 15 outlets became 1.0 and why.
 */
function inspector(story: Story, score: ReturnType<typeof rank>[number]['score']): string {
  const rows = contributionsOf(story)
    .map((entry) => {
      const raw =
        entry.raw === null
          ? '<span class="fact-nodata">not checked</span>'
          : typeof entry.raw === 'boolean'
            ? escapeHtml(entry.raw ? 'yes' : 'no')
            : `${n(entry.raw, `raw measurement for ${entry.input}, counted from the curated feeds`)} ${escapeHtml(entry.rawUnit)}`;

      const normalised =
        entry.normalised === null
          ? '—'
          : n(Math.round(entry.normalised * 100) / 100, `normalised contribution for ${entry.input}, a unitless 0-1 value this app computes so the inputs can be added at all`);

      return `<tr>
        <td>${escapeHtml(entry.input)}</td>
        <td>${raw}</td>
        <td>${normalised}</td>
        <td>x${n(entry.weight, 'weight applied to this input — this app\'s editable opinion about what counts')}</td>
      </tr>`;
    })
    .join('');

  return `<details class="breaking-why">
    <summary>Why this ranked here</summary>
    <table class="breaking-arith">
      <thead><tr><th>input</th><th>measured</th><th>normalised</th><th>weight</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="gov-caveat">Score
      ${n(Math.round(score.score * 100) / 100, 'the weighted sum of the normalised contributions above')}.
      The inputs are measured in different things — outlets, days, countries — so each is
      normalised to a unitless 0–1 before weighting. Without that the sum would not mean
      anything.</p>
  </details>`;
}
