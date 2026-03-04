import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { InsertAst, SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { ExpressionBuilder, InsertQueryNode } from 'kysely';
import {
  ColumnNode,
  DefaultInsertValueNode,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  PrimitiveValueListNode,
  TableNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
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
    mappings: {},
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

  it('transforms multi-row INSERT values into batched insert rows', () => {
    const contract = createTestContract();
    const opNode = db
      .insertInto('user')
      .values([
        { id: 'u1', email: 'alice@example.com' },
        { id: 'u2', email: 'bob@example.com' },
      ])
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as InsertAst;

    expect(ast.rows).toEqual([
      {
        id: { kind: 'param', index: 1 },
        email: { kind: 'param', index: 2 },
      },
      {
        id: { kind: 'param', index: 3 },
        email: { kind: 'param', index: 4 },
      },
    ]);
    expect(plan.params).toEqual(['u1', 'alice@example.com', 'u2', 'bob@example.com']);
    expect(plan.meta.paramDescriptors).toHaveLength(4);
  });

  it('transforms missing insert cells into DEFAULT values', () => {
    const contract = createTestContract();
    const opNode = db
      .insertInto('user')
      .values([{ id: 'u1', email: 'alice@example.com' }, { id: 'u2' }])
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as InsertAst;

    expect(ast.rows).toEqual([
      {
        id: { kind: 'param', index: 1 },
        email: { kind: 'param', index: 2 },
      },
      {
        id: { kind: 'param', index: 3 },
        email: { kind: 'default' },
      },
    ]);
    expect(plan.params).toEqual(['u1', 'alice@example.com', 'u2']);
  });

  it('rejects unknown INSERT columns even when a row omits the value', () => {
    const contract = createTestContract();
    const opNode: InsertQueryNode = {
      kind: 'InsertQueryNode',
      into: TableNode.create('user'),
      columns: [ColumnNode.create('id'), ColumnNode.create('emali')],
      values: ValuesNode.create([PrimitiveValueListNode.create(['u1'])]),
    };

    let caughtError: unknown;
    try {
      buildKyselyPlan(contract, opNode);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(KyselyTransformError);
    expect(caughtError).toMatchObject({
      code: KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
      message: 'Unknown column "user.emali"',
      details: { table: 'user', column: 'emali' },
    });
  });

  it('keeps DEFAULT insert cells using default expressions after column validation', () => {
    const contract = createTestContract();
    const opNode: InsertQueryNode = {
      kind: 'InsertQueryNode',
      into: TableNode.create('user'),
      columns: [ColumnNode.create('id'), ColumnNode.create('email')],
      values: ValuesNode.create([
        ValueListNode.create([ValueNode.create('u1'), DefaultInsertValueNode.create()]),
      ]),
    };

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as InsertAst;

    expect(ast.rows).toEqual([
      {
        id: { kind: 'param', index: 1 },
        email: { kind: 'default' },
      },
    ]);
    expect(plan.params).toEqual(['u1']);
  });

  it('preserves ON CONFLICT for default-values inserts', () => {
    const contract = createTestContract();
    const opNode = db
      .insertInto('user')
      .defaultValues()
      .onConflict((oc) => oc.column('id').doNothing())
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as InsertAst;

    expect(ast.rows).toEqual([{}]);
    expect(ast.onConflict).toEqual({
      columns: [{ kind: 'col', table: 'user', column: 'id' }],
      action: { kind: 'doNothing' },
    });
    expect(plan.params).toEqual([]);
    expect(plan.meta.refs).toEqual({
      tables: ['user'],
      columns: [{ table: 'user', column: 'id' }],
    });
  });

  it('preserves ON CONFLICT update clauses for inserts', () => {
    const contract = createTestContract();
    const opNode = db
      .insertInto('user')
      .values({ id: 'u1', email: 'alice@example.com' })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          email: (eb: ExpressionBuilder<Record<string, Record<string, unknown>>, 'user'>) =>
            eb.ref('excluded.email'),
        }),
      )
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);
    const ast = plan.ast as InsertAst;

    expect(ast.onConflict).toEqual({
      columns: [{ kind: 'col', table: 'user', column: 'id' }],
      action: {
        kind: 'doUpdateSet',
        set: {
          email: { kind: 'col', table: 'excluded', column: 'email' },
        },
      },
    });
    expect(plan.params).toEqual(['u1', 'alice@example.com']);
    expect(plan.meta.refs).toEqual({
      tables: ['user'],
      columns: [{ table: 'user', column: 'id' }],
    });
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
