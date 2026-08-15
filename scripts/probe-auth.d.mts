export function keyedProbeUrl(
  source: Record<string, unknown>,
  env: Record<string, string | undefined>,
): { url: string; keyed: boolean; reason: string | null };

export function redactKeys(
  text: string,
  env: Record<string, string | undefined>,
  keyEnvNames: readonly string[],
): string;
