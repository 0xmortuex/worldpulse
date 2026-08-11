import seed from '../../data/relations-seed.json';
import type { Finding, InputKind } from './types';
import { pairKey } from './score';

/**
 * Builds the pair -> findings index from the fact tables.
 *
 * Step 1 reads the hand-checked seed file. Step 10 replaces `loadFacts` with
 * live ingests (Wikidata bloc membership, UCDP GED, OFAC/EU sanctions) and
 * deletes the seed; everything downstream of this module is unaffected because
 * the Finding shape is the contract.
 */

interface BlocFact {
  id: string;
  name: string;
  kind: 'defense' | 'intel' | 'economic';
  instrument: string;
  source: string;
  sourceUrl: string;
  coverageEnd: string;
  members: string[];
  note?: string;
}

interface PairFact {
  a: string;
  b: string;
  label: string;
  source: string;
  sourceUrl: string;
  coverageEnd: string;
  note?: string;
}

interface SanctionFact {
  from: string;
  to: string;
  label: string;
  source: string;
  sourceUrl: string;
  coverageEnd: string;
  note?: string;
}

export interface FactSet {
  seed: boolean;
  compiledAt: string;
  notSeeded: string[];
  blocs: BlocFact[];
  bilateralDefenseTreaties: PairFact[];
  historicalAlliances: PairFact[];
  activeConflicts: PairFact[];
  severedRelations: PairFact[];
  sanctions: SanctionFact[];
  territorialDisputes: PairFact[];
}

const BLOC_KIND_TO_INPUT: Record<BlocFact['kind'], InputKind> = {
  defense: 'sharedDefenseBloc',
  intel: 'intelSharing',
  economic: 'sharedEconomicBloc',
};

export function loadFacts(): FactSet {
  return seed as unknown as FactSet;
}

/** Members of a bloc, or the code itself when it is a plain country. */
function expand(code: string, blocs: readonly BlocFact[]): string[] {
  const bloc = blocs.find((candidate) => candidate.id === code);
  return bloc ? bloc.members : [code];
}

export function buildFindings(facts: FactSet): Map<string, Finding[]> {
  const index = new Map<string, Finding[]>();

  const add = (a: string, b: string, finding: Finding): void => {
    if (a === b) return;
    const key = pairKey(a, b);
    const existing = index.get(key);
    if (existing) existing.push(finding);
    else index.set(key, [finding]);
  };

  const asFinding = (kind: InputKind, fact: { label?: string; source: string; sourceUrl: string; coverageEnd: string; note?: string }, label: string): Finding => ({
    kind,
    label,
    source: fact.source,
    sourceUrl: fact.sourceUrl,
    coverageEnd: Number.parseInt(fact.coverageEnd, 10),
    ...(fact.note === undefined ? {} : { note: fact.note }),
  });

  // Blocs: every unordered pair of members shares the bloc.
  for (const bloc of facts.blocs) {
    const kind = BLOC_KIND_TO_INPUT[bloc.kind];
    for (let i = 0; i < bloc.members.length; i += 1) {
      for (let j = i + 1; j < bloc.members.length; j += 1) {
        const a = bloc.members[i];
        const b = bloc.members[j];
        if (a === undefined || b === undefined) continue;
        add(a, b, asFinding(kind, bloc, `${bloc.name} — ${bloc.instrument}`));
      }
    }
  }

  const simplePairs: ReadonlyArray<[InputKind, readonly PairFact[]]> = [
    ['bilateralDefenseTreaty', facts.bilateralDefenseTreaties],
    ['historicalAlliance', facts.historicalAlliances],
    ['activeConflict', facts.activeConflicts],
    ['severedRelations', facts.severedRelations],
    ['territorialDispute', facts.territorialDisputes],
  ];

  for (const [kind, list] of simplePairs) {
    for (const fact of list) add(fact.a, fact.b, asFinding(kind, fact, fact.label));
  }

  // Sanctions are directed. Collapse each country pair into a single finding so
  // the popover reads as one line of evidence rather than two half-lines, and
  // so mutual sanctions are not double-counted as two one-way penalties.
  const directed = new Map<string, SanctionFact[]>();
  for (const fact of facts.sanctions) {
    for (const from of expand(fact.from, facts.blocs)) {
      for (const to of expand(fact.to, facts.blocs)) {
        if (from === to) continue;
        const key = `${from}>${to}`;
        const existing = directed.get(key);
        if (existing) existing.push(fact);
        else directed.set(key, [fact]);
      }
    }
  }

  const handled = new Set<string>();
  for (const [key, entries] of directed) {
    const [from, to] = key.split('>') as [string, string];
    const reverseKey = `${to}>${from}`;
    if (handled.has(key) || handled.has(reverseKey)) continue;
    handled.add(key);

    const reverse = directed.get(reverseKey);
    const fact = entries[0];
    if (fact === undefined) continue;

    if (reverse) {
      handled.add(reverseKey);
      add(from, to, asFinding('mutualSanctions', fact, `Sanctions in both directions (${from} ↔ ${to})`));
    } else {
      add(from, to, asFinding('oneWaySanctions', fact, `${fact.label} (${from} → ${to})`));
    }
  }

  return index;
}
