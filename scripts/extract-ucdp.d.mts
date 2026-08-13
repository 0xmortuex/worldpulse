/**
 * Only the parser is declared, because only the parser is exported.
 *
 * The rest of this script is I/O — download, verify the SHA-256 pin, stream,
 * account, write — and it runs behind a direct-invocation guard so an import
 * cannot trigger it. That guard exists because importing this module used to
 * extract the entire dataset as a side effect.
 */
export interface CsvParser {
  push(chunk: string): void;
  end(): void;
}

export function makeCsvParser(onRecord: (record: string[]) => void): CsvParser;
