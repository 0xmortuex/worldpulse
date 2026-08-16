import type { Fact } from '../facts/types';

/**
 * The Military tab's data model, built from step 8's hard cases rather than
 * from a happy path with exceptions bolted on.
 *
 * Every field here exists because a specced hard case would otherwise render a
 * false statement. The types are the argument; the panel is downstream of them.
 */

/**
 * ZERO RECORDED PRESENCE IS NOT ZERO PRESENCE.
 *
 * `BUILD-ORDER.md` step 8 names this as the sharpest form of rule 30, and it is
 * sharper here than anywhere else in the app. In most domains a source reporting
 * zero means zero: World Bank reporting 0 nuclear warheads means none. **Overseas
 * military presence is the domain where that inference fails**, because the
 * things most likely to be unrecorded are precisely the things a state chooses
 * not to record.
 *
 * So an EMPTY list renders "none recorded", not "none". Not because the data is
 * missing — the source was consulted and returned nothing — but because "no
 * deployments were recorded" and "there are no deployments" are different claims
 * and only the first is supportable.
 *
 * `null` is the ordinary no-data state: the source was not consulted or did not
 * answer. Both render without asserting absence; they differ in what the
 * inspector can say about why.
 */
export const NONE_RECORDED = 'None recorded';

export interface Deployment {
  /** Host country ISO 3166-1 alpha-3. */
  hostIso3: string;
  hostName: string;
  personnel: Fact<number>;
  /** UN peacekeeping, bilateral basing, or a coalition — named, never merged. */
  kind: string;
}

/**
 * Who commands, and whether commanding is a real function.
 *
 * ## Two hard cases live in this one type
 *
 * **Ceremonial versus operational.** A constitutional head of state is very
 * often commander-in-chief on paper while operational command sits with a
 * minister or chief of defence. Rendering the ceremonial holder as the
 * commander asserts a chain of command that does not exist, and it is the kind
 * of error that looks authoritative because the title is real.
 *
 * **The same person in two offices.** Where the head of government is also
 * commander-in-chief, a naive render shows them twice as though two people held
 * two posts — or, worse, silently de-duplicates and drops one office entirely.
 * Both are wrong; the panel must say one person holds both.
 */
export interface Command {
  /** As the source names the office, never normalised into a house style. */
  title: string;
  holderName: string | null;
  /**
   * True when the office is constitutional rather than operational.
   *
   * **Undeclared fails closed to ceremonial** (rule 29's polarity): claiming a
   * person operationally commands armed forces is the stronger assertion, and
   * the one that must be earned.
   */
  ceremonial: boolean;
  /** True when this holder is also the head of government. */
  alsoHeadOfGovernment: boolean;
}

/**
 * A state's relationship to the Non-Proliferation Treaty, and what may be said
 * about warheads as a result.
 *
 * ## The hard case: non-NPT and undeclared states
 *
 * FAS publishes warhead ESTIMATES for states that have never declared an
 * arsenal. Rendering an estimate with the confidence of a declaration would
 * assert something no state has said — and for an undeclared state, the estimate
 * is the *entire* claim. The tier and the note both have to carry that, which is
 * why the status is modelled rather than left implicit in a footnote.
 */
export type NuclearStatus =
  | 'npt-nuclear-weapon-state'
  | 'npt-non-nuclear-weapon-state'
  | 'non-npt-declared'
  | 'non-npt-undeclared'
  | 'unknown';

export interface MilitaryProfile {
  iso3: string;
  /**
   * A state with no armed forces at all.
   *
   * Distinct from every figure being absent: Costa Rica having abolished its
   * military is a FACT about Costa Rica, and rendering it as a panel full of
   * "no data" would report our ignorance instead of their constitution.
   */
  hasArmedForces: boolean;
  /** Null when never recorded — never zero as a stand-in. */
  personnel: Fact<number> | null;
  /** Null when never recorded. Independent of personnel: either can be absent. */
  expenditure: Fact<number> | null;
  nuclearStatus: NuclearStatus;
  /** FAS estimate. Present only where someone estimates it; never inferred from status. */
  warheads: Fact<number> | null;
  command: Command | null;
  /** `null` = not consulted. `[]` = consulted, nothing recorded. See NONE_RECORDED. */
  overseasPresence: Deployment[] | null;
}

/**
 * How overseas presence must be described.
 *
 * Returns the exact string a caller may render, so the distinction cannot be
 * lost by a caller writing its own. A test asserts the bare word "none" never
 * escapes this function.
 */
export function describeOverseasPresence(presence: Deployment[] | null): string {
  if (presence === null) return 'Not recorded';
  if (presence.length === 0) return NONE_RECORDED;
  const total = presence.reduce((sum, d) => sum + (d.personnel.value ?? 0), 0);
  const hosts = presence.length === 1 ? '1 host country' : `${presence.length} host countries`;
  return total > 0 ? `${total.toLocaleString('en-US')} personnel across ${hosts}` : hosts;
}

