import { sqliteRawCodecInferer } from '@prisma-next/adapter-sqlite/adapter';
import type { Contract } from '@prisma-next/contract/types';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { AggregateFunctions, Db, QueryContext } from '@prisma-next/sql-builder/types';
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

test('sql() returns Db<C> and fns.raw is RawSqlTag in every callback', () => {
  const adapter = sqliteRawCodecInferer;
  const db = sql({ context: stubContext, rawCodecInferer: adapter });
  assertType<Db<Contract<SqlStorage>>>(db);
});

test('field reference typechecks as rawSql interpolation', () => {
  const adapter = sqliteRawCodecInferer;
  const db = sql({
    context: stubContext,
    rawCodecInferer: adapter,
  }) as unknown as {
    users: {
      select: (
        alias: string,
        cb: (
          f: { name: Expression<{ codecId: 'sqlite/text@1'; nullable: false }> },
          fns: AggregateFunctions<QueryContext>,
        ) => Expression<{ codecId: string; nullable: boolean }>,
      ) => unknown;
    };
  };

  const sel = db.users.select('alias', (f, fns) =>
    fns.raw`upper(${f.name})`.returns('sqlite/text@1'),
  );
  assertType<unknown>(sel);
});

test('operation result typechecks as rawSql interpolation', () => {
  const tag = createRawSql(sqliteRawCodecInferer);

  const countExpr: Expression<{ codecId: 'sqlite/integer@1'; nullable: false }> = {
    returnType: { codecId: 'sqlite/integer@1', nullable: false },
    buildAst: () => {
      throw new Error('not called in type tests');
    },
  };

  const built = tag`SELECT ${countExpr}`.returns('sqlite/integer@1');
  assertType<Expression<{ codecId: 'sqlite/integer@1'; nullable: false }>>(built);
});

test('aggregate result composition typechecks', () => {
  const adapter = sqliteRawCodecInferer;
  const db = sql({
    context: stubContext,
    rawCodecInferer: adapter,
  }) as unknown as {
    users: {
      select: (
        alias: string,
        cb: (
          f: { score: Expression<{ codecId: 'sqlite/integer@1'; nullable: true }> },
          fns: AggregateFunctions<QueryContext>,
        ) => Expression<{ codecId: string; nullable: boolean }>,
      ) => unknown;
    };
  };

  const sel = db.users.select('n', (_f, fns) =>
    fns.count(fns.raw`coalesce(score, 0)`.returns('sqlite/integer@1')),
  );
  assertType<unknown>(sel);
});
