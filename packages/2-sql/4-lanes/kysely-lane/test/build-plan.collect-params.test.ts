import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DoNothingConflictAction,
  DoUpdateSetConflictAction,
  InsertAst,
  InsertOnConflict,
  ListLiteralExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
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

/** Columns of the `user` test table, sorted alphabetically, as ProjectionItems. */
const userSelectAllProjection = [
  ProjectionItem.of('email', ColumnRef.of('user', 'email')),
  ProjectionItem.of('id', ColumnRef.of('user', 'id')),
];

describe('buildKyselyPlan', () => {
  it('builds a rich select AST and collects params deterministically', () => {
    const contract = createTestContract();
    const opNode = db
      .selectFrom('user')
      .selectAll()
      .where('id', '=', 'user_123')
      .limit(2)
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);

    expect(plan.ast).toEqual(
      new SelectAst({
        from: new TableSource('user'),
        joins: undefined,
        project: userSelectAllProjection,
        where: BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1)),
        orderBy: undefined,
        distinct: undefined,
        distinctOn: undefined,
        groupBy: undefined,
        having: undefined,
        limit: 2,
        offset: undefined,
        selectAllIntent: { table: 'user' },
      }),
    );
    expect(plan.params).toEqual(['user_123']);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test-profile',
      lane: 'kysely',
      paramDescriptors: [
        {
          index: 1,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
      ],
      refs: {
        tables: ['user'],
        columns: [
          { table: 'user', column: 'email' },
          { table: 'user', column: 'id' },
        ],
      },
      projection: { email: 'email', id: 'id' },
      projectionTypes: { email: 'pg/text@1', id: 'pg/text@1' },
      annotations: {
        codecs: { email: 'pg/text@1', id: 'pg/text@1' },
        selectAllIntent: { table: 'user' },
        limit: 2,
      },
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

    expect(plan.ast).toEqual(
      new SelectAst({
        from: new TableSource('user'),
        joins: undefined,
        project: userSelectAllProjection,
        where: BinaryExpr.in(
          ColumnRef.of('user', 'id'),
          ListLiteralExpr.of([ParamRef.of(1), ParamRef.of(2), ParamRef.of(3)]),
        ),
        orderBy: undefined,
        distinct: undefined,
        distinctOn: undefined,
        groupBy: undefined,
        having: undefined,
        limit: undefined,
        offset: undefined,
        selectAllIntent: { table: 'user' },
      }),
    );
    expect(plan.params).toEqual(['a', 'b', 'c']);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test-profile',
      lane: 'kysely',
      paramDescriptors: [
        {
          index: 1,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
        {
          index: 2,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
        {
          index: 3,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
      ],
      refs: {
        tables: ['user'],
        columns: [
          { table: 'user', column: 'email' },
          { table: 'user', column: 'id' },
        ],
      },
      projection: { email: 'email', id: 'id' },
      projectionTypes: { email: 'pg/text@1', id: 'pg/text@1' },
      annotations: {
        codecs: { email: 'pg/text@1', id: 'pg/text@1' },
        selectAllIntent: { table: 'user' },
      },
    });
  });

  it('transforms multi-row INSERT values into rich insert rows with DEFAULTs', () => {
    const contract = createTestContract();
    const opNode = db
      .insertInto('user')
      .values([{ id: 'u1', email: 'alice@example.com' }, { id: 'u2' }])
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);

    expect(plan.ast).toEqual(
      new InsertAst(new TableSource('user'), [
        {
          id: ParamRef.of(1),
          email: ParamRef.of(2),
        },
        {
          id: ParamRef.of(3),
          email: new DefaultValueExpr(),
        },
      ]),
    );
    expect(plan.params).toEqual(['u1', 'alice@example.com', 'u2']);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test-profile',
      lane: 'kysely',
      paramDescriptors: [
        {
          index: 1,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
        {
          index: 2,
          source: 'lane',
          refs: { table: 'user', column: 'email' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
        {
          index: 3,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
      ],
      refs: {
        tables: ['user'],
        columns: [],
      },
    });
  });

  it('preserves ON CONFLICT for default-values inserts', () => {
    const contract = createTestContract();
    const opNode = db
      .insertInto('user')
      .defaultValues()
      .onConflict((conflict) => conflict.column('id').doNothing())
      .toOperationNode();

    const plan = buildKyselyPlan(contract, opNode);

    expect(plan.ast).toEqual(
      new InsertAst(
        new TableSource('user'),
        [{}],
        new InsertOnConflict([ColumnRef.of('user', 'id')], new DoNothingConflictAction()),
      ),
    );
    expect(plan.params).toEqual([]);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test-profile',
      lane: 'kysely',
      paramDescriptors: [],
      refs: {
        tables: ['user'],
        columns: [{ table: 'user', column: 'id' }],
      },
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

    expect(plan.ast).toEqual(
      new InsertAst(
        new TableSource('user'),
        [
          {
            id: ParamRef.of(1),
            email: ParamRef.of(2),
          },
        ],
        new InsertOnConflict(
          [ColumnRef.of('user', 'id')],
          new DoUpdateSetConflictAction({ email: ColumnRef.of('excluded', 'email') }),
        ),
      ),
    );
    expect(plan.params).toEqual(['u1', 'alice@example.com']);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test-profile',
      lane: 'kysely',
      paramDescriptors: [
        {
          index: 1,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
        {
          index: 2,
          source: 'lane',
          refs: { table: 'user', column: 'email' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
      ],
      refs: {
        tables: ['user'],
        columns: [{ table: 'user', column: 'id' }],
      },
    });
  });

  it('rejects unknown INSERT columns even when a row omits the value', () => {
    const contract = createTestContract();
    const opNode: InsertQueryNode = {
      kind: 'InsertQueryNode',
      into: TableNode.create('user'),
      columns: [ColumnNode.create('id'), ColumnNode.create('emali')],
      values: ValuesNode.create([PrimitiveValueListNode.create(['u1'])]),
    };

    expect(() => buildKyselyPlan(contract, opNode)).toThrow(
      expect.objectContaining({
        code: KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
        message: 'Unknown column "user.emali"',
        details: expect.objectContaining({ table: 'user', column: 'emali' }),
      }),
    );
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

    expect(plan.ast).toEqual(
      new InsertAst(new TableSource('user'), [
        {
          id: ParamRef.of(1),
          email: new DefaultValueExpr(),
        },
      ]),
    );
    expect(plan.params).toEqual(['u1']);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test-profile',
      lane: 'kysely',
      paramDescriptors: [
        {
          index: 1,
          source: 'lane',
          refs: { table: 'user', column: 'id' },
          codecId: 'pg/text@1',
          nativeType: 'text',
          nullable: false,
        },
      ],
      refs: {
        tables: ['user'],
        columns: [],
      },
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

    expect(() => buildKyselyPlan(contract, opNode)).toThrow(
      expect.objectContaining({
        name: KyselyTransformError.ERROR_NAME,
        code: KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
      }),
    );
  });
});
