import type {
  ColumnDefault,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';

/**
 * Canonical id for the wall-clock-now mutation default generator.
 *
 * Authoring surfaces (PSL `@updatedAt`, TS `field.updatedAt()`), control
 * descriptors, and runtime generators all reference this id. Centralized
 * here so a future rename or alias is a single edit.
 */
export const TIMESTAMP_NOW_GENERATOR_ID = 'timestampNow' as const;

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

interface DefaultFunctionArgument {
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface ParsedDefaultFunctionCall {
  readonly name: string;
  readonly raw: string;
  readonly args: readonly DefaultFunctionArgument[];
  readonly span: SourceSpan;
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

export type DefaultFunctionLoweringHandler = (input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}) => LoweredDefaultResult;

export interface DefaultFunctionRegistryEntry {
  readonly lower: DefaultFunctionLoweringHandler;
  readonly usageSignatures?: readonly string[];
}

export type DefaultFunctionRegistry = ReadonlyMap<string, DefaultFunctionRegistryEntry>;

export interface MutationDefaultGeneratorDescriptor {
  readonly id: string;
  readonly applicableCodecIds: readonly string[];
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
   * generator. Authoring layers (PSL `@updatedAt`, TS field presets) call
   * this instead of building the literal inline so PSL/TS-authored
   * contracts stay byte-equivalent for any future params-bearing generator.
   */
  readonly buildPhases?: (args?: Record<string, unknown>) => ExecutionMutationDefaultPhases;
}

export interface ControlMutationDefaultEntry {
  readonly lower: (input: {
    readonly call: ParsedDefaultFunctionCall;
    readonly context: DefaultFunctionLoweringContext;
  }) => LoweredDefaultResult;
  readonly usageSignatures?: readonly string[];
}

export type ControlMutationDefaultRegistry = ReadonlyMap<string, ControlMutationDefaultEntry>;

export interface ControlMutationDefaults {
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
}
