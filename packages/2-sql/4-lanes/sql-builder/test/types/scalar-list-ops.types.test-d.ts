/**
 * Integration type-test: a scalar-list operation surfaced through the REAL
 * sql-builder expression machinery.
 *
 * Exercises the actual types the `.where((f, fns) => …)` callback receives:
 * - `FieldProxy<Scope>` turns a `many: true` scope field into a list expression
 * - `Functions<QC>` surfaces the op via `DeriveExtFunctions` (impl verbatim)
 * - the op's generic `<CodecId>` ties the element argument to the list element
 *
 * The op is declared here with the SAME shape as the postgres registry's `has`
 * (descriptor-meta.ts) because sql-builder can't import the adapter layer. The
 * field-proxy / functions / list-expression types are the real ones.
 */

import type {
  CodecExpression,
  CodecIdsWithTrait,
  CodecValue,
  Expression,
  ScalarListExpression,
} from '@prisma-next/sql-relational-core/expression';
import { expectTypeOf, test } from 'vitest';
import type { BooleanCodecType, FieldProxy, Functions } from '../../src/expression';
import type { Scope } from '../../src/scope';

type CmpExpr = Expression<BooleanCodecType>;

type CT = {
  'pg/int4@1': { input: number; output: number; traits: 'equality' | 'order' };
  'pg/text@1': { input: string; output: string; traits: 'equality' | 'order' | 'textual' };
  'pg/bool@1': { input: boolean; output: boolean; traits: 'equality' };
};

type BoolExpr = Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

// Same shape as the real postgres registry entries (`has` plus the six
// list-comparison ops). sql-builder can't import the adapter layer, so the
// list-comparison overloads reach `fns.eq`/`fns.gt`/… through
// `DeriveExtFunctions<QueryOps>` here exactly as they do off the real registry.
type ListCompare<RequiredTraits extends readonly string[]> = <
  CodecId extends CodecIdsWithTrait<CT, RequiredTraits>,
>(
  self: ScalarListExpression<CodecId, false>,
  other: ScalarListExpression<CodecId, false> | readonly CodecValue<CodecId, false, CT>[],
) => BoolExpr;

type QueryOps = {
  has: {
    self: { many: true };
    impl: <CodecId extends keyof CT & string>(
      self: ScalarListExpression<CodecId, false>,
      elem: CodecExpression<CodecId, false, CT>,
    ) => BoolExpr;
  };
  eq: { self: { many: true; elementTraits: ['equality'] }; impl: ListCompare<['equality']> };
  ne: { self: { many: true; elementTraits: ['equality'] }; impl: ListCompare<['equality']> };
  gt: { self: { many: true; elementTraits: ['order'] }; impl: ListCompare<['order']> };
  lt: { self: { many: true; elementTraits: ['order'] }; impl: ListCompare<['order']> };
  gte: { self: { many: true; elementTraits: ['order'] }; impl: ListCompare<['order']> };
  lte: { self: { many: true; elementTraits: ['order'] }; impl: ListCompare<['order']> };
};

// A scope shaped like a `Post` table: scalar `name`, list `tags String[]`,
// list `flags Boolean[]` (element codec lacks the `order` trait).
type PostColumns = {
  name: { codecId: 'pg/text@1'; nullable: false };
  id: { codecId: 'pg/int4@1'; nullable: false };
  tags: { codecId: 'pg/text@1'; nullable: false; many: true };
  flags: { codecId: 'pg/bool@1'; nullable: false; many: true };
};
type PostScope = Scope & {
  topLevel: PostColumns;
  namespaces: { Post: PostColumns };
};

// Structurally a `QueryContext`, but `codecTypes` is the concrete `CT` (no
// `CodecTypesBase` index-signature intersection) so trait resolution
// (`CodecIdsWithTrait`) sees the exact codec ids — matching how a real emitted
// contract threads its concrete `CodecTypes`.
type QC = {
  codecTypes: CT;
  capabilities: Record<string, Record<string, boolean>>;
  queryOperationTypes: QueryOps;
  resolvedColumnOutputTypes: Record<string, never>;
};

declare const f: FieldProxy<PostScope>;
declare const fns: Functions<QC>;

test('a many field surfaces as a list expression on the field proxy', () => {
  expectTypeOf(f.tags).toEqualTypeOf<ScalarListExpression<'pg/text@1', false>>();
  // a scalar field stays a plain (non-list) expression
  expectTypeOf(f.name).toEqualTypeOf<Expression<{ codecId: 'pg/text@1'; nullable: false }>>();
});

test('the list op resolves in a real where-callback body', () => {
  // exactly what `.where((f, fns) => …)` evaluates:
  expectTypeOf(fns.has(f.tags, 'hello')).toEqualTypeOf<BoolExpr>();
  // a matching element expression is accepted too
  fns.has(f.tags, f.name);
});

test('the list op rejects a scalar receiver and a wrong-typed element', () => {
  // @ts-expect-error -- f.name is scalar (no `many: true`), not a list
  fns.has(f.name, 'hello');
  // @ts-expect-error -- element must be text, not a number
  fns.has(f.tags, 5);
});

test('equality builtins accept whole-list operands (literal array or list expression)', () => {
  // a whole-list comparison is always non-null (`BoolExpr`), unlike the scalar
  // builtin whose declared return carries `nullable: boolean` (`CmpExpr`).
  expectTypeOf(fns.eq(f.tags, ['a', 'b'])).toEqualTypeOf<BoolExpr>();
  expectTypeOf(fns.eq(f.tags, f.tags)).toEqualTypeOf<BoolExpr>();
  expectTypeOf(fns.ne(f.tags, ['a'])).toEqualTypeOf<BoolExpr>();
  // a Boolean[] list is comparable by equality (bool carries the `equality` trait)
  fns.eq(f.flags, [true]);
});

test('ordering builtins accept whole-list operands over an orderable element', () => {
  expectTypeOf(fns.gt(f.tags, ['a'])).toEqualTypeOf<BoolExpr>();
  expectTypeOf(fns.gte(f.tags, f.tags)).toEqualTypeOf<BoolExpr>();
  expectTypeOf(fns.lt(f.tags, ['z'])).toEqualTypeOf<BoolExpr>();
  expectTypeOf(fns.lte(f.tags, ['z'])).toEqualTypeOf<BoolExpr>();
});

test('comparison builtins reject a wrong-typed list element', () => {
  // @ts-expect-error -- tags is a text list; the array elements must be strings
  fns.eq(f.tags, [5]);
  // @ts-expect-error -- tags is a text list; the array elements must be strings
  fns.gt(f.tags, [5]);
});

test('ordering builtins reject a list whose element lacks the `order` trait', () => {
  // @ts-expect-error -- flags is a Boolean[]; bool lacks the `order` trait
  fns.gt(f.flags, [true]);
  // @ts-expect-error -- flags is a Boolean[]; bool lacks the `order` trait
  fns.lt(f.flags, f.flags);
});

test('scalar comparison calls are unchanged by the list overloads', () => {
  expectTypeOf(fns.eq(f.id, 1)).toEqualTypeOf<CmpExpr>();
  expectTypeOf(fns.gt(f.id, 1)).toEqualTypeOf<CmpExpr>();
  expectTypeOf(fns.eq(f.name, 'x')).toEqualTypeOf<CmpExpr>();
  // @ts-expect-error -- id is an int scalar; a string is not a valid operand
  fns.eq(f.id, 'nope');
});
