import forms from '../../data/government-forms.json';
import overridesFile from '../../data/leader-overrides.json';
import type { CountryDossierRecord, PersonRecord } from '../sources/wikidata-dossier';

/**
 * Leader resolution: which portrait leads the dossier header.
 *
 * The rules run in the order the spec sets out, and the resolution ALWAYS
 * reports which rule fired. A header that shows a face without saying why that
 * face was chosen is making an editorial claim invisibly.
 *
 * Two things this deliberately will not do:
 *
 *   - Normalise an office title. A junta leader is shown as "Chairman,
 *     Transitional Military Council" if that is the title in use. Smoothing it
 *     to "President" would launder a coup into a constitutional office.
 *   - Guess when the form of government is unrecognised. That yields the
 *     `undetermined` class, which says so on the header.
 */

export type ResolutionClass =
  | 'de-facto-authority'
  | 'presidential'
  | 'parliamentary-republic'
  | 'parliamentary-monarch'
  | 'executive-monarchy'
  | 'transitional'
  | 'undetermined'
  | 'no-data';

export interface ResolvedPortrait {
  person: PersonRecord;
  /** Verbatim office title, or an explicit absence. Never a generic "Leader". */
  title: string | null;
  /** What this portrait is, for the caption: "Head of government", etc. */
  role: string;
}

export interface LeaderResolution {
  class: ResolutionClass;
  ruleNumber: number;
  /** Shown in the UI so the user can see which rule fired. */
  ruleLabel: string;
  /** Why this rule fired, in one sentence. */
  ruleReason: string;
  primary: ResolvedPortrait | null;
  /** Ceremonial or formal counterpart, rendered smaller and labelled. */
  secondary: ResolvedPortrait | null;
  /** Non-fatal problems worth showing the user. */
  warnings: string[];
  /** Set when a reviewed override drove the decision. */
  override?: {
    reason: string;
    source: string;
    sourceUrl: string;
    reviewedAt: string;
  };
}

interface FormRule {
  class: ResolutionClass;
  ruleNumber: number;
  contains: string[];
  qids: string[];
  note?: string;
}

interface OverrideEntry {
  rule: string;
  authorityOfficeQid: string;
  expectedOfficeLabel: string;
  reason: string;
  source: string;
  sourceUrl: string;
  reviewedAt: string;
  qidVerified: boolean;
  qidNote?: string;
}

const FORM_RULES = (forms as unknown as { rules: FormRule[] }).rules;
const OVERRIDES = (overridesFile as unknown as { overrides: Record<string, OverrideEntry> }).overrides;

export function overrideFor(iso3: string): OverrideEntry | undefined {
  const entry = OVERRIDES[iso3];
  if (!entry) return undefined;
  // An override without a citation and a review date is an opinion, not a
  // reviewed correction, and is ignored rather than trusted.
  if (!entry.source || !entry.sourceUrl || !entry.reviewedAt) return undefined;
  return entry;
}

/** Office Q-id to inject into the SPARQL query for this country, if any. */
export function authorityOfficeFor(iso3: string): string | undefined {
  return overrideFor(iso3)?.authorityOfficeQid;
}

export function classifyForm(formLabel: string | null): FormRule | null {
  if (!formLabel) return null;
  const label = formLabel.toLowerCase();
  return FORM_RULES.find((rule) => rule.contains.every((needle) => label.includes(needle))) ?? null;
}

function portrait(person: PersonRecord, role: string): ResolvedPortrait {
  return { person, title: person.officeTitle, role };
}

