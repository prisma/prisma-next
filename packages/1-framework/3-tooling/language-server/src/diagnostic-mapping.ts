import type { ParseDiagnostic, Range } from '@prisma-next/psl-parser/syntax';

export const ParseDiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export interface LspDiagnostic {
  readonly range: Range;
  readonly message: string;
  readonly code: string;
  readonly severity: number;
}

export function mapParseDiagnostics(
  diagnostics: readonly ParseDiagnostic[],
): readonly LspDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    range: diagnostic.range,
    message: diagnostic.message,
    code: diagnostic.code,
    severity: ParseDiagnosticSeverity.Error,
  }));
}
