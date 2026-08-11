import { escapeHtml, getRegisteredFact } from './badge';
import { getSource, licenseClassNote, licenseIsConstrained, verifiedAgainstNote } from './registry';
import { factState, TIER_EXPLANATIONS, type AnyFact, type Provenance } from './types';

/**
 * The provenance inspector: click any badge, see exactly where the value came
 * from. Request URL, raw response body, fetch timestamp, cache hit or miss, and
 * the source's licence class.
 *
 * This is what makes the badge checkable rather than decorative. A tier claim
 * nobody can audit is just a colour.
 */

export function mountInspector(root: HTMLElement): void {
  const dialog = document.createElement('div');
  dialog.className = 'inspector';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Provenance inspector');
  root.appendChild(dialog);

  const close = (): void => {
    dialog.hidden = true;
    dialog.innerHTML = '';
  };

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const trigger = target?.closest<HTMLElement>('[data-fact]');
    if (trigger) {
      const fact = getRegisteredFact(trigger.dataset['fact'] ?? '');
      if (fact) {
        event.preventDefault();
        event.stopPropagation();
        dialog.innerHTML = renderInspector(fact);
        dialog.hidden = false;
      }
      return;
    }
    if (!dialog.hidden && !target?.closest('.inspector-body')) close();
  });

  // Registered before the app's own Escape handler, and using
  // stopImmediatePropagation rather than stopPropagation: both listeners sit on
  // `document`, so plain stopPropagation would not stop the sibling. Without
  // this, Escape closed the inspector AND cleared the country selection.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) {
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
    }
  });

  dialog.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.inspector-close')) close();
  });
}

function renderInspector(fact: AnyFact): string {
  const state = factState(fact);
  const value =
    fact.value === null
      ? '<em>no data</em>'
      : escapeHtml(fact.format ? fact.format(fact.value) : String(fact.value));

  const brokenBanner =
    state === 'broken'
      ? `<div class="inspector-alarm">
           <strong>UNTRACEABLE VALUE</strong>
           <p>This fact reached the UI without a usable record of where it came from.
           It cannot be audited and must not be trusted. This is a bug in the code
           that produced it, not a property of the data.</p>
         </div>`
      : '';

  return `<div class="inspector-body">
    <header class="inspector-head">
      <div>
        <div class="inspector-eyebrow">Provenance</div>
        <div class="inspector-value">${value}${fact.unit ? ` ${escapeHtml(fact.unit)}` : ''}</div>
      </div>
      <button type="button" class="inspector-close" aria-label="Close inspector">✕</button>
    </header>

    ${brokenBanner}

    <dl class="inspector-grid">
      <dt>Tier</dt><dd><strong>${fact.tier}</strong> — ${escapeHtml(TIER_EXPLANATIONS[fact.tier])}</dd>
      <dt>As of</dt><dd>${escapeHtml(fact.asOf || '—')} <span class="inspector-hint">(the date the data refers to)</span></dd>
      ${fact.note ? `<dt>Note</dt><dd>${escapeHtml(fact.note)}</dd>` : ''}
    </dl>

    ${fact.provenance ? renderProvenance(fact.provenance, 0) : ''}
  </div>`;
}

