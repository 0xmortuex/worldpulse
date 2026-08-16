import fixture from '../../tests/fixtures/news/stories.json';
import {
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

export function renderBreakingBoard(): string {
  const ranked = rank(STORIES, (story) => story);

  return `<section class="gov-block breaking">
    <h3>Breaking <span class="badge badge--derived">DERIVED</span></h3>

    <p class="breaking-caveat">${escapeHtml(SIGNIFICANCE_CAVEAT)}</p>

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

  return `<li class="breaking-card${tied ? ' breaking-card--tied' : ''}">
    <div class="breaking-head">
      <span class="breaking-rank">${rankLabel}</span>
      <span class="breaking-headline">${escapeHtml(story.headline)}</span>
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
