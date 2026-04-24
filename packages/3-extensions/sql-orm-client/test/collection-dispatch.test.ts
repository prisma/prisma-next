import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  ExecutionContext,
  JsonSchemaValidateFn,
  JsonSchemaValidatorRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { dispatchCollectionRows, stitchIncludes } from '../src/collection-dispatch';
import type { IncludeExpr, RuntimeScope } from '../src/types';
import { emptyState } from '../src/types';
import { createCollectionFor } from './collection-fixtures';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';

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

function createAsyncCodecRegistry() {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      traits: ['equality', 'order', 'numeric'],
      encode: (value: number) => value,
      decode: (value: number) => value,
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      traits: ['equality', 'order', 'textual'],
      encode: (value: string) => value,
      decode: (value: string) => value,
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/secret@1',
      targetTypes: ['text'],
      traits: ['equality', 'order', 'textual'],
      runtime: { decode: 'async' } as const,
      encode: (value: string) => value,
      decode: async (value: string) => {
        if (!value.startsWith('enc:')) {
          throw new Error('invalid secret payload');
        }
        return value.slice(4);
      },
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/jsonb@1',
      targetTypes: ['jsonb'],
      traits: ['equality'],
      runtime: { decode: 'async' } as const,
      encode: (value: unknown) => value,
      decode: async (value: unknown) => value,
    }),
  );
  return registry;
}

function createValidatorRegistry(): JsonSchemaValidatorRegistry {
  const validators = new Map<string, JsonSchemaValidateFn>();
  validators.set('posts.metadata', (value: unknown) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { title?: unknown }).title === 'string'
    ) {
      return { valid: true };
    }
    return {
      valid: false,
      errors: [{ path: '/', message: 'title is required', keyword: 'required' }],
    };
  });
  return {
    get(key: string) {
      return validators.get(key);
    },
    size: validators.size,
  };
}

function withAsyncPostContract(base: TestContract): TestContract {
  return {
    ...base,
    models: {
      ...base.models,
      Post: {
        ...base.models.Post,
        storage: {
          ...base.models.Post.storage,
          fields: {
            ...base.models.Post.storage.fields,
            secret: { column: 'secret' },
            metadata: { column: 'metadata' },
          },
        },
        fields: {
          ...base.models.Post.fields,
          secret: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/secret@1' },
          },
          metadata: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/jsonb@1' },
          },
        },
      },
    },
    storage: {
      ...base.storage,
      tables: {
        ...base.storage.tables,
        posts: {
          ...base.storage.tables.posts,
          columns: {
            ...base.storage.tables.posts.columns,
            secret: { nativeType: 'text', codecId: 'pg/secret@1', nullable: false },
            metadata: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
          },
        },
      },
    },
  } as TestContract;
}

function createAsyncPostCollection(contract: TestContract): {
  collection: Collection<TestContract, 'User'>;
  runtime: MockRuntime;
  context: ExecutionContext<TestContract>;
} {
  const runtime = createMockRuntime();
  const context = {
    ...getTestContext(),
    contract,
    codecs: createAsyncCodecRegistry(),
    jsonSchemaValidators: createValidatorRegistry(),
  } as ExecutionContext<TestContract>;
  const collection = new Collection({ runtime, context }, 'User');
  return { collection, runtime, context };
}

