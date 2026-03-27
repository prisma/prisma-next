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

function createNestedWhereAst(): SelectAst {
  const derivedUsers = SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('user', 'kind'),
        ParamRef.of('admin', { name: 'kind', codecId: 'pg/text@1' }),
      ),
    );

  const derivedPosts = SelectAst.from(TableSource.named('post'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('post', 'title'),
        ParamRef.of('Hello', { name: 'title', codecId: 'pg/text@1' }),
      ),
    );

  const orderedTitleExpr = OperationExpr.function({
    method: 'lower',
    forTypeId: 'pg/text@1',
    self: ColumnRef.of('matching_posts', 'title'),
    args: [ParamRef.of('untitled', { name: 'fallback', codecId: 'pg/text@1' })],
    returns: { kind: 'builtin', type: 'string' },
    // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
    template: 'lower(${self}, ${arg0})',
  });

  const existsSubquery = SelectAst.from(DerivedTableSource.as('matching_users', derivedUsers))
    .withJoins([
      JoinAst.left(
        DerivedTableSource.as('matching_posts', derivedPosts),
        BinaryExpr.eq(
          ColumnRef.of('matching_posts', 'userId'),
          ParamRef.of('join-user-id', { name: 'userId', codecId: 'pg/uuid@1' }),
        ),
      ),
    ])
    .withProjection([
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
    .withHaving(
      BinaryExpr.gt(
        AggregateExpr.count(),
        ParamRef.of(1, { name: 'minCount', codecId: 'pg/int4@1' }),
      ),
    )
    .withOrderBy([OrderByItem.asc(orderedTitleExpr)]);

  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(ExistsExpr.exists(existsSubquery));
}

describe('buildKyselyWhereExpr nested AST traversal', () => {
  it('preserves nested rich AST param refs on the where expression', () => {
    vi.mocked(buildKyselyPlan).mockReturnValue({
      ast: createNestedWhereAst(),
    } as never);

    const bound = buildKyselyWhereExpr(contract, {
      query: {} as never,
      queryId: {} as never,
      sql: '',
      parameters: [],
    } as CompiledQuery<unknown>).toWhereExpr();

    expect(bound).toBeInstanceOf(ExistsExpr);
    const exists = bound as ExistsExpr;
    const subquery = exists.subquery;
    expect(subquery.from.kind).toBe('derived-table-source');
    expect(((subquery.from as DerivedTableSource).query.where as BinaryExpr).right).toEqual(
      ParamRef.of('admin', { name: 'kind', codecId: 'pg/text@1' }),
    );

    const join = subquery.joins?.[0];
    expect(join?.source.kind).toBe('derived-table-source');
    expect((join?.on as BinaryExpr).right).toEqual(
      ParamRef.of('join-user-id', { name: 'userId', codecId: 'pg/uuid@1' }),
    );
    expect(((join?.source as DerivedTableSource).query.where as BinaryExpr).right).toEqual(
      ParamRef.of('Hello', { name: 'title', codecId: 'pg/text@1' }),
    );

    expect((subquery.having as BinaryExpr).right).toEqual(
      ParamRef.of(1, { name: 'minCount', codecId: 'pg/int4@1' }),
    );

    const aggregate = subquery.projection[0]?.expr;
    expect(aggregate).toBeInstanceOf(JsonArrayAggExpr);
    expect(((aggregate as JsonArrayAggExpr).orderBy?.[0]?.expr as OperationExpr).args[0]).toEqual(
      ParamRef.of('untitled', { name: 'fallback', codecId: 'pg/text@1' }),
    );
  });
});
