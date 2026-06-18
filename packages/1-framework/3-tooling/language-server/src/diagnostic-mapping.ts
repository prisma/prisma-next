import type { ParseDiagnostic, Range } from '@prisma-next/psl-parser/parser';

// Inlined (mirrors the LSP `DiagnosticSeverity` enum) to keep this module free
// of any `vscode-languageserver` import.
export const ParseDiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

// Structurally compatible with `vscode-languageserver`'s `Diagnostic`, declared
// locally so this module needs no protocol-library import.
export interface LspDiagnostic {
  readonly range: Range;
  readonly message: string;
  readonly code: string;
  readonly severity: number;
}

// The parser already emits zero-based, LSP-shaped ranges, so the range passes
// through unchanged — no offset re-derivation.
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
