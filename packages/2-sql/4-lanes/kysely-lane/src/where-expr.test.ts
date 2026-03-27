import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { BinaryExpr, ParamRef } from '@prisma-next/sql-relational-core/ast';
import {
  type CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import { buildKyselyWhereExpr } from './where-expr';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: coreHash('sha256:test'),
  models: {},
  relations: {},
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'string', nativeType: 'uuid', nullable: false },
          kind: { codecId: 'string', nativeType: 'text', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {},
};

type TestDb = {
  user: {
    id: string;
    kind: string;
  };
};

const queryCompiler = new Kysely<TestDb>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

function createSelectWithWhereCompiledQuery(): CompiledQuery<{ id: string }> {
  return queryCompiler
    .selectFrom('user')
    .select('id')
    .where('kind', '=', 'admin')
    .compile() as CompiledQuery<{ id: string }>;
}

function createSelectWithoutWhereCompiledQuery(): CompiledQuery<{ id: string }> {
  return queryCompiler.selectFrom('user').select('id').compile() as CompiledQuery<{ id: string }>;
}

describe('buildKyselyWhereExpr', () => {
  it('returns ToWhereExpr payload for select where filters', () => {
    const whereArg = buildKyselyWhereExpr(contract, createSelectWithWhereCompiledQuery());
    const bound = whereArg.toWhereExpr();
    expect(bound.expr).toBeInstanceOf(BinaryExpr);
    expect((bound.expr as BinaryExpr).right).toEqual(ParamRef.of('admin', { codecId: 'string' }));
  });

  it('throws when select query has no where clause', () => {
    expect(() => buildKyselyWhereExpr(contract, createSelectWithoutWhereCompiledQuery())).toThrow(
      /requires a select query with a where clause/i,
    );
  });
});
