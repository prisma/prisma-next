import type { ParamDescriptor } from '@prisma-next/contract/types';
import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./plan', async () => {
  const actual = await vi.importActual<typeof import('./plan')>('./plan');
  return {
    ...actual,
    buildKyselyPlan: vi.fn(),
  };
});

import { buildKyselyPlan } from './plan';
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
      post: {
        columns: {
          id: { codecId: 'string', nativeType: 'uuid', nullable: false },
          title: { codecId: 'string', nativeType: 'text', nullable: false },
          userId: { codecId: 'string', nativeType: 'uuid', nullable: false },
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

function createDescriptor(index: number, name: string): ParamDescriptor {
  return {
    index,
    name,
    source: 'lane',
  };
}

function createNestedWhereAst(): SelectAst {
  const derivedUsers = SelectAst.from(TableSource.named('user'))
    .withProject([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'kind'), ParamRef.of(4, 'kind')));

  const derivedPosts = SelectAst.from(TableSource.named('post'))
    .withProject([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'title'), ParamRef.of(5, 'title')));

  const orderedTitleExpr = OperationExpr.function({
    method: 'lower',
    forTypeId: 'pg/text@1',
    self: ColumnRef.of('matching_posts', 'title'),
    args: [ParamRef.of(6, 'fallback')],
    returns: { kind: 'builtin', type: 'string' },
    // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
    template: 'lower(${self}, ${arg0})',
  });

  const existsSubquery = SelectAst.from(DerivedTableSource.as('matching_users', derivedUsers))
    .withJoins([
      JoinAst.left(
        DerivedTableSource.as('matching_posts', derivedPosts),
        BinaryExpr.eq(ColumnRef.of('matching_posts', 'userId'), ParamRef.of(2, 'userId')),
      ),
    ])
    .withProject([
      ProjectionItem.of(
        'items',
        JsonArrayAggExpr.of(
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('id', ColumnRef.of('matching_posts', 'id')),
          ]),
          'emptyArray',
          [OrderByItem.desc(orderedTitleExpr)],
        ),
      ),
    ])
    .withHaving(BinaryExpr.gt(AggregateExpr.count(), ParamRef.of(3, 'minCount')))
    .withOrderBy([OrderByItem.asc(orderedTitleExpr)]);

  return SelectAst.from(TableSource.named('user'))
    .withProject([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(ExistsExpr.exists(existsSubquery));
}

describe('buildKyselyWhereExpr nested AST traversal', () => {
  it('collects and remaps params across nested rich ASTs', () => {
    vi.mocked(buildKyselyPlan).mockReturnValue({
      ast: createNestedWhereAst(),
      params: ['unused', 'join-user-id', 1, 'admin', 'Hello', 'untitled'],
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: coreHash('sha256:test'),
        lane: 'kysely',
        paramDescriptors: [
          createDescriptor(1, 'unused'),
          createDescriptor(2, 'userId'),
          createDescriptor(3, 'minCount'),
          createDescriptor(4, 'kind'),
          createDescriptor(5, 'title'),
          createDescriptor(6, 'fallback'),
        ],
      },
    } as never);

    const bound = buildKyselyWhereExpr(contract, {
      query: {} as never,
      queryId: {} as never,
      sql: '',
      parameters: [],
    } as CompiledQuery<unknown>).toWhereExpr();

    expect(bound.params).toEqual(['join-user-id', 1, 'admin', 'Hello', 'untitled']);
    expect(bound.paramDescriptors.map((descriptor) => descriptor.index)).toEqual([1, 2, 3, 4, 5]);

    expect(bound.expr).toBeInstanceOf(ExistsExpr);
    const exists = bound.expr as ExistsExpr;
    const subquery = exists.subquery;
    expect(subquery.from).toBeInstanceOf(DerivedTableSource);
    expect(((subquery.from as DerivedTableSource).query.where as BinaryExpr).right).toEqual(
      ParamRef.of(3, 'kind'),
    );

    const join = subquery.joins?.[0];
    expect(join?.source).toBeInstanceOf(DerivedTableSource);
    expect((join?.on as BinaryExpr).right).toEqual(ParamRef.of(1, 'userId'));
    expect(((join?.source as DerivedTableSource).query.where as BinaryExpr).right).toEqual(
      ParamRef.of(4, 'title'),
    );

    expect((subquery.having as BinaryExpr).right).toEqual(ParamRef.of(2, 'minCount'));

    const aggregate = subquery.project[0]?.expr;
    expect(aggregate).toBeInstanceOf(JsonArrayAggExpr);
    expect(((aggregate as JsonArrayAggExpr).orderBy?.[0]?.expr as OperationExpr).args[0]).toEqual(
      ParamRef.of(5, 'fallback'),
    );
  });
});
