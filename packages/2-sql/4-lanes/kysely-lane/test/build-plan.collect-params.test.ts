import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import { buildKyselyPlan } from '../src';

function createTestContract(): SqlContract<SqlStorage> {
  return {
    schemaVersion: 'test@1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test' as never,
    profileHash: 'sha256:test-profile' as never,
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: { codecTypes: {}, operationTypes: {} },
  };
}

const db = new Kysely<Record<string, Record<string, unknown>>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

describe('buildKyselyPlan', () => {
  it('builds a SqlQueryPlan from operation node and collects params deterministically', () => {
    const contract = createTestContract();
    const opNode = db.selectFrom('user').selectAll().where('id', '=', 'user_123').toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as SelectAst;

    expect(plan.meta.lane).toBe('kysely');
    expect(ast.where).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'param', index: 1 },
    });
    expect(plan.params).toEqual(['user_123']);
    expect(plan.meta.paramDescriptors).toHaveLength(1);
    expect(plan.meta.paramDescriptors[0]).toMatchObject({
      index: 1,
      source: 'lane',
      refs: { table: 'user', column: 'id' },
    });
  });

  it('collects list params for IN predicates', () => {
    const contract = createTestContract();
    const opNode = db
      .selectFrom('user')
      .selectAll()
      .where('id', 'in', ['a', 'b', 'c'])
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    expect(plan.params).toEqual(['a', 'b', 'c']);
    expect(plan.meta.paramDescriptors).toHaveLength(3);
  });
});