function renderProvenance(provenance: Provenance, depth: number): string {
  if (provenance.kind === 'unconfigured') {
    const source = getSource(provenance.sourceId);
    return `<section class="inspector-block">
      <h3>Not configured</h3>
      <dl class="inspector-grid">
        <dt>Source</dt><dd>${escapeHtml(source?.name ?? provenance.sourceId)}</dd>
        <dt>Needs</dt><dd><code>${escapeHtml(provenance.keyEnv)}</code></dd>
      </dl>
      <p class="inspector-hint">This panel degrades to "not configured" rather than
      erroring. The rest of the app is unaffected.</p>
    </section>`;
  }

  if (provenance.kind === 'seed') {
    return `<section class="inspector-block">
      <div class="inspector-warn">Hand-checked seed value, not a live source.
      Replaced by a live ingest in step 10.</div>
      <h3>${depth > 0 ? 'Input — ' : ''}Seed fact</h3>
      <dl class="inspector-grid">
        <dt>File</dt><dd><code>${escapeHtml(provenance.file)}</code></dd>
        <dt>Checked against</dt><dd>${escapeHtml(provenance.source)}
          <a href="${escapeHtml(provenance.sourceUrl)}" target="_blank" rel="noreferrer noopener">source</a></dd>
        <dt>Holds through</dt><dd>${provenance.coverageEnd}</dd>
        <dt>Compiled</dt><dd>${escapeHtml(provenance.compiledAt)}</dd>
        ${provenance.note ? `<dt>Caveat</dt><dd>${escapeHtml(provenance.note)}</dd>` : ''}
      </dl>
    </section>`;
  }

  if (provenance.kind === 'derived') {
    return `<section class="inspector-block">
      <h3>Computed by this app</h3>
      <dl class="inspector-grid">
        <dt>Module</dt><dd><code>${escapeHtml(provenance.computedBy)}</code></dd>
        <dt>Arithmetic</dt><dd><code class="inspector-formula">${escapeHtml(provenance.formula)}</code></dd>
        <dt>Computed at</dt><dd>${escapeHtml(provenance.computedAt)}</dd>
      </dl>
      <h4>Inputs (${provenance.inputs.length})</h4>
      ${
        provenance.inputs.length === 0
          ? '<p class="inspector-hint">No inputs recorded — this derivation cannot be audited.</p>'
          : `<div class="inspector-inputs">${provenance.inputs
              .map((input) => renderProvenance(input, depth + 1))
              .join('')}</div>`
      }
    </section>`;
  }

  const source = getSource(provenance.sourceId);
  const raw = formatRaw(provenance.raw);

  const licenceRow = source
    ? `<dt>Licence</dt><dd>
         <strong>${escapeHtml(source.license)}</strong>
         <span class="licence-class licence-class--${source.licenseClass}">${source.licenseClass}</span>
         <div class="inspector-hint">${escapeHtml(licenseClassNote(source.licenseClass))}</div>
       </dd>`
    : '<dt>Licence</dt><dd><em>source id not in the registry</em></dd>';

  const verifiedRow = source
    ? `<dt>Verified against</dt><dd>
         <span class="verified verified--${source.verifiedAgainst}">${source.verifiedAgainst}</span>
         <div class="inspector-hint">${escapeHtml(verifiedAgainstNote(source.verifiedAgainst))}</div>
       </dd>`
    : '';

  return `<section class="inspector-block">
    <h3>${depth > 0 ? 'Input — ' : ''}Request</h3>
    ${provenance.fromFixture ? '<div class="inspector-warn">Served from a hand-authored fixture, not a captured response.</div>' : ''}
    ${source && licenseIsConstrained(source.licenseClass) ? '<div class="inspector-warn">Constrained licence — see below.</div>' : ''}
    <dl class="inspector-grid">
      <dt>Source</dt><dd>${escapeHtml(source?.name ?? provenance.sourceId)}
        ${source ? `<a href="${escapeHtml(source.homepage)}" target="_blank" rel="noreferrer noopener">homepage</a>` : ''}</dd>
      <dt>URL</dt><dd><code class="inspector-url">${escapeHtml(provenance.requestUrl)}</code></dd>
      <dt>HTTP</dt><dd>${provenance.httpStatus}</dd>
      <dt>Fetched at</dt><dd>${escapeHtml(provenance.fetchedAt)}</dd>
      <dt>Cache</dt><dd><span class="cache cache--${provenance.cache}">${provenance.cache}</span></dd>
      <dt>Extracted by</dt><dd><code>${escapeHtml(provenance.extractedBy)}</code></dd>
      ${licenceRow}
      ${verifiedRow}
      ${source?.attribution ? `<dt>Attribution</dt><dd>${escapeHtml(source.attribution)}</dd>` : ''}
    </dl>
    <details class="inspector-raw" ${depth === 0 ? 'open' : ''}>
      <summary>Raw response (${raw.length.toLocaleString('en')} chars)</summary>
      <pre>${escapeHtml(raw)}</pre>
    </details>
  </section>`;
}

function formatRaw(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}
