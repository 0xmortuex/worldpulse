export const MINIMUM_TESTS: number;
export function reportedTestCount(output: string): number | null;
export function judgeTestRun(
  output: string,
  minimum?: number,
): { ok: boolean; ran: number | null; problem: string | null };
