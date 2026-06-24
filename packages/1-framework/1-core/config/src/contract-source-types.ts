import type { Contract } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { CapabilityMatrix } from '@prisma-next/framework-components/components';
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
  /**
   * Merged capability matrix from the control stack's `[target, adapter, ...extensionPacks]`
   * descriptors — the same merge `enrichContract` performs at emit time. Optional so
   * non-adapter authoring paths (tests, bespoke providers) may omit it; an absent matrix
   * means "do not gate". The CLI emit path always populates it.
   */
  readonly capabilities?: CapabilityMatrix;
}

/** Lets format-aware tooling avoid file-extension sniffing and opaque loader introspection. */
export type ContractSourceFormat = 'psl' | 'typescript';

export interface ContractSourceProvider {
  /** Absent means format-aware tooling must leave the source untouched. */
  readonly sourceFormat?: ContractSourceFormat;
  readonly inputs?: readonly string[];
  readonly load: (
    context: ContractSourceContext,
  ) => Promise<Result<Contract, ContractSourceDiagnostics>>;
}
