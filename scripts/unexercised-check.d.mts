export interface UnexercisedInput {
  declaredLayers: string[];
  exercisedLayers: string[];
  liveSourceIds: string[];
  fixtureIds: string[];
}

export interface UnexercisedReport {
  problems: string[];
  declaredLayers: Array<string | undefined>;
  exercisedLayers: string[];
}

export function unexercisedProblems(input: UnexercisedInput): string[];
export function findUnexercised(): Promise<UnexercisedReport>;
