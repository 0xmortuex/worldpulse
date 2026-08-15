export function secretsIn(
  value: unknown,
  env: Record<string, string | undefined>,
  keyEnvNames: readonly string[],
): string[];

export function secretEnvNames(registry: { sources: Array<Record<string, unknown>> }): string[];
