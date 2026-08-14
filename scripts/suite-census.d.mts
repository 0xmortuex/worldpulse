export function parseSuiteCounts(tap: string): Record<string, number>;

export function censusProblems(
  baseline: Record<string, number>,
  observed: Record<string, number>,
  declared: Set<string>,
): { problems: string[]; drifted: string[] };

export function declaredSuites(source: string): string[];
