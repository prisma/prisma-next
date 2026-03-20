import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import type { TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';

class UserCollection extends Collection<TestContract, 'User'> {
  named(name: string) {
    return this.where((user) => user.name.eq(name));
  }
}

class PostCollection extends Collection<TestContract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

class CommentCollection extends Collection<TestContract, 'Comment'> {
  withBody(body: string) {
    return this.where((comment) => comment.body.eq(body));
  }
}

function expectPostCollection(value: unknown): asserts value is PostCollection {
  expect(value).toBeInstanceOf(PostCollection);
}

function expectCommentCollection(value: unknown): asserts value is CommentCollection {
  expect(value).toBeInstanceOf(CommentCollection);
}

describe('orm()', () => {
  const contract = getTestContract();
  const context = getTestContext();

  it('returns custom collections by key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: PostCollection },
    });
    expect(db.Post).toBeInstanceOf(PostCollection);
  });

  it('creates default collections for model names', async () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const results = await db.User.all();
    expect(results).toHaveLength(1);
  });

  it('returns undefined for symbol-based property lookups on the proxy', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    expect((db as Record<PropertyKey, unknown>)[Symbol.toStringTag]).toBeUndefined();
  });

  it('caches lazily created collections', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    const first = db.User;
    const second = db.User;
    expect(first).toBe(second);
  });

  it('throws for unknown model name', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    expect(() => (db as Record<string, unknown>)['unknown']).toThrow(
      /No model found for 'unknown'/,
    );
  });

  it('resolves aliases when modelToTable mappings are absent', () => {
    const runtime = createMockRuntime();
    const withoutModelToTable = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: undefined,
      },
    } as unknown as TestContract;

    const customContext = {
      ...context,
      contract: withoutModelToTable,
    } as ExecutionContext<TestContract>;
    const db = orm({ runtime, context: customContext });
    expect(db.User.modelName).toBe('User');
  });

  it('custom collection overrides default for same key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: PostCollection },
    });

    expect(db.Post).toBeInstanceOf(PostCollection);
  });

  it('resolves User to custom collection instance', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { User: UserCollection },
    });

    expect(db.User).toBeInstanceOf(UserCollection);
  });

  it('instantiates custom collections lazily and caches by model', () => {
    const runtime = createMockRuntime();
    let constructions = 0;
    class LazyPostCollection extends Collection<TestContract, 'Post'> {
      readonly instanceMarker = ++constructions;
    }

    const db = orm({
      runtime,
      context,
      collections: { Post: LazyPostCollection },
    });

    expect(constructions).toBe(0);
    void db.User;
    expect(constructions).toBe(0);
    const postsFirst = db.Post;
    expect(constructions).toBe(1);
    const postsSecond = db.Post;
    expect(postsSecond).toBe(postsFirst);
    expect(constructions).toBe(1);
  });

  it('ignores undefined custom collection entries and falls back to default collection', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: { Post: undefined as unknown as typeof PostCollection },
    });

    expect(db.Post).toBeInstanceOf(Collection);
    expect(db.Post).not.toBeInstanceOf(PostCollection);
  });

  it('throws when a custom collection key cannot resolve to a model', () => {
    const runtime = createMockRuntime();

    expect(() =>
      orm({
        runtime,
        context,
        collections: { unknownCollection: PostCollection },
      }),
    ).toThrow(/No model found for custom collection 'unknownCollection'/);
  });

  it('throws when custom collection values are instances instead of classes', () => {
    const runtime = createMockRuntime();
    const postCollectionInstance = new PostCollection({ runtime, context }, 'Post');

    expect(() =>
      orm({
        runtime,
        context,
        collections: {
          Post: postCollectionInstance as unknown as typeof PostCollection,
        },
      }),
    ).toThrow(/must be a Collection class/);
  });

  it('throws when custom collection values do not extend Collection', () => {
    const runtime = createMockRuntime();
    class NotACollection {
      noop() {
        return undefined;
      }
    }

    expect(() =>
      orm({
        runtime,
        context,
        collections: {
          Post: NotACollection as unknown as typeof PostCollection,
        },
      }),
    ).toThrow(/must be a Collection class/);
  });

  it('throws when custom collection values are functions without Collection prototypes', () => {
    const runtime = createMockRuntime();

    expect(() =>
      orm({
        runtime,
        context,
        collections: {
          Post: (() => ({ ok: true })) as unknown as typeof PostCollection,
        },
      }),
    ).toThrow(/must be a Collection class/);
  });

  it('does not type unknown keys on the client', () => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context });
    expect(db.User).toBeDefined();
    type DbClient = typeof db;
    // @ts-expect-error unknown collection key should not exist on typed client
    type _UnknownCollection = DbClient['unknown'];
  });

  it(
    'uses registered collection classes in include refinements',
    { timeout: timeouts.typeScriptCompilation },
    () => {
      const runtime = createMockRuntime();
      const db = orm({
        runtime,
        context,
        collections: { Post: PostCollection },
      });

      const withPosts = db.User.include('posts', (posts) => {
        expectPostCollection(posts);
        return posts.popular();
      });

      const include = withPosts.state.includes[0]!;
      expect(include.nested.filters).toHaveLength(1);
    },
  );

  it('propagates registered collection classes through nested include refinements', () => {
    const runtime = createMockRuntime();
    const db = orm({
      runtime,
      context,
      collections: {
        Post: PostCollection,
        Comment: CommentCollection,
      },
    });

    const withNested = db.User.include('posts', (posts) => {
      expectPostCollection(posts);
      return posts.include('comments', (comments) => {
        expectCommentCollection(comments);
        return comments.withBody('approved');
      });
    });

    const postInclude = withNested.state.includes[0]!;
    const commentInclude = postInclude.nested.includes[0]!;
    expect(commentInclude.nested.filters).toHaveLength(1);
  });

  it('handles empty model names in alias generation', () => {
    const runtime = createMockRuntime();
    const withEmptyModelName = {
      ...contract,
      models: {
        ...contract.models,
        '': {
          storage: { table: 'empty_models' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
      },
      mappings: {
        ...contract.mappings,
        modelToTable: {
          ...contract.mappings.modelToTable,
          '': 'empty_models',
        },
        tableToModel: {
          ...contract.mappings.tableToModel,
          empty_models: '',
        },
        fieldToColumn: {
          ...contract.mappings.fieldToColumn,
          '': { id: 'id' },
        },
        columnToField: {
          ...contract.mappings.columnToField,
          empty_models: { id: 'id' },
        },
      },
      storage: {
        ...contract.storage,
        tables: {
          ...contract.storage.tables,
          empty_models: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    } as unknown as TestContract;

    const customContext = { ...context, contract: withEmptyModelName };
    expect(() => orm({ runtime, context: customContext })).not.toThrow();
  });
});
