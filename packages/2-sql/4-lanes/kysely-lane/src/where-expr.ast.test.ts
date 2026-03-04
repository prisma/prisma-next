import { coreHash } from '@prisma-next/contract/types';
import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  createAggregateExpr,
  createBinaryExpr,
  createColumnRef,
  createDerivedTableSource,
  createExistsExpr,
  createJsonArrayAggExpr,
  createJsonObjectEntry,
  createJsonObjectExpr,
  createOrderByItem,
  createProjectionItem,
  createSelectAst,
  createTableRef,
} from '@prisma-next/sql-relational-core/ast';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
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
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

function createDescriptor(index: number, name: string): ParamDescriptor {
  return {
    index,
    name,
    source: 'lane',
  };
}

function createNestedWhereAst(): SelectAst {
  const derivedUsers = createSelectAst({
    from: createTableRef('user'),
    project: [createProjectionItem('id', createColumnRef('user', 'id'))],
    where: createBinaryExpr('eq', createColumnRef('user', 'kind'), {
      kind: 'param',
      index: 4,
      name: 'kind',
    }),
  });

  const derivedPosts = createSelectAst({
    from: createTableRef('post'),
    project: [createProjectionItem('id', createColumnRef('post', 'id'))],
    where: createBinaryExpr('eq', createColumnRef('post', 'title'), {
      kind: 'param',
      index: 5,
      name: 'title',
    }),
  });

  const orderedTitleExpr = {
    kind: 'operation' as const,
    method: 'lower',
    forTypeId: 'pg/text@1',
    self: createColumnRef('matching_posts', 'title'),
    args: [{ kind: 'param' as const, index: 6, name: 'fallback' }],
    returns: { kind: 'builtin' as const, type: 'string' as const },
    lowering: {
      targetFamily: 'sql' as const,
      strategy: 'function' as const,
      template: 'lower(${self}, ${arg0})',
    },
  };

  const existsSubquery = createSelectAst({
    from: createDerivedTableSource('matching_users', derivedUsers),
    joins: [
      {
        kind: 'join',
        joinType: 'left',
        source: createDerivedTableSource('matching_posts', derivedPosts),
        lateral: false,
        on: createBinaryExpr('eq', createColumnRef('matching_posts', 'userId'), {
          kind: 'param',
          index: 2,
          name: 'userId',
        }),
      },
    ],
    project: [
      createProjectionItem(
        'items',
        createJsonArrayAggExpr(
          createJsonObjectExpr([
            createJsonObjectEntry('id', createColumnRef('matching_posts', 'id')),
          ]),
          'emptyArray',
          [createOrderByItem(orderedTitleExpr, 'desc')],
        ),
      ),
    ],
    having: createBinaryExpr('gt', createAggregateExpr('count'), {
      kind: 'param',
      index: 3,
      name: 'minCount',
    }),
    orderBy: [createOrderByItem(orderedTitleExpr, 'asc')],
  });

  return createSelectAst({
    from: createTableRef('user'),
    project: [createProjectionItem('id', createColumnRef('user', 'id'))],
    where: createExistsExpr(false, existsSubquery),
  });
}

describe('buildKyselyWhereExpr nested AST traversal', () => {
  it('collects and remaps params across derived-table select shapes', () => {
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

    const bound = buildKyselyWhereExpr(
      contract,
      { query: {} as never, queryId: {} as never, sql: '', parameters: [] } as CompiledQuery<unknown>,
    ).toWhereExpr();

    expect(bound.params).toEqual(['join-user-id', 1, 'admin', 'Hello', 'untitled']);
    expect(bound.paramDescriptors.map((descriptor) => descriptor.index)).toEqual([1, 2, 3, 4, 5]);

    expect(bound.expr.kind).toBe('exists');
    if (bound.expr.kind !== 'exists') {
      throw new Error('expected exists expression');
    }

    const subquery = bound.expr.subquery;
    expect(subquery.from.kind).toBe('derivedTable');
    if (subquery.from.kind === 'derivedTable') {
      expect(subquery.from.query.where?.kind).toBe('bin');
      if (subquery.from.query.where?.kind === 'bin') {
        expect(subquery.from.query.where.right).toMatchObject({ kind: 'param', index: 3 });
      }
    }

    const join = subquery.joins?.[0];
    expect(join?.source.kind).toBe('derivedTable');
    if (join?.source.kind === 'derivedTable' && join.on.kind === 'bin') {
      expect(join.on.right).toMatchObject({ kind: 'param', index: 1 });
      expect(join.source.query.where?.kind).toBe('bin');
      if (join.source.query.where?.kind === 'bin') {
        expect(join.source.query.where.right).toMatchObject({ kind: 'param', index: 4 });
      }
    }

    expect(subquery.having?.kind).toBe('bin');
    if (subquery.having?.kind === 'bin') {
      expect(subquery.having.right).toMatchObject({ kind: 'param', index: 2 });
    }

    const aggregate = subquery.project[0]?.expr;
    expect(aggregate?.kind).toBe('jsonArrayAgg');
    if (aggregate?.kind === 'jsonArrayAgg') {
      expect(aggregate.orderBy?.[0]?.expr.kind).toBe('operation');
      if (aggregate.orderBy?.[0]?.expr.kind === 'operation') {
        expect(aggregate.orderBy[0].expr.args[0]).toMatchObject({ kind: 'param', index: 5 });
      }
    }
  });
});
