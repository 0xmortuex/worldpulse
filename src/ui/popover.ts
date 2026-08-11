import type { Country } from '../countries';
import { factHtml } from '../facts/badge';
import { notAFact } from '../facts/discipline';
import { INPUT_LABELS, signedWeight } from '../relations/score';
import { scoreFact } from '../relations/provenance';
import type { RelationResult } from '../relations/types';
import { TIER_LABELS } from '../theme';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/**
 * The traceability popover. Everything that produced the classification is
 * listed with its weight, its source and the year its dataset stops being
 * authoritative — a country's colour should never be something the user has to
 * take on trust.
 */
export function relationPopover(
  country: Country,
  subject: Country,
  result: RelationResult,
  compiledAt: string,
): string {
  const header = `
    <div class="pop-head">
      <div class="pop-title">${escapeHtml(country.name)}</div>
      <div class="pop-sub">relative to ${escapeHtml(subject.name)}</div>
    </div>`;

  if (result.tier === 'nodata') {
    return `<div class="pop">${header}
      <div class="pop-verdict pop-verdict--nodata">NO DATA</div>
      <div class="pop-note">No evidence in the fact tables for this pair. This is not a
      claim that no relation exists — only that this app has nothing to show.</div>
    </div>`;
  }

  const rows = result.inputs
    .map((input) => {
      const staleClass = input.stale ? ' pop-row--stale' : '';
      const age = input.stale
        ? `<span class="pop-age">${notAFact(input.ageYears, 'age of the evidence, derived from the coverage year already shown on this row — describes the fact rather than being one')}y old</span>`
        : '';
      const note = input.note ? `<div class="pop-caveat">${escapeHtml(input.note)}</div>` : '';
      return `
        <div class="pop-row${staleClass}">
          <div class="pop-row-main">
            <span class="pop-kind">${escapeHtml(INPUT_LABELS[input.kind])}</span>
            <span class="pop-weight">${signedWeight(input.weight)}</span>
          </div>
          <div class="pop-detail">${escapeHtml(input.label)}</div>
          <div class="pop-meta">
            <span>${escapeHtml(input.source)}</span>
            <span class="pop-coverage">through ${notAFact(input.coverageEnd, 'provenance metadata: the year this input stops being authoritative, shown so the reader can judge the evidence')}</span>
            ${age}
          </div>
          ${note}
        </div>`;
    })
    .join('');

  const arithmetic = result.inputs.map((input) => signedWeight(input.weight)).join(' ');
  const stalePercent = notAFact(
    Math.round(result.staleWeightShare * 100),
    'proportion of the evidence weight that is stale — a property of the calculation shown above, not a value from any source',
  );

  const confidence = result.lowConfidence
    ? `<div class="pop-lowconf">LOW CONFIDENCE — ${stalePercent}% of the
       evidence weight comes from datasets more than five years old. Treat
       "${escapeHtml(TIER_LABELS[result.tier].toLowerCase())}" as provisional.</div>`
    : '';

  return `<div class="pop">${header}
    <div class="pop-rows">${rows}</div>
    <div class="pop-sum">${escapeHtml(arithmetic)} =
      ${factHtml(scoreFact(result, compiledAt), { hideAsOf: true })}
      → <span class="pop-verdict pop-verdict--${result.tier}">${escapeHtml(TIER_LABELS[result.tier].toUpperCase())}</span></div>
    ${confidence}
  </div>`;
}

/** Popover for the neutral globe with no relations mode active. */
export function plainPopover(country: Country): string {
  const codeNote =
    country.codeStatus === 'user-assigned'
      ? `<div class="pop-caveat">Code ${escapeHtml(country.code)} is user-assigned, not ISO 3166-1.</div>`
      : '';
  return `<div class="pop">
    <div class="pop-head">
      <div class="pop-title">${escapeHtml(country.name)}</div>
      <div class="pop-sub">${escapeHtml(country.code)}</div>
    </div>
    ${codeNote}
  </div>`;
}
