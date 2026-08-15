export function envTemplateProblems(
  registry: { sources: Array<Record<string, unknown>> },
  templateNames: ReadonlySet<string>,
): string[];
export function templateNames(text: string): Set<string>;
