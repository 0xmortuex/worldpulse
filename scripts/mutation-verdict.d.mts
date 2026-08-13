export interface MutationOutcome {
  exit: number;
  out: string;
  expect: RegExp;
  /** The mutation's own step, so a skipped step is not scored from another's failures. */
  step?: string;
}

export interface MutationVerdict {
  verdict: string;
  evidence: string[];
  matched: string[];
  assertions: number | null;
}

export function assertionsRun(out: string): number | null;
export function stepWasExercised(out: string, step: string | undefined): boolean | null;
export function failingLabels(out: string): string[];
export function classifyMutation(outcome: MutationOutcome): MutationVerdict;
export const INCONCLUSIVE: string[];

export interface AnchorProblem {
  kind: 'STALE' | 'AMBIGUOUS-ANCHOR';
  detail: string;
}

export function anchorProblem(source: string, from: string): AnchorProblem | null;
