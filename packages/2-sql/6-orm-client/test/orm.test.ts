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
    const results = await db.users.all().toArray();
    expect(results).toHaveLength(1);
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

  it('custom collection overrides default for same key', () => {
    const runtime = createMockRuntime();
    const db = orm({
      contract,
      runtime,
      collections: { posts: PostCollection },
    });

    expect(db.posts).toBeInstanceOf(PostCollection);
  });

  it('does not type unknown keys on the client', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.users).toBeDefined();
    type DbClient = typeof db;
    // @ts-expect-error unknown collection key should not exist on typed client
    type _UnknownCollection = DbClient['unknown'];
  });
});
