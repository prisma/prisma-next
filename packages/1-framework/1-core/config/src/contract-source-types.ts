import type { Contract } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@prisma-next/framework-components/control';
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
  /** Extension contracts keyed by space ID, required for cross-space FK resolution. */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  readonly scalarTypeDescriptors: ReadonlyMap<string, string>;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly codecLookup: CodecLookup;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly resolvedInputs: readonly string[];
}

/**
 * Authoring format of a contract source. Lets format-aware tooling (e.g. the
 * PSL formatter) branch on the source language without sniffing file extensions
 * or inspecting the opaque `load` closure: only `'psl'` sources carry PSL text
 * worth formatting.
 */
export type ContractSourceFormat = 'psl' | 'typescript';

export interface ContractSourceProvider {
  /**
   * Authoring format this provider reads from. Every first-party provider
   * declares it; an absent value is treated as "not known to be PSL" by
   * format-aware tooling, i.e. left untouched.
   */
  readonly sourceFormat?: ContractSourceFormat;
  readonly inputs?: readonly string[];
  readonly load: (
    context: ContractSourceContext,
  ) => Promise<Result<Contract, ContractSourceDiagnostics>>;
}
