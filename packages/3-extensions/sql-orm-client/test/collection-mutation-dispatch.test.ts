import {
  LiteralExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import {
  dispatchMutationRows,
  dispatchSplitMutationRows,
  executeMutationReturningSingleRow,
} from '../src/collection-mutation-dispatch';
import { createCollectionFor } from './collection-fixtures';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, getTestContract } from './helpers';

function makeCompiled(sqlText = 'select 1'): SqlQueryPlan<Record<string, unknown>> {
  return {
    ast: SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('_sql', LiteralExpr.of(sqlText)),
    ]),
    params: [],
    meta: {
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      lane: 'orm-client',
      paramDescriptors: [],
    },
  };
}

function addConnection(
  runtime: MockRuntime,
  onRelease: () => void,
): MockRuntime & {
  connection: () => Promise<{
    execute: MockRuntime['execute'];
    release: () => Promise<void>;
  }>;
} {
  return Object.assign(runtime, {
    async connection() {
      return {
        execute: runtime.execute.bind(runtime),
        async release() {
          onRelease();
        },
      };
    },
  });
}

function usersPostsIncludes(contract: TestContract) {
  return createCollectionFor('User', contract).collection.include('posts').state.includes;
}

describe('collection-mutation-dispatch', () => {
  it('dispatchMutationRows() maps rows without includes and strips hidden fields', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const rows = await dispatchMutationRows<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('insert into users ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: [],
      hiddenColumns: ['email'],
      mapRow: (mapped) => mapped,
    }).toArray();

    expect(rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('dispatchMutationRows() returns empty when include query returns no rows and releases scope', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    let released = false;
    const runtimeWithConnection = addConnection(runtime, () => {
      released = true;
    });

    const rows = await dispatchMutationRows<Record<string, unknown>>({
      contract,
      runtime: runtimeWithConnection,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: usersPostsIncludes(contract),
      hiddenColumns: [],
      mapRow: (mapped) => mapped,
    }).toArray();

    expect(rows).toEqual([]);
    expect(released).toBe(true);
  });

  it('dispatchMutationRows() stitches includes and strips hidden fields in include mode', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 10 }],
    ]);

    const rows = await dispatchMutationRows<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: usersPostsIncludes(contract),
      hiddenColumns: ['email'],
      mapRow: (mapped) => mapped,
    }).toArray();

    expect(rows).toEqual([
      {
        id: 1,
        name: 'Alice',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 10 }],
      },
    ]);
  });

  it('dispatchMutationRows() keeps mapped fields when include mode has no hidden columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 10 }],
    ]);

    const rows = await dispatchMutationRows<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: usersPostsIncludes(contract),
      hiddenColumns: [],
      mapRow: (mapped) => mapped,
    }).toArray();

    expect(rows).toEqual([
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 10 }],
      },
    ]);
  });

  it('executeMutationReturningSingleRow() returns null when no rows are returned without includes', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    const result = await executeMutationReturningSingleRow<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('delete from users returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: [],
      hiddenColumns: ['email'],
      mapRow: (mapped) => mapped,
      onMissingRowMessage: 'missing row',
    });

    expect(result).toBeNull();
  });

  it('executeMutationReturningSingleRow() strips hidden fields in no-include mode', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const result = await executeMutationReturningSingleRow<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: [],
      hiddenColumns: ['email'],
      mapRow: (mapped) => mapped,
      onMissingRowMessage: 'missing row',
    });

    expect(result).toEqual({ id: 1, name: 'Alice' });
  });

  it('executeMutationReturningSingleRow() returns null when include query has no first row', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    const result = await executeMutationReturningSingleRow<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: usersPostsIncludes(contract),
      hiddenColumns: [],
      mapRow: (mapped) => mapped,
      onMissingRowMessage: 'missing row',
    });

    expect(result).toBeNull();
  });

  it('executeMutationReturningSingleRow() stitches includes, strips hidden fields, and releases scope', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 10 }],
    ]);

    let released = false;
    const runtimeWithConnection = addConnection(runtime, () => {
      released = true;
    });

    const result = await executeMutationReturningSingleRow<Record<string, unknown>>({
      contract,
      runtime: runtimeWithConnection,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: usersPostsIncludes(contract),
      hiddenColumns: ['email'],
      mapRow: (mapped) => mapped,
      onMissingRowMessage: 'missing row',
    });

    expect(result).toEqual({
      id: 1,
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A', userId: 1, views: 10 }],
    });
    expect(released).toBe(true);
  });

  it('executeMutationReturningSingleRow() keeps fields when include mode has no hidden columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 10 }],
    ]);

    const result = await executeMutationReturningSingleRow<Record<string, unknown>>({
      contract,
      runtime,
      compiled: makeCompiled('update users set ... returning *'),
      tableName: 'users',
      modelName: 'User',
      includes: usersPostsIncludes(contract),
      hiddenColumns: [],
      mapRow: (mapped) => mapped,
      onMissingRowMessage: 'missing row',
    });

    expect(result).toEqual({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      posts: [{ id: 10, title: 'Post A', userId: 1, views: 10 }],
    });
  });

  describe('dispatchSplitMutationRows()', () => {
    it('maps rows from multiple plans without includes', async () => {
      const contract = getTestContract();
      const runtime = createMockRuntime();
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [{ id: 2, name: 'Bob', email: 'bob@example.com' }],
      ]);

      const rows = await dispatchSplitMutationRows<Record<string, unknown>>({
        contract,
        runtime,
        plans: [makeCompiled('insert batch 1'), makeCompiled('insert batch 2')],
        tableName: 'users',
        includes: [],
        hiddenColumns: [],
        mapRow: (mapped) => mapped,
      }).toArray();

      expect(rows).toEqual([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      expect(runtime.executions).toHaveLength(2);
    });

    it('strips hidden fields without includes', async () => {
      const contract = getTestContract();
      const runtime = createMockRuntime();
      runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

      const rows = await dispatchSplitMutationRows<Record<string, unknown>>({
        contract,
        runtime,
        plans: [makeCompiled('insert ...')],
        tableName: 'users',
        includes: [],
        hiddenColumns: ['email'],
        mapRow: (mapped) => mapped,
      }).toArray();

      expect(rows).toEqual([{ id: 1, name: 'Alice' }]);
    });

    it('yields nothing when all plans return empty without includes', async () => {
      const contract = getTestContract();
      const runtime = createMockRuntime();
      runtime.setNextResults([[], []]);

      const rows = await dispatchSplitMutationRows<Record<string, unknown>>({
        contract,
        runtime,
        plans: [makeCompiled('insert batch 1'), makeCompiled('insert batch 2')],
        tableName: 'users',
        includes: [],
        hiddenColumns: [],
        mapRow: (mapped) => mapped,
      }).toArray();

      expect(rows).toEqual([]);
      expect(runtime.executions).toHaveLength(2);
    });

    it('stitches includes from multiple plans, strips hidden fields, and releases scope', async () => {
      const contract = getTestContract();
      const runtime = createMockRuntime();
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [{ id: 2, name: 'Bob', email: 'bob@example.com' }],
        [
          { id: 10, title: 'Post A', user_id: 1, views: 10 },
          { id: 11, title: 'Post B', user_id: 2, views: 5 },
        ],
      ]);

      let released = false;
      const runtimeWithConnection = addConnection(runtime, () => {
        released = true;
      });

      const rows = await dispatchSplitMutationRows<Record<string, unknown>>({
        contract,
        runtime: runtimeWithConnection,
        plans: [makeCompiled('insert batch 1'), makeCompiled('insert batch 2')],
        tableName: 'users',
        includes: usersPostsIncludes(contract),
        hiddenColumns: ['email'],
        mapRow: (mapped) => mapped,
      }).toArray();

      expect(rows).toEqual([
        { id: 1, name: 'Alice', posts: [{ id: 10, title: 'Post A', userId: 1, views: 10 }] },
        { id: 2, name: 'Bob', posts: [{ id: 11, title: 'Post B', userId: 2, views: 5 }] },
      ]);
      expect(released).toBe(true);
    });

    it('returns empty and releases scope when all plans yield no rows with includes', async () => {
      const contract = getTestContract();
      const runtime = createMockRuntime();
      runtime.setNextResults([[], []]);

      let released = false;
      const runtimeWithConnection = addConnection(runtime, () => {
        released = true;
      });

      const rows = await dispatchSplitMutationRows<Record<string, unknown>>({
        contract,
        runtime: runtimeWithConnection,
        plans: [makeCompiled('insert batch 1'), makeCompiled('insert batch 2')],
        tableName: 'users',
        includes: usersPostsIncludes(contract),
        hiddenColumns: [],
        mapRow: (mapped) => mapped,
      }).toArray();

      expect(rows).toEqual([]);
      expect(released).toBe(true);
    });

    it('keeps all fields when no hidden columns in include mode', async () => {
      const contract = getTestContract();
      const runtime = createMockRuntime();
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [{ id: 10, title: 'Post A', user_id: 1, views: 10 }],
      ]);

      const rows = await dispatchSplitMutationRows<Record<string, unknown>>({
        contract,
        runtime,
        plans: [makeCompiled('insert batch 1')],
        tableName: 'users',
        includes: usersPostsIncludes(contract),
        hiddenColumns: [],
        mapRow: (mapped) => mapped,
      }).toArray();

      expect(rows).toEqual([
        {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: [{ id: 10, title: 'Post A', userId: 1, views: 10 }],
        },
      ]);
    });
  });
});
