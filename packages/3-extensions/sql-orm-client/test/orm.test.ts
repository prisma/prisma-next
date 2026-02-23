import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import type { TestContract } from './helpers';
import { createMockRuntime, createTestContract } from './helpers';

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

describe('orm()', () => {
  const contract = createTestContract();

  it('returns custom collections by key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      contract,
      runtime,
      collections: { posts: PostCollection },
    });
    expect(db.posts).toBeInstanceOf(PostCollection);
  });

  it('creates default collections for model names', async () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const results = await db.users.all();
    expect(results).toHaveLength(1);
  });

  it('returns undefined for symbol-based property lookups on the proxy', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect((db as Record<PropertyKey, unknown>)[Symbol.toStringTag]).toBeUndefined();
  });

  it('resolves plural names to PascalCase model names', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.users.modelName).toBe('User');
  });

  it('resolves "posts" to "Post"', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.posts.modelName).toBe('Post');
  });

  it('resolves "comments" to "Comment"', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.comments.modelName).toBe('Comment');
  });

  it('caches lazily created collections', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    const first = db.users;
    const second = db.users;
    expect(first).toBe(second);
  });

  it('shares cached collection across model aliases', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.users).toBe(db.User);
  });

  it('throws for unknown model name', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(() => (db as Record<string, unknown>)['unknown']).toThrow(
      /No model found for 'unknown'/,
    );
  });

  it('resolves singular fallback when key ends with s but exact alias is missing', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });

    expect((db as Record<string, Collection<TestContract, string>>)['Users']).toBe(db.User);
  });

  it('custom collection overrides default for same key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      contract,
      runtime,
      collections: { posts: PostCollection },
    });

    expect(db.posts).toBeInstanceOf(PostCollection);
  });

  it('ignores undefined custom collection entries and falls back to default collection', () => {
    const runtime = createMockRuntime();
    const db = orm({
      contract,
      runtime,
      collections: { posts: undefined as unknown as typeof PostCollection },
    });

    expect(db.posts).toBeInstanceOf(Collection);
    expect(db.posts).not.toBeInstanceOf(PostCollection);
  });

  it('throws when a custom collection key cannot resolve to a model', () => {
    const runtime = createMockRuntime();

    expect(() =>
      orm({
        contract,
        runtime,
        collections: { unknownCollection: PostCollection },
      }),
    ).toThrow(/No model found for custom collection 'unknownCollection'/);
  });

  it('does not type unknown keys on the client', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.users).toBeDefined();
    type DbClient = typeof db;
    // @ts-expect-error unknown collection key should not exist on typed client
    type _UnknownCollection = DbClient['unknown'];
  });

  it('uses registered collection classes in include refinements', () => {
    const runtime = createMockRuntime();
    const db = orm({
      contract,
      runtime,
      collections: { posts: PostCollection },
    });

    const withPosts = db.users.include('posts', (posts) => {
      expect(posts).toBeInstanceOf(PostCollection);
      return (posts as unknown as PostCollection).popular();
    });

    const include = withPosts.state.includes[0]!;
    expect(include.nested.filters).toHaveLength(1);
  });

  it('propagates registered collection classes through nested include refinements', () => {
    const runtime = createMockRuntime();
    const db = orm({
      contract,
      runtime,
      collections: {
        posts: PostCollection,
        comments: CommentCollection,
      },
    });

    const withNested = db.users.include('posts', (posts) =>
      (posts as unknown as PostCollection).include('comments', (comments) => {
        expect(comments).toBeInstanceOf(CommentCollection);
        return (comments as unknown as CommentCollection).withBody('approved');
      }),
    );

    const postInclude = withNested.state.includes[0]!;
    const commentInclude = postInclude.nested.includes[0]!;
    expect(commentInclude.nested.filters).toHaveLength(1);
  });
});
