import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery, KyselyQueryLane } from '@prisma-next/sql-kysely-lane';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, expectTypeOf, it } from 'vitest';
import postgres from '../src/runtime/postgres';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

const db = postgres({
  contract,
  url: 'postgres://localhost:5432/db',
});

describe('build-only api types', () => {
  it('exposes db.kysely as KyselyQueryLane', () => {
    expectTypeOf(db.kysely).toEqualTypeOf<KyselyQueryLane<typeof contract>>();
    expectTypeOf(db.kysely).toHaveProperty('build');
    expectTypeOf(db.kysely).toHaveProperty('whereExpr');
  });

  it('infers plan row type from compiled query', () => {
    type Row = { id: string; kind: 'admin' | 'user' };
    type CompiledRowQuery = { compile(): CompiledQuery<Row> };
    const buildWithCompiledRow: (query: CompiledRowQuery) => SqlQueryPlan<Row> = db.kysely.build;

    expectTypeOf(buildWithCompiledRow).toBeFunction();
    expectTypeOf(buildWithCompiledRow).returns.toExtend<SqlQueryPlan<Row>>();
  });

  it('hides execution methods on lane and query handles', () => {
    const lane = db.kysely;
    const query = lane.selectFrom('user').selectAll();

    expectTypeOf<Extract<'execute' | 'transaction', keyof typeof lane>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<'execute' | 'stream', keyof typeof query>>().toEqualTypeOf<never>();

    expect('execute' in lane).toBe(false);
    expect('transaction' in lane).toBe(false);
    expect('execute' in query).toBe(false);
    expect('stream' in query).toBe(false);
  });
});
