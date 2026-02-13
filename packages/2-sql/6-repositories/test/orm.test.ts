import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { Repository } from '../src/repository';
import type { TestContract } from './helpers';
import { createMockRuntime, createTestContract } from './helpers';

class PostRepository extends Repository<TestContract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

describe('orm()', () => {
  const contract = createTestContract();

  it('returns custom repositories by key', () => {
    const runtime = createMockRuntime();
    const postRepo = new PostRepository({ contract, runtime }, 'Post');
    const db = orm({
      contract,
      runtime,
      repositories: { posts: postRepo },
    });
    expect(db.posts).toBe(postRepo);
  });

  it('creates default repositories for model names', async () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const results = await db.users.findMany().toArray();
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

  it('caches lazily created repositories', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    const first = db.users;
    const second = db.users;
    expect(first).toBe(second);
  });

  it('throws for unknown model name', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(() => (db as Record<string, unknown>)['unknown']).toThrow(
      /No model found for 'unknown'/,
    );
  });

  it('custom repository overrides default for same key', () => {
    const runtime = createMockRuntime();
    const customPostRepo = new PostRepository({ contract, runtime }, 'Post');
    const db = orm({
      contract,
      runtime,
      repositories: { posts: customPostRepo },
    });

    expect(db.posts).toBeInstanceOf(PostRepository);
  });

  it('does not type unknown keys on the client', () => {
    const runtime = createMockRuntime();
    const db = orm({ contract, runtime });
    expect(db.users).toBeDefined();
    type DbClient = typeof db;
    // @ts-expect-error unknown repository key should not exist on typed client
    type _UnknownRepo = DbClient['unknown'];
  });
});
