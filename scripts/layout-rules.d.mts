export interface LayoutBox {
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
  clipsY?: boolean;
  scrollH?: number;
  clientH?: number;
}

export interface LayoutReport {
  rootBox: { x: number; y: number; w: number; h: number };
  kids: LayoutBox[];
}

export function layoutProblems(report: LayoutReport): string[];