/**
 * What the panel may say about a state's armed forces overall.
 *
 * The three states are genuinely different claims, and collapsing any two of
 * them reports something false:
 *
 *   abolished  the state has no armed forces — a fact about the state
 *   absent     we have no figures — a fact about our data
 *   present    figures exist
 */
export function forcesSummary(profile: MilitaryProfile): 'abolished' | 'absent' | 'present' {
  if (!profile.hasArmedForces) return 'abolished';
  if (profile.personnel === null && profile.expenditure === null) return 'absent';
  return 'present';
}

/**
 * ## The guard an ingest must call before it builds a profile
 *
 * `forcesSummary` reads `!profile.hasArmedForces`, so a field that was never
 * set is **indistinguishable from `false`** — and `false` means "this state
 * has abolished its armed forces", a claim about the country.
 *
 * An ingest that does not populate the field therefore makes the app announce
 * that a country has no army because nobody wrote a boolean. That is emergency
 * 3 in the protocol: a wrong value rendered with confidence, in the register
 * this whole project exists to prevent.
 *
 * It is not hypothetical. Per OPEN-QUESTIONS 31 **no source this app has can
 * supply this field** — the Wikidata route was measured and returns "has armed
 * forces" for Costa Rica, Panama and Iceland — so the live ingest will reach
 * this point with nothing to put in it. The correct behaviour then is to fail,
 * not to default.
 *
 * Exported and total, per rule 32: a guard that can only be reached through a
 * pipeline that does not exist yet is a guard nobody has tested.
 */
export function assertArmedForcesDeclared(
  row: { iso3?: string; hasArmedForces?: unknown },
): asserts row is { iso3?: string; hasArmedForces: boolean } {
  if (typeof row.hasArmedForces !== 'boolean') {
    throw new Error(
      `military ingest: ${row.iso3 ?? 'a country'} has no hasArmedForces value ` +
        `(got ${row.hasArmedForces === undefined ? 'undefined' : JSON.stringify(row.hasArmedForces)}). ` +
        'It must be set explicitly — an unset field reads as "this country abolished its armed ' +
        'forces", which is a claim about the country rather than about our data. See ' +
        'OPEN-QUESTIONS 31: no registered source supplies it.',
    );
  }
}

/**
 * How the command line must read.
 *
 * Returns `null` when there is nothing supportable to say, rather than a
 * placeholder — an empty command line is honest; an invented one is not.
 */
export function describeCommand(command: Command | null): string | null {
  if (command === null || command.holderName === null) return null;

  const role = command.ceremonial
    ? `${command.title} (ceremonial)`
    : command.title;

  // The two-offices case: said once, explicitly, rather than rendered twice.
  return command.alsoHeadOfGovernment
    ? `${command.holderName} — ${role}, also head of government`
    : `${command.holderName} — ${role}`;
}

/**
 * The no-equipment-data card, from `BUILD-ORDER.md` step 8.
 *
 * **This app holds no equipment inventories for any country, and the card says
 * so as a property of the APP rather than of the country.** That distinction is
 * the whole reason it is generated rather than omitted: a Military tab with
 * personnel, expenditure and command but no equipment reads as though the
 * country has no equipment worth listing — an absence the reader fills in
 * themselves, wrongly, because nothing told them the gap is ours.
 *
 * Omitting the card would be the quieter failure, which is why it exists. Rule
 * 30's principle applied to a whole category rather than to one figure: no
 * answer is not an answer of no, including when the question was never asked.
 *
 * It takes no argument because it depends on nothing about the country. If a
 * source is ever connected, this becomes per-country and the signature changes
 * with it — a change that will be visible rather than silent.
 */
export const NO_EQUIPMENT_DATA =
  'This app holds no equipment inventories — no aircraft, vessels, or vehicle counts for any ' +
  'country. That is a gap in what this app has ingested, not a statement about this country’s ' +
  'forces.';

/**
 * What may be claimed about warheads.
 *
 * An undeclared state's figure is an outside estimate and nothing more, and the
 * sentence says so rather than leaving the tier badge to carry it alone — a
 * badge is a glyph, and this is the one number in the app where a reader
 * mistaking an estimate for a declaration would be a serious misreading.
 */
export function describeWarheads(profile: MilitaryProfile): string | null {
  if (profile.warheads === null || profile.warheads.value === null) return null;

  const count = profile.warheads.value.toLocaleString('en-US');
  switch (profile.nuclearStatus) {
    case 'non-npt-undeclared':
      return `${count} — an outside estimate; this state has never declared an arsenal`;
    case 'non-npt-declared':
      return `${count} — estimated; declared arsenal, outside the NPT`;
    case 'npt-nuclear-weapon-state':
      return `${count} — estimated; recognised nuclear-weapon state under the NPT`;
    case 'npt-non-nuclear-weapon-state':
      return `${count} — estimated, for a state that has renounced nuclear weapons under the NPT`;
    case 'unknown':
      return `${count} — estimated; this state's treaty status is not recorded here`;
  }
}
