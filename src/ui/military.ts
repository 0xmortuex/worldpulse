import { escapeHtml, factHtml } from '../facts/badge';
import {
  NONE_RECORDED,
  describeCommand,
  describeOverseasPresence,
  describeWarheads,
  forcesSummary,
  type MilitaryProfile,
} from '../dossier/military';
import { loadMilitary } from '../dossier/military-provider';

/**
 * The Military tab.
 *
 * Every branch here exists to serve one of step 8's hard cases, and the module
 * deliberately renders through `src/dossier/military.ts` rather than reaching
 * into the profile itself: the sentences that must not be wrong — "None
 * recorded", the ceremonial qualifier, the undeclared-arsenal wording — are
 * produced by tested functions, not assembled inline where a later edit could
 * quietly drop a qualifier.
 */
export function renderMilitaryTab(iso3: string, countryName: string): string {
  const profile = loadMilitary(iso3);

  if (profile === null) {
    return `<div class="gov">
      <p class="gov-pending"><strong>No military data for ${escapeHtml(countryName)}.</strong>
      Only a few countries have fixtures while the ingest is unconnected.</p>
    </div>`;
  }

  const summary = forcesSummary(profile);

  /**
   * THE ABOLISHED CASE, rendered as a fact about the country rather than a gap
   * in our data. A wall of "no data" here would report our ignorance and
   * attribute it to them.
   */
  if (summary === 'abolished') {
    return `<div class="gov">
      <section class="gov-block">
        <h3>Armed forces</h3>
        <p class="mil-abolished"><strong>${escapeHtml(countryName)} has no armed forces.</strong>
        This is a fact about the country, not missing data.</p>
      </section>
      ${overseasBlock(profile)}
    </div>`;
  }

  const command = describeCommand(profile.command);
  const warheads = describeWarheads(profile);

  return `<div class="gov">
    <section class="gov-block">
      <h3>Personnel and expenditure</h3>
      <div class="gov-row">
        ${
          /**
           * EITHER MAY BE ABSENT, INDEPENDENTLY. Rendering only when both exist
           * would hide half the data; treating a missing half as zero would
           * state a falsehood. Each is emitted on its own terms.
           */
          profile.personnel === null
            ? '<p class="mil-absent">Personnel: not recorded.</p>'
            : factHtml(profile.personnel, { label: 'Active personnel' })
        }
        ${
          profile.expenditure === null
            ? '<p class="mil-absent">Expenditure: not recorded.</p>'
            : factHtml(profile.expenditure, { label: 'Expenditure' })
        }
      </div>
    </section>

    ${
      command === null
        ? ''
        : `<section class="gov-block">
            <h3>Command</h3>
            <p class="mil-command">${escapeHtml(command)}</p>
          </section>`
    }

    ${
      warheads === null
        ? ''
        : `<section class="gov-block">
            <h3>Nuclear warheads</h3>
            <p class="mil-warheads">${escapeHtml(warheads)}</p>
          </section>`
    }

    ${overseasBlock(profile)}
  </div>`;
}

/**
 * Overseas presence — the step's acceptance criterion.
 *
 * The string comes from `describeOverseasPresence` and is never composed here,
 * so the "None recorded" qualifier cannot be dropped by an edit to this file.
 */
function overseasBlock(profile: MilitaryProfile): string {
  const described = describeOverseasPresence(profile.overseasPresence);
  const isNoneRecorded = described === NONE_RECORDED;

  return `<section class="gov-block">
    <h3>Overseas presence</h3>
    <p class="mil-overseas${isNoneRecorded ? ' mil-overseas--none-recorded' : ''}">${escapeHtml(described)}</p>
    ${
      isNoneRecorded
        ? `<p class="gov-note">No deployments were recorded by the sources consulted. That is not
           the same as there being none: deployments a state does not record are exactly the ones
           least likely to appear here.</p>`
        : ''
    }
    ${
      profile.overseasPresence === null || profile.overseasPresence.length === 0
        ? ''
        : `<ul class="mil-deployments">${profile.overseasPresence
            .map(
              (deployment) =>
                `<li>${escapeHtml(deployment.hostName)} — ${escapeHtml(deployment.kind)}
                 ${factHtml(deployment.personnel, { label: 'personnel', hideAsOf: true })}</li>`,
            )
            .join('')}</ul>`
    }
  </section>`;
}
