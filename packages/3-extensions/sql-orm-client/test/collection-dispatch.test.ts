import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import { dispatchCollectionRows, stitchIncludes } from '../src/collection-dispatch';
import type { IncludeExpr, RuntimeScope } from '../src/types';
import { emptyState } from '../src/types';
import { createCollectionFor } from './collection-fixtures';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, createTestContract } from './helpers';

function withSingleQueryCapabilities(contract: TestContract): TestContract {
  return {
    ...contract,
    capabilities: {
      ...contract.capabilities,
      lateral: { enabled: true },
      jsonAgg: { enabled: true },
    },
  } as unknown as TestContract;
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

function cloneInclude(include: IncludeExpr, overrides: Partial<IncludeExpr>): IncludeExpr {
  return {
    ...include,
    ...overrides,
  };
}

function emptyScope(): RuntimeScope {
  return {
    execute() {
      return new AsyncIterableResult((async function* () {})());
    },
  };
}

describe('collection-dispatch', () => {
  it('dispatchCollectionRows() maps rows when includes are absent', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract: collection.ctx.contract,
      runtime,
      state: collection.state,
      tableName: collection.tableName,
    }).toArray();

    expect(rows).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
  });

  it('dispatchCollectionRows() single-query path returns empty rows and releases scope', async () => {
    const contract = withSingleQueryCapabilities(createTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection.include('posts');
    runtime.setNextResults([[]]);

    let released = false;
    const runtimeWithConnection = addConnection(runtime, () => {
      released = true;
    });

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime: runtimeWithConnection,
      state: scoped.state,
      tableName: scoped.tableName,
    }).toArray();

    expect(rows).toEqual([]);
    expect(released).toBe(true);
  });

  it('dispatchCollectionRows() single-query path parses include payloads and strips hidden join columns', async () => {
    const contract = withSingleQueryCapabilities(createTestContract());
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection.select('name').include('posts');
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts: '[{"id":10,"title":"Post A","user_id":1,"views":3},42,null]',
        },
        {
          id: 2,
          name: 'Bob',
          posts: 'not-json',
        },
        {
          id: 3,
          name: 'Cara',
          posts: null,
        },
        {
          id: 4,
          name: 'Drew',
          posts: '{"id":99}',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
    }).toArray();

    expect(rows).toEqual([
      {
        name: 'Alice',
        posts: [{ id: 10, title: 'Post A', userId: 1, views: 3 }],
      },
      {
        name: 'Bob',
        posts: [],
      },
      {
        name: 'Cara',
        posts: [],
      },
      {
        name: 'Drew',
        posts: [],
      },
    ]);
  });

  it('dispatchCollectionRows() single-query to-one include returns mapped row or null', async () => {
    const contract = withSingleQueryCapabilities(createTestContract());
    const { collection, runtime } = createCollectionFor('Post', contract);
    const scoped = collection.select('title').include('author');
    runtime.setNextResults([
      [
        {
          user_id: 1,
          title: 'Has Author',
          author: '[{"id":1,"name":"Alice","email":"alice@example.com"}]',
        },
        {
          user_id: null,
          title: 'No Author',
          author: '[]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
    }).toArray();

    expect(rows).toEqual([
      {
        title: 'Has Author',
        author: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        },
      },
      {
        title: 'No Author',
        author: null,
      },
    ]);
  });

  it('dispatchCollectionRows() multi-query path stitches includes, strips hidden fields, and releases scope', async () => {
    const contract = createTestContract();
    const { collection, runtime } = createCollectionFor('User', contract);
    const scoped = collection.select('name').include('posts', (posts) => posts.select('title'));

    runtime.setNextResults([
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      [
        { user_id: 1, title: 'One' },
        { user_id: 1, title: 'Two' },
      ],
    ]);

    let released = false;
    const runtimeWithConnection = addConnection(runtime, () => {
      released = true;
    });

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime: runtimeWithConnection,
      state: scoped.state,
      tableName: scoped.tableName,
    }).toArray();

    expect(rows).toEqual([
      {
        name: 'Alice',
        posts: [{ title: 'One' }, { title: 'Two' }],
      },
      {
        name: 'Bob',
        posts: [],
      },
    ]);
    expect(released).toBe(true);
  });

  it('dispatchCollectionRows() multi-query path handles empty parent result sets', async () => {
    const { collection, runtime } = createCollectionFor('User');
    const scoped = collection.include('posts');

    runtime.setNextResults([[]]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract: collection.ctx.contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
    }).toArray();

    expect(rows).toEqual([]);
  });

  it('stitchIncludes() assigns empty values for row, scalar, and combine descriptors', async () => {
    const contract = createTestContract();
    const { collection } = createCollectionFor('User', contract);
    const rowInclude = collection.include('posts').state.includes[0]!;
    const scalarInclude = collection.include('posts', (posts) => posts.sum('views' as never)).state
      .includes[0]!;
    const combineInclude = collection.include('posts', (posts) =>
      posts.combine({
        rows: posts.take(1),
        total: posts.sum('views' as never),
      }),
    ).state.includes[0]!;

    const parentRows = [
      { raw: {}, mapped: {} as Record<string, unknown> },
      { raw: {}, mapped: {} as Record<string, unknown> },
    ];

    await stitchIncludes(emptyScope(), contract, parentRows, [
      cloneInclude(rowInclude, { relationName: 'rowBranch' }),
      cloneInclude(scalarInclude, { relationName: 'scalarBranch' }),
      cloneInclude(combineInclude, { relationName: 'combineBranch' }),
    ]);

    expect(parentRows).toEqual([
      {
        raw: {},
        mapped: {
          rowBranch: [],
          scalarBranch: null,
          combineBranch: {
            rows: [],
            total: null,
          },
        },
      },
      {
        raw: {},
        mapped: {
          rowBranch: [],
          scalarBranch: null,
          combineBranch: {
            rows: [],
            total: null,
          },
        },
      },
    ]);
  });

  it('stitchIncludes() computes scalar aggregates with numeric coercion and unknown selectors', async () => {
    const contract = createTestContract();
    const runtime = createMockRuntime();
    const baseInclude = createCollectionFor('User', contract).collection.include('posts').state
      .includes[0]!;

    const sumSelector = {
      kind: 'includeScalar',
      fn: 'sum',
      column: 'views',
      state: emptyState(),
    } as IncludeExpr['scalar'];
    const noColumnSelector = {
      kind: 'includeScalar',
      fn: 'sum',
      state: emptyState(),
    } as IncludeExpr['scalar'];
    const unknownSelector = {
      kind: 'includeScalar',
      fn: 'median' as never,
      column: 'views',
      state: emptyState(),
    } as IncludeExpr['scalar'];

    runtime.setNextResults([
      [
        { user_id: 1, views: 3 },
        { user_id: 1, views: 10n },
        { user_id: 1, views: '20' },
        { user_id: 1, views: 'bad' },
        { user_id: 1, views: null },
        { user_id: 1, views: {} },
        { user_id: 2, views: 'bad' },
      ],
      [{ user_id: 1, views: 99 }],
      [{ user_id: 1, views: 5 }],
    ]);

    const parentRows = [
      { raw: { id: 1 }, mapped: {} as Record<string, unknown> },
      { raw: { id: 2 }, mapped: {} as Record<string, unknown> },
    ];

    await stitchIncludes(runtime, contract, parentRows, [
      cloneInclude(baseInclude, {
        relationName: 'sumViews',
        scalar: sumSelector,
      }),
      cloneInclude(baseInclude, {
        relationName: 'noColumn',
        scalar: noColumnSelector,
      }),
      cloneInclude(baseInclude, {
        relationName: 'unknownFn',
        scalar: unknownSelector,
      }),
    ]);

    expect(parentRows).toEqual([
      {
        raw: { id: 1 },
        mapped: {
          sumViews: 33,
          noColumn: null,
          unknownFn: null,
        },
      },
      {
        raw: { id: 2 },
        mapped: {
          sumViews: null,
          noColumn: null,
          unknownFn: null,
        },
      },
    ]);
  });

  it('stitchIncludes() returns null for empty to-one row includes', async () => {
    const contract = createTestContract();
    const include = createCollectionFor('Post', contract).collection.include('author').state
      .includes[0]!;

    const parentRows = [{ raw: {}, mapped: {} as Record<string, unknown> }];

    await stitchIncludes(emptyScope(), contract, parentRows, [include]);

    expect(parentRows[0]?.mapped['author']).toBeNull();
  });
});
