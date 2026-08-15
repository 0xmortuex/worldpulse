export declare const CVD_TYPES: string[];

export function parseHex(hex: string): [number, number, number];
export function simulateCvd(hex: string, type: string): [number, number, number];
export function deltaE(a: readonly number[], b: readonly number[]): number;
export function paletteProblems(
  palette: Record<string, string>,
  options?: { minDeltaE?: number; ignore?: string[][] },
): string[];
