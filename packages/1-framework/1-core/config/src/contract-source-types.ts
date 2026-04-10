import type { Contract } from '@prisma-next/contract/types';
import type { Result } from '@prisma-next/utils/result';

export interface ContractSourceDiagnosticPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface ContractSourceDiagnosticSpan {
  readonly start: ContractSourceDiagnosticPosition;
  readonly end: ContractSourceDiagnosticPosition;
}

export interface ContractSourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId?: string;
  readonly span?: ContractSourceDiagnosticSpan;
  /**
   * Optional structured payload for machine-readable consumers (agents,
   * IDE extensions, CLI auto-fix). Human-readable prose lives in `message`;
   * `data` carries the extracted facts (e.g. `{ namespace: 'pgvector' }`).
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ContractSourceDiagnostics {
  readonly summary: string;
  readonly diagnostics: readonly ContractSourceDiagnostic[];
  readonly meta?: Record<string, unknown>;
}

export interface ContractSourceContext {
  readonly composedExtensionPacks: readonly string[];
}

export type ContractSourceProvider = (
  context: ContractSourceContext,
) => Promise<Result<Contract, ContractSourceDiagnostics>>;