export function resolveLeader(iso3: string, record: CountryDossierRecord): LeaderResolution {
  const warnings: string[] = [];
  const hos = record.headOfState;
  const hog = record.headOfGovernment;

  /**
   * Refuse before resolving, when the head of state is not a single identified
   * person. Both branches below are WRONG-VALUE guards, not missing-data ones:
   * each prevents rendering something confidently false rather than something
   * empty, which is the ordering rule 7 sets.
   */

  // Not a person at all. Switzerland's P35 resolves to the Swiss Federal Council
  // and Haiti's to the Transitional Presidential Council — bodies, not people —
  // and the parser cannot tell an institution's name from a human's. Rendering
  // one in a portrait frame states that an institution is a person.
  if (!record.headOfStateIsPerson) {
    return {
      class: 'undetermined',
      ruleNumber: 0,
      ruleLabel: 'Head of state is not a person',
      ruleReason:
        `Wikidata records "${hos?.name ?? 'the head of state'}" as this country's head of state, ` +
        'and it is an institution rather than a person. This app will not render a body as an ' +
        'individual, so no primary portrait is shown.',
      primary: null,
      secondary: null,
      warnings: [...warnings, 'A collective or institutional head of state needs a reviewed rule-1 override with a constitutional citation.'],
    };
  }

  /**
   * More than one concurrent holder. NEVER pick one.
   *
   * The count alone cannot distinguish a constitutionally collective head of
   * state from a stale statement: a survey of live data found 15 countries with
   * multiple concurrent holders, of which roughly three are genuine (San Marino,
   * Bosnia, Andorra) and twelve are former holders with no end date — Australia,
   * Bulgaria, Hungary and Albania among them. That is roughly four artifacts for
   * every real arrangement, so a rule keyed on count would be wrong about most
   * of the cases it fired on.
   *
   * Taking the first row is worse than wrong, it is UNSTABLE: SPARQL guarantees
   * no ordering, so the same country could render a different leader between two
   * loads of the same page.
   *
   * Only a cited expected count can license a collective rendering, and that
   * count is never inferred from the data — inferring it would be the post-hoc
   * rule this project already refused, in a smaller costume.
   */
  /**
   * Several forms of government. Refuse, exactly as for several heads of state.
   *
   * `first('formLabel')` was a coin flip: Afghanistan returns Emirate, islamic
   * theocracy and unitary state, which classify differently from one another, and
   * SPARQL guarantees no ordering — so the rendered classification could differ
   * between two loads of the same country. Naming all of them is more useful than
   * picking one, and honest about the disagreement being in the source.
   */
  if (record.formLabels.length > 1) {
    return {
      class: 'undetermined',
      ruleNumber: 0,
      ruleLabel: `Wikidata records ${record.formLabels.length} forms of government`,
      ruleReason:
        `Wikidata gives this country more than one form of government — ` +
        `${record.formLabels.map((label) => `"${label}"`).join(', ')} — and they do not ` +
        'classify alike. This app will not pick one: the query returns them in no ' +
        'guaranteed order, so the choice would not be stable between page loads.',
      primary: null,
      secondary: null,
      warnings: [...warnings, 'A country with several recorded forms needs a reviewed override naming which applies.'],
    };
  }

  if (record.headOfStateHolderCount > 1) {
    return {
      class: 'undetermined',
      ruleNumber: 0,
      ruleLabel: `Multiple concurrent heads of state (${record.headOfStateHolderCount})`,
      ruleReason:
        `Wikidata returns ${record.headOfStateHolderCount} people as concurrent head of state with no end date. ` +
        'That is either a collective head of state or a former holder whose record was never closed, ' +
        'and the data cannot tell those apart. This app will not choose one arbitrarily — the query ' +
        'returns them in no guaranteed order, so choosing would not even be stable between page loads.',
      primary: null,
      secondary: null,
      warnings: [
        ...warnings,
        'Resolving this needs a reviewed override stating the constitutionally expected number of holders, with a citation.',
      ],
    };
  }

  // ---- Rule 1: a reviewed de facto authority above the formal head of state.
  const override = overrideFor(iso3);
  if (override) {
    if (record.authority) {
      if (
        override.expectedOfficeLabel &&
        record.authority.officeTitle &&
        record.authority.officeTitle !== override.expectedOfficeLabel
      ) {
        warnings.push(
          `The override expected the office "${override.expectedOfficeLabel}" but Wikidata returned ` +
            `"${record.authority.officeTitle}". The override may be out of date.`,
        );
      }
      return {
        class: 'de-facto-authority',
        ruleNumber: 1,
        ruleLabel: 'Rule 1 — de facto authority above the formal head of state',
        ruleReason:
          'A reviewed override records that this office outranks the formal head of state, ' +
          'which the Wikidata office hierarchy does not express.',
        primary: portrait(record.authority, 'Supreme authority'),
        secondary: hos ? portrait(hos, 'Formal head of state') : null,
        warnings,
        override: {
          reason: override.reason,
          source: override.source,
          sourceUrl: override.sourceUrl,
          reviewedAt: override.reviewedAt,
        },
      };
    }
    // The override exists but its office returned no holder. Fall through to the
    // normal rules rather than showing nothing — but say so loudly, because the
    // header is now knowingly showing the subordinate office.
    warnings.push(
      `A reviewed override says a supreme authority outranks the head of state here, but the ` +
        `office query (${override.authorityOfficeQid}) returned no holder. The portrait below may ` +
        `understate who actually holds power.`,
    );
  }

  if (!hos && !hog) {
    return {
      class: 'no-data',
      ruleNumber: 0,
      ruleLabel: 'No leader data',
      ruleReason: 'Wikidata records neither a current head of state nor a head of government for this country.',
      primary: null,
      secondary: null,
      warnings,
    };
  }

  const form = classifyForm(record.formLabel);

  // ---- Rules 2-5, by form of government.
  if (form) {
    switch (form.class) {
      case 'presidential':
        // Rule 2. In a semi-presidential system a prime minister also exists;
        // the president holds executive power, so leads.
        return {
          class: 'presidential',
          ruleNumber: 2,
          ruleLabel: 'Rule 2 — presidential system, head of state leads',
          ruleReason: `Form of government recorded as "${record.formLabel}".`,
          primary: hos ? portrait(hos, 'Head of state') : portrait(hog as PersonRecord, 'Head of government'),
          secondary: hos && hog && hog.qid !== hos.qid ? portrait(hog, 'Head of government') : null,
          warnings: hos ? warnings : [...warnings, 'No head of state recorded; showing the head of government instead.'],
        };

      case 'parliamentary-republic':
      case 'parliamentary-monarch': {
        // Rule 3. Head of government leads; the ceremonial head of state gets a
        // smaller secondary portrait. Both are labelled with their real office.
        const ceremonialRole = form.class === 'parliamentary-monarch' ? 'Monarch (ceremonial)' : 'Head of state (ceremonial)';
        if (!hog) {
          warnings.push('No head of government recorded, so the ceremonial head of state is shown as primary.');
          return {
            class: form.class,
            ruleNumber: 3,
            ruleLabel: 'Rule 3 — parliamentary system, head of government leads',
            ruleReason: `Form of government recorded as "${record.formLabel}", but no head of government was returned.`,
            primary: portrait(hos as PersonRecord, ceremonialRole),
            secondary: null,
            warnings,
          };
        }
        return {
          class: form.class,
          ruleNumber: 3,
          ruleLabel: 'Rule 3 — parliamentary system, head of government leads',
          ruleReason: `Form of government recorded as "${record.formLabel}". The head of state is ceremonial.`,
          primary: portrait(hog, 'Head of government'),
          secondary: hos ? portrait(hos, ceremonialRole) : null,
          warnings,
        };
      }

      case 'executive-monarchy':
        // Rule 4.
        return {
          class: 'executive-monarchy',
          ruleNumber: 4,
          ruleLabel: 'Rule 4 — monarch holds executive power and leads',
          ruleReason: `Form of government recorded as "${record.formLabel}".`,
          primary: hos ? portrait(hos, 'Monarch') : portrait(hog as PersonRecord, 'Head of government'),
          secondary: hos && hog && hog.qid !== hos.qid ? portrait(hog, 'Head of government') : null,
          warnings,
        };

      case 'transitional':
        // Rule 5. The title is whatever is actually in use.
        return {
          class: 'transitional',
          ruleNumber: 5,
          ruleLabel: 'Rule 5 — transitional or military government',
          ruleReason:
            `Form of government recorded as "${record.formLabel}". The title below is the one in ` +
            'use and has not been normalised to a constitutional office.',
          primary: hos ? portrait(hos, 'Acting leader') : portrait(hog as PersonRecord, 'Acting head of government'),
          secondary: hos && hog && hog.qid !== hos.qid ? portrait(hog, 'Head of government') : null,
          warnings,
        };

      default:
        break;
    }
  }

  // ---- No rule matched. Say so rather than picking one.
  warnings.push(
    record.formLabel
      ? `Form of government "${record.formLabel}" does not match any classification rule.`
      : 'Wikidata records no form of government for this country.',
  );
  return {
    class: 'undetermined',
    ruleNumber: 0,
    ruleLabel: 'Form of government undetermined',
    ruleReason:
      'No classification rule matched, so this app cannot say which office leads. ' +
      'The portrait below is whichever office was recorded, not a judgement about who holds power.',
    primary: hos ? portrait(hos, 'Head of state') : portrait(hog as PersonRecord, 'Head of government'),
    secondary: hos && hog && hog.qid !== hos.qid ? portrait(hog, 'Head of government') : null,
    warnings,
  };
}
