export function glArgs(env?: Record<string, string | undefined>): string[];
export function glLabel(env?: Record<string, string | undefined>): string;
export function isSoftwareRenderer(renderer: string): boolean;
export function describeRenderer(page: { evaluate: (fn: () => string) => Promise<string> }): Promise<string>;
