import type {
  ColumnDefault,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';

interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId?: string;
  readonly span?: SourceSpan;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface DefaultFunctionLoweringContext {
  readonly sourceId: string;
  readonly modelName: string;
  readonly fieldName: string;
  readonly columnCodecId?: string;
}

export type LoweredDefaultValue =
  | { readonly kind: 'storage'; readonly defaultValue: ColumnDefault }
  | { readonly kind: 'execution'; readonly generated: ExecutionMutationDefaultValue };

export type LoweredDefaultResult =
  | { readonly ok: true; readonly value: LoweredDefaultValue }
  | { readonly ok: false; readonly diagnostic: SourceDiagnostic };

export interface MutationDefaultGeneratorDescriptor {
  readonly id: string;
  /**
   * Codec ids the generator is compatible with when the codec choice
   * and the generator choice are made independently by the contract
   * author. Set when the registry-coherence check is meaningful
   * (the codec and the generator can be paired arbitrarily by the
   * caller); omitted when the generator is only reachable through a
   * descriptor that co-registers a fixed codec, so coherence is
   * structural and the list would be tautological.
   */
  readonly applicableCodecIds?: readonly string[];
  readonly resolveGeneratedColumnDescriptor?: (input: {
    readonly generated: ExecutionMutationDefaultValue;
  }) =>
    | {
        readonly codecId: string;
        readonly nativeType: string;
        readonly typeRef?: string;
        readonly typeParams?: Record<string, unknown>;
      }
    | undefined;
  /**
   * Construct the `onCreate`/`onUpdate` phases value owned by this
   * generator. Authoring layers (PSL `temporal.updatedAt()`, TS field presets) call
   * this instead of building the literal inline so PSL/TS-authored
   * contracts stay byte-equivalent for any future params-bearing generator.
   */
  readonly buildPhases?: (args?: Record<string, unknown>) => ExecutionMutationDefaultPhases;
}

// The typed form of a parsed default-function call: the `fn` discriminant, the call-site span
// (for lowering diagnostics), and the argument record already parsed + validated by the
// function's `funcCall(name, signature)` combinator. Replaces the raw `ParsedDefaultFunctionCall`
// on the registry lowering path — the registry no longer re-parses argument source text.
export interface TypedDefaultFunctionCall {
  readonly fn: string;
  readonly span: SourceSpan;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ControlMutationDefaultEntry {
  // The function's argument signature (a `FuncCallSig` from `@prisma-next/psl-parser`), consumed by
  // the registering family's `buildDefaultSpec` to build a typed `funcCall(name, signature)` arm.
  // Typed `unknown` here because `FuncCallSig` lives in the authoring layer, which the core
  // framework cannot import; the registering family owns the entries and narrows it back.
  readonly signature?: unknown;
  readonly lower: (input: {
    readonly call: TypedDefaultFunctionCall;
    readonly context: DefaultFunctionLoweringContext;
  }) => LoweredDefaultResult;
  readonly usageSignatures?: readonly string[];
}

export type ControlMutationDefaultRegistry = ReadonlyMap<string, ControlMutationDefaultEntry>;

export interface ControlMutationDefaults {
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
}
