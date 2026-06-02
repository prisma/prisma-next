/**
 * Operation type definitions for the SQL family.
 *
 * Type-only twin of the runtime factory in `core/query-operations.ts`.
 * The twin carries the 15 family-level SQL operations the registry
 * registers at execution context construction:
 *
 *   - Equality predicates (trait `equality`): `eq`, `neq`, `in`, `notIn`
 *   - Order predicates (trait `order`): `gt`, `gte`, `lt`, `lte`
 *   - Textual predicate (trait `textual`): `like`
 *   - Null checks (any codec): `isNull`, `isNotNull`
 *   - Boolean composition (no `self`, sql-builder-only): `and`, `or`,
 *     `exists`, `notExists`
 *
 * The binary trait-gated operators follow ADR 203's "How matching works"
 * trait-constrained codec-id generic pattern: the helper types
 * (`EqualityCodecId<CT>` / `OrderCodecId<CT>` / `TextualCodecId<CT>`)
 * resolve to the union of CT codec ids whose `traits` set includes the
 * relevant trait. A user-visible `fns.eq(a, b)` call therefore type-checks
 * only when `a` and `b` share a codec id from the equality-trait subset.
 *
 * The runtime factory uses `satisfies QueryOperationTypes<CT>` so the
 * runtime stays in lock-step with this type-level shape.
 *
 * This file contains **types only**: it imports type-only symbols and
 * carries no runtime code.
 */

import type {
  QueryOperationTypeEntry,
  SqlQueryOperationTypes,
} from '@prisma-next/sql-contract/types';
import type {
  CodecExpression,
  CodecTypesBase,
  Expression,
  ScopeField,
  Subquery,
} from '@prisma-next/sql-relational-core/expression';

/**
 * Return-codec type for every predicate operator in the family. The
 * runtime impls all build expressions whose `returnType.codecId` is
 * `pg/bool@1`; the matching type-level shape pins the boolean codec so
 * predicate detection downstream (the `where(...)` body) can resolve.
 */
type PgBoolReturn = Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

/**
 * Filter helper: the union of CT codec ids whose `traits` set contains
 * every required trait. Mirrors the unexported `CodecIdsWithTrait`
 * helper in `relational-core/src/expression.ts` — the same mechanism
 * ADR 203 documents for `fns.ilike` argument resolution.
 *
 * Gate shape: `[RequiredTraits[number]] extends [T]`. The bracketed
 * form prevents conditional distribution, so the gate reads as "every
 * required trait is present in `T`" — correct whether `T` arrives as a
 * tuple (`readonly ['equality', 'order', 'numeric']`) or as a union
 * (`'equality' | 'order' | 'numeric'`). `ExtractCodecTypes<TContract>`
 * (`relational-core/src/expression.ts`) flattens descriptor `traits`
 * tuples to unions via `DescriptorCodecTraits<D> = TTraits[number] &
 * CodecTrait`, so in every real-contract instantiation `T` is a union;
 * the earlier `T extends readonly string[] ? T[number] : never` gate
 * tripped on that union case and cascaded to `never`. The three
 * exported wrappers below pass a one-element tuple
 * (`readonly ['<trait>']`) so the single-trait callsites read the same
 * as before from the consumer side.
 */
type CodecIdsWithTrait<
  CT extends CodecTypesBase,
  RequiredTraits extends readonly string[],
> = {
  [K in keyof CT & string]: CT[K] extends { readonly traits: infer T }
    ? [RequiredTraits[number]] extends [T]
      ? K
      : never
    : never;
}[keyof CT & string];

/** Codec ids in `CT` declaring the `equality` trait. */
export type EqualityCodecId<CT extends CodecTypesBase> = CodecIdsWithTrait<
  CT,
  readonly ['equality']
>;

/** Codec ids in `CT` declaring the `order` trait. */
export type OrderCodecId<CT extends CodecTypesBase> = CodecIdsWithTrait<CT, readonly ['order']>;

/** Codec ids in `CT` declaring the `textual` trait. */
export type TextualCodecId<CT extends CodecTypesBase> = CodecIdsWithTrait<
  CT,
  readonly ['textual']
>;

/**
 * Flat operation signatures for the SQL family. Composed into the
 * generated `Contract['queryOperationTypes']` via the family control
 * descriptor's `types.queryOperationTypes` slot.
 *
 * Each entry's `self` shape mirrors the runtime registration 1:1:
 *
 *   - Trait-gated entries (the 9 predicates) declare
 *     `self: { traits: [...] }`. Trait dispatch surfaces the method on
 *     every column whose codec id resolves to a CT entry whose `traits`
 *     set includes the gating trait.
 *   - Null-check entries declare `self: { any: true }`, surfacing the
 *     method on every codec regardless of trait.
 *   - Boolean composition entries (`and`, `or`, `exists`, `notExists`)
 *     omit `self` — they are sql-builder-only and never surface as a
 *     column method.
 */
