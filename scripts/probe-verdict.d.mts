export declare const VERDICT: {
  CLIENT: string;
  WORKER: string;
  KEY: string;
  INCONCLUSIVE: string;
  UNREACHABLE: string;
};

export interface ProbeSourceFacts {
  keyRequired?: boolean;
  keyEnv?: string | null;
  requiresCustomUserAgent?: boolean;
}

export interface Observation {
  status: number;
  ok: boolean;
  cors: Record<string, string>;
  origin: string;
  source: ProbeSourceFacts;
}

export function originIsAllowed(acao: string | undefined, origin: string): boolean;
export function verdictForResponse(observation: Observation): { verdict: string; reason: string };
