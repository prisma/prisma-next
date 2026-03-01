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
import { buildKyselyPlan } from '../src/internal/build-plan';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from '../src/transform/errors';

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

  it('keeps where param indexing stable with numeric limit input', () => {
    const contract = createTestContract();
    const limitValue = 2;
    const opNode = db
      .selectFrom('user')
      .selectAll()
      .where('id', '=', 'u_1')
      .limit(limitValue)
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as SelectAst;
    const whereExpr = ast.where as { kind: string; right?: { kind: string; index?: number } };

    expect(whereExpr.kind).toBe('bin');
    expect(whereExpr.right).toMatchObject({ kind: 'param', index: 1 });
    expect(plan.params).toEqual(['u_1']);
    expect(plan.meta.paramDescriptors).toHaveLength(1);
    expect(plan.meta.paramDescriptors[0]).toMatchObject({ index: 1 });
  });

  it('runs guardrails on compile-free build path', () => {
    const contract = createTestContract();
    const opNode = db
      .selectFrom('user as u')
      .innerJoin('user as p', 'u.id', 'p.id')
      .selectAll('u')
      .where('id', '=', 'u_1')
      .toOperationNode();

    expect(() => buildKyselyPlan(contract, opNode)).toThrow(KyselyTransformError);

    let caughtError: unknown;
    try {
      buildKyselyPlan(contract, opNode);
    } catch (error) {
      caughtError = error;
    }
    expect(KyselyTransformError.is(caughtError)).toBe(true);
    expect((caughtError as KyselyTransformError).code).toBe(
      KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
    );
  });
});
