import type { PslDiagnostic, PslDiagnosticCode } from '@prisma-next/framework-components/psl-ast';
import type { Result } from '@prisma-next/utils/result';
import type { SourceFile } from '../source-file';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { ExpressionAst } from '../syntax/ast/expressions';

/** Flattens an intersection of mapped types into a single readable object type. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export type AttributeLevel = 'field' | 'model' | 'block';

/**
 * Parses one attribute argument from the parser's CST into a value of type `T`,
 * carrying that type at the type level so an attribute's output object can be
 * inferred from its spec.
 *
 * Parsing is pure: a leaf returns its diagnostics in the `Result` rather than
 * pushing them into a shared sink, so an alternative can be tried and discarded
 * without leaving stray errors behind.
 */
export interface ArgType<T> {
  /** Discriminant for visitor dispatch (print, completion, doc generation). */
  readonly kind: string;
  /** Human-readable label, for "expected …" diagnostics. */
  readonly label: string;
  /** Phantom carrier for `T`; never read at runtime. */
  readonly _out?: T;
  parse(arg: ExpressionAst, ctx: InterpretCtx): Result<T, readonly PslDiagnostic[]>;
}

/**
 * The resolution context threaded through every `parse`. It carries the source
 * coordinates the engine anchors diagnostics to (`sourceId` + `sourceFile`) and
 * the PSL symbol-table handles reference combinators resolve against.
 *
 * Deliberately lean: codec-lookup / default-function-registry handles are added
 * only once a combinator needs them, so the kit does not pull those dependencies
 * into the parser layer before they are used.
 */
export interface InterpretCtx {
  readonly level: AttributeLevel;
  /**
   * The code a leaf stamps onto the diagnostics it emits. `interpretAttribute`
   * populates it from the active spec's `diagnosticCode` before calling any
   * leaf, so a combinator emits with the attribute's code rather than a
   * hard-coded generic. When a leaf is exercised directly (outside the engine),
   * the caller sets it.
   */
  readonly diagnosticCode: PslDiagnosticCode;
  /** Identifier of the source the attribute was parsed from; stamped onto diagnostics. */
  readonly sourceId: string;
  /** The parsed source, used to resolve node offsets into diagnostic spans. */
  readonly sourceFile: SourceFile;
  readonly symbols: SymbolTable;
  /** The declaring model; the resolution target for a self-scoped field reference. */
  readonly selfModel: ModelSymbol;
  /** A relation's target model; the resolution target for a referenced-scoped field reference. */
  resolveReferencedModel(): ModelSymbol | undefined;
  /** The resolved declaring field; present only at field level. */
  readonly field?: FieldSymbol;
}

/** An optional parameter, optionally carrying a default applied when the argument is absent. */
export interface OptionalParam<T> {
  readonly optional: true;
  readonly type: ArgType<T>;
  readonly hasDefault: boolean;
  readonly defaultValue?: T;
}

/** A parameter is a bare `ArgType` (required) or an `optional(...)` wrapper. */
export type Param<T> = ArgType<T> | OptionalParam<T>;

export interface PositionalParam<T = unknown> {
  /** The output key this slot writes into. */
  readonly key: string;
  readonly type: Param<T>;
  /** A trailing rest slot that consumes every remaining positional argument. */
  readonly variadic?: boolean;
}

export interface AttributeSpec<Out> {
  readonly level: AttributeLevel;
  readonly name: string;
  readonly positional: readonly PositionalParam[];
  readonly named: Readonly<Record<string, Param<unknown>>>;
  readonly refine?: (parsed: Out, ctx: InterpretCtx) => readonly PslDiagnostic[];
  /**
   * Code for engine-emitted structural diagnostics (unknown argument, excess
   * positional argument, alias conflict). Defaults to `PSL_INVALID_ATTRIBUTE_SYNTAX`;
   * an attribute that must preserve a specific code overrides it here.
   */
  readonly diagnosticCode?: PslDiagnosticCode;
}

export type OutOf<P> =
  P extends OptionalParam<infer T> ? T : P extends ArgType<infer T> ? T : never;

export type NamedOut<N extends Record<string, Param<unknown>>> = Simplify<
  { [K in keyof N as N[K] extends OptionalParam<unknown> ? never : K]: OutOf<N[K]> } & {
    [K in keyof N as N[K] extends OptionalParam<unknown> ? K : never]?: OutOf<N[K]>;
  }
>;

type PosEntryObject<E extends PositionalParam> = E extends { variadic: true }
  ? { [K in E['key']]: readonly OutOf<E['type']>[] }
  : E['type'] extends OptionalParam<unknown>
    ? { [K in E['key']]?: OutOf<E['type']> }
    : { [K in E['key']]: OutOf<E['type']> };

export type PosOut<Pos extends readonly PositionalParam[]> = Simplify<
  UnionToIntersection<{ [I in keyof Pos]: PosEntryObject<Pos[I]> }[number]>
>;

export type AttributeOut<
  Pos extends readonly PositionalParam[],
  Named extends Record<string, Param<unknown>>,
> = Simplify<PosOut<Pos> & NamedOut<Named>>;

export type InferAttr<S extends AttributeSpec<unknown>> =
  S extends AttributeSpec<infer Out> ? Out : never;
