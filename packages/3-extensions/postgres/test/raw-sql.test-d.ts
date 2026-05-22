import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract } from '@prisma-next/contract/types';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Expression } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { assertType, test } from 'vitest';

// Minimal stub context — sufficient for type-level tests. The builder reads
// `contract`, `queryOperations`, and `applyMutationDefaults` at runtime, but
// these tests never execute builder methods; they only typecheck the call sites.
// `as unknown as ExecutionContext<...>` is necessary: no real ExecutionContext
// fixture exists in this package, and the types are the only thing under test here.
const stubContext = {} as unknown as ExecutionContext<Contract<SqlStorage>>;

test('field reference typechecks as rawSql interpolation', () => {
  const tag = createRawSql(createPostgresAdapter());
  // sql() returns a deeply-generic proxy type that is opaque to this package; cast to
  // the narrow structural subset that this type-level test exercises.
  const db = sql({
    context: stubContext,
    rawSqlTag: tag,
  }) as unknown as {
    users: {
      select: (
        alias: string,
        cb: (
          f: { name: Expression<{ codecId: 'pg/text@1'; nullable: false }> },
          fns: { rawSql: typeof tag },
        ) => Expression<{ codecId: string; nullable: boolean }>,
      ) => unknown;
    };
  };

  // f.name is Expression<{codecId: 'pg/text@1'; nullable: false}>, which satisfies
  // RawSqlInterpolation (Expression<ScopeField>) — this call must typecheck.
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
  // sql() returns a deeply-generic proxy type that is opaque to this package; cast to
  // the narrow structural subset that this type-level test exercises.
  const db = sql({
    context: stubContext,
    rawSqlTag: tag,
  }) as unknown as {
    users: {
      select: (
        alias: string,
        cb: (
          f: { score: Expression<{ codecId: 'pg/int4@1'; nullable: true }> },
          fns: {
            rawSql: typeof tag;
            count: (
              expr: Expression<{ codecId: string; nullable: boolean }>,
            ) => Expression<{ codecId: 'pg/int8@1'; nullable: false }>;
          },
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