export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    // Equality predicates — trait-gated
    readonly eq: {
      readonly self: { readonly traits: readonly ['equality'] };
      readonly impl: <CodecId extends EqualityCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT> | null,
        b: CodecExpression<CodecId, boolean, CT> | null,
      ) => PgBoolReturn;
    };
    readonly neq: {
      readonly self: { readonly traits: readonly ['equality'] };
      readonly impl: <CodecId extends EqualityCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT> | null,
        b: CodecExpression<CodecId, boolean, CT> | null,
      ) => PgBoolReturn;
    };
    readonly in: {
      readonly self: { readonly traits: readonly ['equality'] };
      readonly impl: {
        <CodecId extends EqualityCodecId<CT>>(
          expr: Expression<{ codecId: CodecId; nullable: boolean }>,
          subquery: Subquery<Record<string, { codecId: CodecId; nullable: boolean }>>,
        ): PgBoolReturn;
        <CodecId extends EqualityCodecId<CT>>(
          expr: Expression<{ codecId: CodecId; nullable: boolean }>,
          values: ReadonlyArray<CodecExpression<CodecId, boolean, CT>>,
        ): PgBoolReturn;
      };
    };
    readonly notIn: {
      readonly self: { readonly traits: readonly ['equality'] };
      readonly impl: {
        <CodecId extends EqualityCodecId<CT>>(
          expr: Expression<{ codecId: CodecId; nullable: boolean }>,
          subquery: Subquery<Record<string, { codecId: CodecId; nullable: boolean }>>,
        ): PgBoolReturn;
        <CodecId extends EqualityCodecId<CT>>(
          expr: Expression<{ codecId: CodecId; nullable: boolean }>,
          values: ReadonlyArray<CodecExpression<CodecId, boolean, CT>>,
        ): PgBoolReturn;
      };
    };

    // Order predicates — trait-gated
    readonly gt: {
      readonly self: { readonly traits: readonly ['order'] };
      readonly impl: <CodecId extends OrderCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT>,
        b: CodecExpression<CodecId, boolean, CT>,
      ) => PgBoolReturn;
    };
    readonly gte: {
      readonly self: { readonly traits: readonly ['order'] };
      readonly impl: <CodecId extends OrderCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT>,
        b: CodecExpression<CodecId, boolean, CT>,
      ) => PgBoolReturn;
    };
    readonly lt: {
      readonly self: { readonly traits: readonly ['order'] };
      readonly impl: <CodecId extends OrderCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT>,
        b: CodecExpression<CodecId, boolean, CT>,
      ) => PgBoolReturn;
    };
    readonly lte: {
      readonly self: { readonly traits: readonly ['order'] };
      readonly impl: <CodecId extends OrderCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT>,
        b: CodecExpression<CodecId, boolean, CT>,
      ) => PgBoolReturn;
    };

    // Textual predicate — trait-gated
    readonly like: {
      readonly self: { readonly traits: readonly ['textual'] };
      readonly impl: <CodecId extends TextualCodecId<CT>>(
        a: CodecExpression<CodecId, boolean, CT>,
        b: CodecExpression<CodecId, boolean, CT>,
      ) => PgBoolReturn;
    };

    // Null checks — any codec
    readonly isNull: {
      readonly self: { readonly any: true };
      readonly impl: (expr: Expression<ScopeField>) => PgBoolReturn;
    };
    readonly isNotNull: {
      readonly self: { readonly any: true };
      readonly impl: (expr: Expression<ScopeField>) => PgBoolReturn;
    };

    // Boolean composition — no `self` (sql-builder-only; not column methods)
    readonly and: {
      readonly impl: (
        ...exprs: ReadonlyArray<CodecExpression<'pg/bool@1', boolean, CT>>
      ) => PgBoolReturn;
    };
    readonly or: {
      readonly impl: (
        ...exprs: ReadonlyArray<CodecExpression<'pg/bool@1', boolean, CT>>
      ) => PgBoolReturn;
    };
    readonly exists: {
      readonly impl: (subquery: Subquery<Record<string, ScopeField>>) => PgBoolReturn;
    };
    readonly notExists: {
      readonly impl: (subquery: Subquery<Record<string, ScopeField>>) => PgBoolReturn;
    };
  }
>;

// Type-only re-export so the structural shape's constraint origin is
// discoverable from this module.
export type { QueryOperationTypeEntry };
