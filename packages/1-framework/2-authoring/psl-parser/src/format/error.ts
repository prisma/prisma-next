import type { ParseDiagnostic } from '../parse';

export class PslFormatError extends Error {
  readonly diagnostics: readonly ParseDiagnostic[];

  constructor(diagnostics: readonly ParseDiagnostic[]) {
    const summary = diagnostics[0]?.message ?? 'unknown parse error';
    const more = diagnostics.length > 1 ? ` (and ${diagnostics.length - 1} more)` : '';
    super(`Cannot format PSL with parse errors: ${summary}${more}`);
    this.name = 'PslFormatError';
    this.diagnostics = diagnostics;
  }
}
