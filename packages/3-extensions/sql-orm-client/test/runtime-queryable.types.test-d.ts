import type {
  AsyncIterableResult,
  RuntimeExecutor,
} from '@prisma-next/framework-components/runtime';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { Runtime } from '@prisma-next/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type {
  RuntimeConnection,
  RuntimeQueryable,
  RuntimeScope,
  RuntimeTransaction,
} from '../src/types';

type SqlPlanUnion = SqlExecutionPlan | SqlQueryPlan;
type CanonicalScope = Pick<RuntimeExecutor<SqlPlanUnion>, 'execute'>;

test('RuntimeScope is mutually assignable with the canonical RuntimeExecutor execute surface', () => {
  const scope = {} as RuntimeScope;
  const canonical = {} as CanonicalScope;
  expectTypeOf(scope).toExtend<CanonicalScope>();
  expectTypeOf(canonical).toExtend<RuntimeScope>();
});

test('RuntimeQueryable extends RuntimeScope with optional SQL-domain connection/transaction methods', () => {
  const queryable = {} as RuntimeQueryable;
  expectTypeOf(queryable).toExtend<RuntimeScope>();
  expectTypeOf<RuntimeQueryable['connection']>().toEqualTypeOf<
    (() => Promise<RuntimeConnection>) | undefined
  >();
  expectTypeOf<RuntimeQueryable['transaction']>().toEqualTypeOf<
    (() => Promise<RuntimeTransaction>) | undefined
  >();
});

test('RuntimeConnection and RuntimeTransaction inherit the canonical execute surface', () => {
  const connection = {} as RuntimeConnection;
  const transaction = {} as RuntimeTransaction;
  expectTypeOf(connection).toExtend<CanonicalScope>();
  expectTypeOf(transaction).toExtend<CanonicalScope>();
});

test('SQL Runtime is structurally assignable to RuntimeQueryable', () => {
  const runtime = {} as Runtime;
  expectTypeOf(runtime).toExtend<RuntimeQueryable>();
});

test('RuntimeScope.execute infers Row from a plan whose phantom _row is bound', () => {
  type Row = { id: number; name: string };
  const plan = {} as SqlQueryPlan<Row>;
  const scope = {} as RuntimeScope;
  expectTypeOf(scope.execute(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
});

test('RuntimeScope.execute accepts a pre-lowered SqlExecutionPlan with a row binding', () => {
  type Row = { count: number };
  const plan = {} as SqlExecutionPlan<Row>;
  const scope = {} as RuntimeScope;
  expectTypeOf(scope.execute(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
});
