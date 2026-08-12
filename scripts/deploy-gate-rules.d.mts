export interface GateSource {
  id: string;
  verifiedAgainst?: string;
}

export interface GateWorld {
  fixtureIds: Set<string>;
  contractIds: Set<string>;
  bundledEvidence: Record<string, string>;
  evidenceExists: (path: string) => boolean;
}

export interface GateVerdict {
  status: string;
  detail: string;
  problem: string | null;
}

export function verdictFor(source: GateSource, world: GateWorld): GateVerdict;
