import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import type { TestContract } from './helpers';
import { createMockRuntime, createTestContract } from './helpers';

class PostCollection extends Collection<TestContract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

describe('Collection construction', () => {
  const contract = createTestContract();

  it('resolves table name from contract mappings', () => {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'User');
    expect(collection.tableName).toBe('users');
  });

  it('initializes with empty state', () => {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'Post');
    expect(collection.state.filters).toEqual([]);
    expect(collection.state.includes).toEqual([]);
    expect(collection.state.orderBy).toBeUndefined();
    expect(collection.state.limit).toBeUndefined();
    expect(collection.state.offset).toBeUndefined();
  });

  it('supports custom subclass with named scopes', async () => {
    const runtime = createMockRuntime();
    const collection = new PostCollection({ contract, runtime }, 'Post');
    runtime.setNextResults([[{ id: 1, title: 'Popular Post', user_id: 1, views: 5000 }]]);

    const results = await collection.popular().all().toArray();
    expect(results).toHaveLength(1);
    expect(runtime.executions[0]!.plan.sql).toContain('"views"');
  });

  it('chains where and all correctly', async () => {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const results = await collection
      .where((u) => u.name.eq('Alice'))
      .all()
      .toArray();

    expect(results).toHaveLength(1);
  });

  it('supports include + where + all flow', async () => {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'User');
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 10, title: 'Post A', user_id: 1, views: 500 }],
    ]);

    const results = await collection
      .where((u) => u.name.eq('Alice'))
      .include('posts')
      .all()
      .toArray();

    expect(results[0]).toMatchObject({
      id: 1,
      name: 'Alice',
      posts: [{ id: 10, title: 'Post A' }],
    });
  });
});
