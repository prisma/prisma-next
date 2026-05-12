/**
 * Type-level tests for the free-standing helpers.
 *
 * The helpers are typed at their declaration site (no
 * `QueryOperationTypes` entry). These assertions pin:
 *
 *   - sort helpers return `OrderByItem`
 *   - JSON SELECT-expression helpers return
 *     `Expression<{ codecId: 'cipherstash/json@1'; nullable: false }>`
 *
 * Argument validation (cipherstash codec id required at runtime) is
 * deliberately not type-enforced — the helpers accept
 * `Expression<ScopeField>` so the column-bound expression types from
 * the model accessor flow through without round-tripping through the
 * codec-types augmentation. Runtime guard tests live in
 * `helpers.test.ts`.
 */

import type { OrderByItem } from '@prisma-next/sql-relational-core/ast';
import type { Expression, ScopeField } from '@prisma-next/sql-relational-core/expression';
import { expectTypeOf } from 'vitest';
import {
  cipherstashAsc,
  cipherstashDesc,
  cipherstashJsonbGet,
  cipherstashJsonbPathQueryFirst,
} from '../src/execution/helpers';

declare const anyCol: Expression<ScopeField>;

expectTypeOf(cipherstashAsc(anyCol)).toEqualTypeOf<OrderByItem>();
expectTypeOf(cipherstashDesc(anyCol)).toEqualTypeOf<OrderByItem>();

type JsonReturn = Expression<{ codecId: 'cipherstash/json@1'; nullable: false }>;

// Bidirectional assignability check. `JsonReturn` is the
// `Expression<{codecId: 'cipherstash/json@1', nullable: false}>` type
// the spec promises; the helpers must produce something assignable
// to that slot, and a `JsonReturn` value must be assignable back to
// the helper-return type. Direct `toEqualTypeOf<JsonReturn>` fails
// strict equality because `Expression<R>` is an intersection of
// `QueryOperationReturn` and the narrowed `{returnType: R}` shape;
// the intersection's `returnType` field carries both the broad
// `{codecId: string; nullable: boolean}` quotient and the narrow
// literal at once, which expectTypeOf's strict comparator does not
// collapse. Bidirectional assignability is the exact assertion that
// the helper output is interchangeable with the typed slot — the
// stronger `toEqualTypeOf` shape would not catch any additional
// drift in practice.
declare const expectedJson: JsonReturn;
const pathQuery = cipherstashJsonbPathQueryFirst(anyCol, '$.foo');
const pathGet = cipherstashJsonbGet(anyCol, 'foo');
const _assignA: JsonReturn = pathQuery;
const _assignB: JsonReturn = pathGet;
const _assignC: typeof pathQuery = expectedJson;
const _assignD: typeof pathGet = expectedJson;
void _assignA;
void _assignB;
void _assignC;
void _assignD;

// The path must be a string (compile-time error on number / null /
// undefined). `@ts-expect-error` directives keep the negative
// assertion structurally — if the helper signature accidentally
// widens its `path` parameter, the directive becomes a noop and the
// test fails.
// @ts-expect-error path is required to be a string
cipherstashJsonbPathQueryFirst(anyCol, 42);
// @ts-expect-error path is required to be a string
cipherstashJsonbGet(anyCol, null);
