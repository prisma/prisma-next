import type { PslDiagnostic, PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import type { Result } from '@prisma-next/utils/result';
import type { Simplify, UnionToIntersection } from '@prisma-next/utils/types';
import type { SourceFile } from '../source-file';
import type { FieldSymbol, ModelSymbol } from '../symbol-table';
import type { ExpressionAst } from '../syntax/ast/expressions';

export type AttributeLevel = 'field' | 'model' | 'block';

/**
 * Parsing is pure: a leaf returns its diagnostics in the `Result` rather than
 * pushing them into a shared sink, so an alternative can be tried and discarded
 * without leaving stray errors behind.
 */
export interface ArgType<T> {
  /** Discriminant for visitor dispatch. */
  readonly kind: string;
  readonly label: string;
  /** Phantom carrier for `T`; never read at runtime. */
  readonly _out?: T;
  parse(arg: ExpressionAst, ctx: InterpretCtx): Result<T, readonly PslDiagnostic[]>;
}

/**
 * Deliberately lean: codec-lookup / default-function-registry handles are added
 * only once a combinator needs them, so the kit does not pull those dependencies
 * into the parser layer before they are used.
 */
export interface InterpretCtx {
  readonly level: AttributeLevel;
  /**
   * `interpretAttribute` populates this from the active spec's `diagnosticCode`
   * so a combinator emits with the attribute's code rather than a hard-coded
   * generic.
   */
  readonly diagnosticCode: PslDiagnosticCode;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly selfModel: ModelSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
  readonly field?: FieldSymbol;
}

/**
 * Because it extends `ArgType`, the engine parses an optional parameter directly
 * and detects optionality from the `optional` marker.
 */
export interface OptionalArgType<T> extends ArgType<T> {
  readonly optional: true;
  readonly hasDefault: boolean;
  readonly defaultValue?: T;
}

export type Param<T> = ArgType<T>;

export interface PositionalParam<T = unknown> {
  readonly key: string;
  readonly type: Param<T>;
}

export interface AttributeSpec<Out> {
  readonly level: AttributeLevel;
  readonly name: string;
  readonly positional: readonly PositionalParam[];
  readonly named: Readonly<Record<string, Param<unknown>>>;
  readonly refine?: (parsed: Out, ctx: InterpretCtx) => readonly PslDiagnostic[];
  /**
   * Defaults to `PSL_INVALID_ATTRIBUTE_SYNTAX`; an attribute that must preserve a
   * specific code overrides it here.
   */
  readonly diagnosticCode?: PslDiagnosticCode;
}

export type OutOf<P> = P extends ArgType<infer T> ? T : never;

export type NamedOut<N extends Record<string, Param<unknown>>> = Simplify<
  { [K in keyof N as N[K] extends OptionalArgType<unknown> ? never : K]: OutOf<N[K]> } & {
    [K in keyof N as N[K] extends OptionalArgType<unknown> ? K : never]?: OutOf<N[K]>;
  }
>;

type PosEntryObject<E extends PositionalParam> =
  E['type'] extends OptionalArgType<unknown>
    ? { [K in E['key']]?: OutOf<E['type']> }
    : { [K in E['key']]: OutOf<E['type']> };

export type PosOut<Pos extends readonly PositionalParam[]> = Simplify<
  UnionToIntersection<{ [I in keyof Pos]: PosEntryObject<Pos[I]> }[number]>
>;

export type AttributeOut<
  Pos extends readonly PositionalParam[],
  Named extends Record<string, Param<unknown>>,
> = Simplify<PosOut<Pos> & NamedOut<Named>>;

/**
 * The parameter is intentionally unconstrained: `Out` sits contravariantly in
 * `AttributeSpec.refine`, so a `refine`-carrying `AttributeSpec<Out>` is not
 assignable to `AttributeSpec<unknown>` and a type bound would reject every
 * spec that uses a cross-argument `refine`. Inference still recovers `Out`
 * precisely.
 */
export type InferAttr<S> = S extends AttributeSpec<infer Out> ? Out : never;
