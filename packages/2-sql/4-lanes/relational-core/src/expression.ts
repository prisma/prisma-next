import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { ParamSpec } from '@prisma-next/operations';
import type { QueryOperationReturn } from '@prisma-next/sql-contract/types';
import type { SqlLoweringSpec } from '@prisma-next/sql-operations';
import type { CodecRef } from './ast/codec-types';
import type { AnyExpression as AstExpression } from './ast/types';
import { OperationExpr, ParamRef } from './ast/types';

export type ScopeField = {
  codecId: string;
  nullable: boolean;
  /**
   * Optional {@link CodecRef} derived from contract storage at scope construction time. Builder paths that mint column-bound `ParamRef` / `ProjectionItem` nodes stamp this slot onto the AST so encode/decode dispatch resolves through `contractCodecs.forCodecRef`. Leave `undefined` when the scope was built without contract storage (rare — tests, ad-hoc scopes).
   */
  codec?: CodecRef;
};

export type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

/**
 * A typed SQL expression. Identity is carried by the `returnType` descriptor (inherited from `QueryOperationReturn` and narrowed to `T`) — distinct `T` makes distinct Expression types structurally. `buildAst()` materialises the underlying AST node.
 */
export type Expression<T extends ScopeField> = QueryOperationReturn & {
  readonly returnType: T;
  buildAst(): AstExpression;
};

type CodecIdsWithTrait<
  CT extends Record<string, { readonly input: unknown }>,
  RequiredTraits extends readonly string[],
> = {
  [K in keyof CT & string]: CT[K] extends { readonly traits: infer T }
    ? [RequiredTraits[number]] extends [T]
      ? K
      : never
    : never;
}[keyof CT & string];

type NullSuffix<N> = N extends true ? null : never;

/**
 * Runtime value type for a slot bound to `CodecId` with the given
 * nullability — `CT[CodecId]['input']`, plus `null` when `Nullable` is true.
 */
export type CodecValue<
  CodecId extends string,
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = (CodecId extends keyof CT ? CT[CodecId]['input'] : never) | NullSuffix<Nullable>;

/**
 * An expression or literal value targeting a specific codec.
 *
 * Accepts any of:
 * - An `Expression` whose codec matches exactly
 * - A raw JS value of the codec's `input` type
 * - `null` when `Nullable` is true
 */
export type CodecExpression<
  CodecId extends string,
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = Expression<{ codecId: CodecId; nullable: Nullable }> | CodecValue<CodecId, Nullable, CT>;

/**
 * An expression or literal value targeting any codec whose trait set contains all the required traits.
 *
 * Resolves the trait set to the union of matching codec identities via `CodecIdsWithTrait`, then reuses `CodecExpression` for the codec-id form.
 */
export type TraitExpression<
  Traits extends readonly string[],
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = CodecExpression<CodecIdsWithTrait<CT, Traits>, Nullable, CT>;

/**
 * Resolve a raw value or an Expression into an AST expression node.
 *
 * When `value` is an Expression (duck-typed by its `buildAst` method), the AST it wraps is returned. Otherwise the value is embedded as a ParamRef tagged with the caller-supplied {@link CodecRef} (when known). The runtime resolves the ref via `contractCodecs.forCodecRef(codec)`; content-keyed memoisation collapses repeated lookups for the same logical column onto one shared codec.
 *
 * Operation implementations that compare a column-bound expression to a user value derive the column's {@link CodecRef} from the column-bound side (via {@link codecOf}) and forward it here so encode-side dispatch resolves to the per-instance codec for parameterized codec ids (`vector(1024)` vs. `vector(1536)`).
 */
export function toExpr(value: unknown, codec?: CodecRef): AstExpression {
  if (isExpressionLike(value)) {
    return value.buildAst();
  }
  if (codec === undefined) {
    throw runtimeError(
      'RUNTIME.PARAM_REF_CODEC_REQUIRED',
      `Cannot construct a ParamRef for a ${value === null ? 'null' : typeof value} value without an explicit codec. ` +
        'Provide a CodecRef at the call site or use a column-bound builder path.',
    );
  }
  return ParamRef.of(value, { codec });
}

/**
 * Construct a `ParamRef` for a value whose codec identity is known at call time. Use this when interpolating a value into a raw SQL expression and the codec cannot be inferred from context — e.g. `param(myDate, { codecId: 'pg/timestamptz@1' })`.
 */
export function param<T>(value: T, opts: { codecId: string }): ParamRef {
  return ParamRef.of(value, { codec: { codecId: opts.codecId } });
}

/**
 * Derive the {@link CodecRef} carried by an expression-like value.
 *
 * Resolution order:
 * 1. `wrapper.codec` — explicit column-bound {@link CodecRef} stamped at field-proxy time.
 * 2. `wrapper.returnType.codec` — scope-level codec when the scope was built from contract storage.
 * 3. `{ codecId: wrapper.returnType.codecId }` — minimal ref derived from the expression's declared codec id (covers synthetic expressions like `count()` whose returnType has a known codec id but no explicit column binding).
 *
 * Returns `undefined` for raw scalar values (non-expression-like).
 */
export function codecOf(value: unknown): CodecRef | undefined {
  if (!isExpressionLike(value)) return undefined;
  const wrapper = value as {
    codec?: CodecRef;
    returnType?: { codec?: CodecRef; codecId?: string };
  };
  if (wrapper.codec) return wrapper.codec;
  if (wrapper.returnType?.codec) return wrapper.returnType.codec;
  if (wrapper.returnType?.codecId) return { codecId: wrapper.returnType.codecId };
  return undefined;
}

function isExpressionLike(value: unknown): value is Expression<ScopeField> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof (value as { buildAst: unknown }).buildAst === 'function'
  );
}

export interface BuildOperationSpec<R extends ScopeField> {
  readonly method: string;
  /**
   * The operation's arguments. The first element is the self argument (the value the operation is being applied to); the rest are the remaining user-supplied arguments.
   */
  readonly args: readonly [AstExpression, ...AstExpression[]];
  readonly returns: R & ParamSpec;
  readonly lowering: SqlLoweringSpec;
}

/**
 * Construct an OperationExpr AST node and wrap it as a typed Expression. Operation implementations use this to turn their user-facing arguments into the AST node the compilation pipeline eventually lowers to SQL.
 */
export function buildOperation<R extends ScopeField>(spec: BuildOperationSpec<R>): Expression<R> {
  const [self, ...rest] = spec.args;
  const op = new OperationExpr({
    method: spec.method,
    self,
    args: rest.length > 0 ? rest : undefined,
    returns: spec.returns,
    lowering: spec.lowering,
  });
  return {
    returnType: spec.returns,
    buildAst: () => op,
  };
}
