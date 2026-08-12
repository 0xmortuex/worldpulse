export interface MutationOutcome {
  exit: number;
  out: string;
  expect: RegExp;
}

export interface MutationVerdict {
  verdict: string;
  evidence: string[];
  matched: string[];
  assertions: number | null;
}

export function assertionsRun(out: string): number | null;
export function failingLabels(out: string): string[];
export function classifyMutation(outcome: MutationOutcome): MutationVerdict;
export const INCONCLUSIVE: string[];
