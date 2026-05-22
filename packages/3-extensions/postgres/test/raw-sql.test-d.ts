import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract } from '@prisma-next/contract/types';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { AggregateFunctions, Db, QueryContext } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Expression, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { assertType, test } from 'vitest';

// Minimal stub context — sufficient for type-level tests. The builder reads
// `contract`, `queryOperations`, and `applyMutationDefaults` at runtime, but
// these tests never execute builder methods; they only typecheck the call sites.
// `as unknown as ExecutionContext<...>` is necessary: no real ExecutionContext
// fixture exists in this package, and the types are the only thing under test here.
const stubContext = {} as unknown as ExecutionContext<Contract<SqlStorage>>;

test('fns.rawSql is RawSqlTag (non-optional) through sql() with rawSqlTag', () => {
  const tag = createRawSql(createPostgresAdapter());
  // sql() with rawSqlTag: RawSqlTag returns Db<C, RawSqlTag>.
  // The fns parameter in every select/where/orderBy/groupBy/having callback
  // is AggregateFunctions<QC, RawSqlTag> — rawSql is non-optional and callable.
  const db = sql({ context: stubContext, rawSqlTag: tag });

  // Verify the return type is Db<C, RawSqlTag> — not Db<C> (which defaults to undefined).
  assertType<Db<Contract<SqlStorage>, RawSqlTag>>(db);
});

test('field reference typechecks as rawSql interpolation', () => {
  const tag = createRawSql(createPostgresAdapter());
  // sql() with rawSqlTag returns Db<C, RawSqlTag>. The select callback's fns parameter
  // is AggregateFunctions<QC, RawSqlTag> — fns.rawSql is RawSqlTag, not RawSqlTag | undefined.
  // Cast db only to supply column types for f.name; fns type is the real AggregateFunctions.
  const db = sql({
    context: stubContext,
    rawSqlTag: tag,
  }) as unknown as {
    users: {
      select: (
        alias: string,
        cb: (
          f: { name: Expression<{ codecId: 'pg/text@1'; nullable: false }> },
          fns: AggregateFunctions<QueryContext, RawSqlTag>,
        ) => Expression<{ codecId: string; nullable: boolean }>,
      ) => unknown;
    };
  };

  // f.name is Expression<{codecId: 'pg/text@1'; nullable: false}>, which satisfies
  // RawSqlInterpolation (Expression<ScopeField>). fns.rawSql: RawSqlTag is callable
  // directly as a template tag — no undefined check needed.
  const sel = db.users.select('alias', (f, fns) => fns.rawSql`upper(${f.name})`.returns('pg/text'));
  assertType<unknown>(sel);
});

test('operation result typechecks as rawSql interpolation', () => {
  const tag = createRawSql(createPostgresAdapter());

  // An expression produced by a builder function (e.g. count()) also satisfies
  // RawSqlInterpolation (it is Expression<ScopeField>).
  const countExpr: Expression<{ codecId: 'pg/int8@1'; nullable: false }> = {
    returnType: { codecId: 'pg/int8@1', nullable: false },
    buildAst: () => {
      throw new Error('not called in type tests');
    },
  };

  // Interpolating a typed Expression into rawSql must typecheck without error.
  const built = tag`SELECT ${countExpr}`.returns('pg/int8');
  assertType<Expression<{ codecId: 'pg/int8'; nullable: false }>>(built);
});

test('aggregate result composition typechecks', () => {
  const tag = createRawSql(createPostgresAdapter());
  // sql() with rawSqlTag returns Db<C, RawSqlTag>. The select callback's fns parameter
  // is AggregateFunctions<QC, RawSqlTag> — both rawSql and count are available.
  // Cast db only to supply column types for f.score.
  const db = sql({
    context: stubContext,
    rawSqlTag: tag,
  }) as unknown as {
    users: {
      select: (
        alias: string,
        cb: (
          f: { score: Expression<{ codecId: 'pg/int4@1'; nullable: true }> },
          fns: AggregateFunctions<QueryContext, RawSqlTag>,
        ) => Expression<{ codecId: string; nullable: boolean }>,
      ) => unknown;
    };
  };

  // fns.count(fns.rawSql`...`.returns('pg/int4')) must typecheck: the rawSql
  // expression satisfies the Expression<ScopeField> argument type of count().
  const sel = db.users.select('n', (_f, fns) =>
    fns.count(fns.rawSql`coalesce(score, 0)`.returns('pg/int4')),
  );
  assertType<unknown>(sel);
});
