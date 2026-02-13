import { describe, expect, it } from 'vitest';
import { Repository } from '../src/repository';
import type { TestContract } from './helpers';
import { createMockRuntime, createTestContract } from './helpers';

class PostRepository extends Repository<TestContract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

describe('Repository', () => {
  const contract = createTestContract();

  it('resolves table name from contract mappings', () => {
    const runtime = createMockRuntime();
    const repo = new Repository({ contract, runtime }, 'User');
    expect(repo.tableName).toBe('users');
  });

  it('initializes with empty state', () => {
    const runtime = createMockRuntime();
    const repo = new Repository({ contract, runtime }, 'Post');
    expect(repo.state.filters).toEqual([]);
    expect(repo.state.includes).toEqual([]);
    expect(repo.state.orderBy).toBeUndefined();
    expect(repo.state.limit).toBeUndefined();
    expect(repo.state.offset).toBeUndefined();
  });

  it('supports custom subclass with named scopes', async () => {
    const runtime = createMockRuntime();
    const repo = new PostRepository({ contract, runtime }, 'Post');
    runtime.setNextResults([[{ id: 1, title: 'Popular Post', user_id: 1, views: 5000 }]]);

    const results = await repo.popular().findMany().toArray();
    expect(results).toHaveLength(1);
    expect(runtime.executions[0]!.plan.sql).toContain('"views"');
  });

  it('chains where and findMany correctly', async () => {
    const runtime = createMockRuntime();
    const repo = new Repository({ contract, runtime }, 'User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const results = await repo
      .where((u) => u.name.eq('Alice'))
      .findMany()
      .toArray();

    expect(results).toHaveLength(1);
  });

  it('supports include + where + findMany flow', async () => {
    const runtime = createMockRuntime();
    const repo = new Repository({ contract, runtime }, 'User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 500 }],
    ]);

    const results = await repo
      .where((u) => u.name.eq('Alice'))
      .include('posts')
      .findMany()
      .toArray();

    expect(results[0]).toMatchObject({
      id: 1,
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A' }],
    });
  });
});
