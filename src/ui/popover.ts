import type { Country } from '../countries';
import { INPUT_LABELS } from '../relations/score';
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

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * The traceability popover. Everything that produced the classification is
 * listed with its weight, its source and the year its dataset stops being
 * authoritative — a country's colour should never be something the user has to
 * take on trust.
 */
export function relationPopover(country: Country, subject: Country, result: RelationResult): string {
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
      const age = input.stale ? `<span class="pop-age">${input.ageYears}y old</span>` : '';
      const note = input.note ? `<div class="pop-caveat">${escapeHtml(input.note)}</div>` : '';
      return `
        <div class="pop-row${staleClass}">
          <div class="pop-row-main">
            <span class="pop-kind">${escapeHtml(INPUT_LABELS[input.kind])}</span>
            <span class="pop-weight">${signed(input.weight)}</span>
          </div>
          <div class="pop-detail">${escapeHtml(input.label)}</div>
          <div class="pop-meta">
            <span>${escapeHtml(input.source)}</span>
            <span class="pop-coverage">through ${input.coverageEnd}</span>
            ${age}
          </div>
          ${note}
        </div>`;
    })
    .join('');

  const arithmetic = result.inputs.map((input) => signed(input.weight)).join(' ');

  const confidence = result.lowConfidence
    ? `<div class="pop-lowconf">LOW CONFIDENCE — ${Math.round(result.staleWeightShare * 100)}% of the
       evidence weight comes from datasets more than five years old. Treat
       "${escapeHtml(TIER_LABELS[result.tier].toLowerCase())}" as provisional.</div>`
    : '';

  return `<div class="pop">${header}
    <div class="pop-rows">${rows}</div>
    <div class="pop-sum">${escapeHtml(arithmetic)} = <strong>${result.score}</strong>
      → <span class="pop-verdict pop-verdict--${result.tier}">${escapeHtml(TIER_LABELS[result.tier].toUpperCase())}</span></div>
    ${confidence}
    <div class="pop-tier-badge">[DERIVED] — computed by this app from the inputs above, not reported by any source.</div>
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