describe('collection-dispatch', () => {
  it('dispatchCollectionRows() maps rows when includes are absent', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract: collection.ctx.context.contract,
      runtime,
      state: collection.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
    }).toArray();

    expect(rows).toEqual([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
  });

  it('dispatchCollectionRows() single-query path returns empty rows and releases scope', async () => {
    const contract = withSingleQueryCapabilities(getTestContract());
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
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([]);
    expect(released).toBe(true);
  });

  it('dispatchCollectionRows() single-query path parses include payloads and strips hidden join columns', async () => {
    const contract = withSingleQueryCapabilities(getTestContract());
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
      modelName: scoped.modelName,
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
    const contract = withSingleQueryCapabilities(getTestContract());
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
      modelName: scoped.modelName,
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

  it('dispatchCollectionRows() single-query include decodes async child fields and validates decoded values', async () => {
    const contract = withSingleQueryCapabilities(withAsyncPostContract(getTestContract()));
    const { collection, runtime, context } = createAsyncPostCollection(contract);
    const scoped = collection.select('name').include('posts');
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts:
            '[{"id":10,"title":"Post A","user_id":1,"secret":"enc:alpha","metadata":{"title":"A"}}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      context,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    const post = rows[0]?.['posts'] as Record<string, unknown>[] | undefined;
    expect(post).toBeDefined();
    expect(post?.[0]?.['id']).toBe(10);
    expect(post?.[0]?.['title']).toBe('Post A');
    expect(post?.[0]?.['userId']).toBe(1);
    await expect(post?.[0]?.['secret']).resolves.toBe('alpha');
    await expect(post?.[0]?.['metadata']).resolves.toEqual({ title: 'A' });
  });

  it('dispatchCollectionRows() single-query include preserves JSON schema validation failures for async child decodes', async () => {
    const contract = withSingleQueryCapabilities(withAsyncPostContract(getTestContract()));
    const { collection, runtime, context } = createAsyncPostCollection(contract);
    const scoped = collection.select('name').include('posts');
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts:
            '[{"id":10,"title":"Post A","user_id":1,"secret":"enc:alpha","metadata":{"missing":"title"}}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      context,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    const post = rows[0]?.['posts'] as Record<string, unknown>[] | undefined;
    await expect(post?.[0]?.['metadata']).rejects.toMatchObject({
      code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
    });
  });

  it('dispatchCollectionRows() single-query include wraps async child decode failures with codec context', async () => {
    const contract = withSingleQueryCapabilities(withAsyncPostContract(getTestContract()));
    const { collection, runtime, context } = createAsyncPostCollection(contract);
    const scoped = collection.select('name').include('posts');
    runtime.setNextResults([
      [
        {
          id: 1,
          name: 'Alice',
          posts:
            '[{"id":10,"title":"Post A","user_id":1,"secret":"broken","metadata":{"title":"A"}}]',
        },
      ],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      context,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    const post = rows[0]?.['posts'] as Record<string, unknown>[] | undefined;
    await expect(post?.[0]?.['secret']).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: {
        alias: 'secret',
        codec: 'pg/secret@1',
        wirePreview: 'broken',
      },
    });
  });

  it('dispatchCollectionRows() multi-query path preserves promise-valued async codec fields on child rows', async () => {
    const contract = withAsyncPostContract(getTestContract());
    const { collection, runtime } = createAsyncPostCollection(contract);
    const scoped = collection.select('name').include('posts', (posts) => posts.select('title'));

    // Multi-query path hands child rows back from executeQueryPlan unchanged.
    // In production that runtime applies decodeRow, which yields Promise<T>
    // for async-decode columns; here we simulate the same shape directly so
    // the unit test asserts the ORM stitching does not unwrap or drop the
    // promise fields.
    const secretPromise = Promise.resolve('alpha');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice' }],
      [{ user_id: 1, title: 'Post A', secret: secretPromise }],
    ]);

    const rows = await dispatchCollectionRows<Record<string, unknown>>({
      contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    const posts = rows[0]?.['posts'] as Record<string, unknown>[] | undefined;
    expect(posts?.[0]?.['title']).toBe('Post A');
    expect(posts?.[0]?.['secret']).toBeInstanceOf(Promise);
    await expect(posts?.[0]?.['secret']).resolves.toBe('alpha');
  });

  it('dispatchCollectionRows() multi-query path stitches includes, strips hidden fields, and releases scope', async () => {
    const contract = getTestContract();
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
      modelName: scoped.modelName,
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
      contract: collection.ctx.context.contract,
      runtime,
      state: scoped.state,
      tableName: scoped.tableName,
      modelName: scoped.modelName,
    }).toArray();

    expect(rows).toEqual([]);
  });

  it('stitchIncludes() assigns empty values for row, scalar, and combine descriptors', async () => {
    const contract = getTestContract();
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
    const contract = getTestContract();
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
    } as unknown as IncludeExpr['scalar'];

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
    const contract = getTestContract();
    const include = createCollectionFor('Post', contract).collection.include('author').state
      .includes[0]!;

    const parentRows = [{ raw: {}, mapped: {} as Record<string, unknown> }];

    await stitchIncludes(emptyScope(), contract, parentRows, [include]);

    expect(parentRows[0]?.mapped['author']).toBeNull();
  });
});
