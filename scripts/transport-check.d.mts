export function transportProblems(
  registry: { sources: Array<Record<string, unknown>> },
  probeResults: Array<{ id: string; verdict: string }>,
): string[];
