export interface BranchState {
  localHead: string;
  remoteHead: string | null;
  branch: string;
  ahead: number;
  behind: number;
}

export function freshnessProblem(state: BranchState): string | null;
export function readBranchState(runGit: (args: string[]) => Promise<string>): Promise<BranchState>;
