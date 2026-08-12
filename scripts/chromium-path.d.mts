export interface ChromiumInputs {
  envPath: string | undefined;
  pinnedPath: string | null;
  exists: (path: string) => boolean;
  candidates: string[];
}

export interface ChromiumChoice {
  executablePath: string | undefined;
  note: string;
}

export function resolveChromium(inputs: ChromiumInputs): ChromiumChoice;

export function findChromiumCandidates(
  browsersPath: string | undefined,
  fs: { readdirSync: (path: string) => string[]; existsSync: (path: string) => boolean },
  join: (...parts: string[]) => string,
): string[];
