import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';

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
