import type { MongoContractWithTypeMaps } from '@prisma-next/mongo-core';
import type { MongoReadPlan } from '@prisma-next/mongo-query-ast';
import { MongoFieldFilter } from '@prisma-next/mongo-query-ast';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import { MongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';

const minimalContract = {
  target: 'mongo',
  storageHash: 'test',
  storage: {
    domain: 'mongo',
    collections: {
      users: {
        fields: { _id: { codecId: 'mongo/objectId@1' }, name: { codecId: 'mongo/string@1' } },
      },
      posts: {
        fields: { _id: { codecId: 'mongo/objectId@1' }, authorId: { codecId: 'mongo/objectId@1' } },
      },
    },
  },
  models: {
    User: {
      fields: { _id: { codecId: 'mongo/objectId@1' }, name: { codecId: 'mongo/string@1' } },
      storage: { collection: 'users' },
      relations: {
        posts: {
          kind: 'reference',
          to: 'Post',
          cardinality: '1:N',
          on: { localFields: ['_id'], targetFields: ['authorId'] },
        },
      },
    },
    Post: {
      fields: { _id: { codecId: 'mongo/objectId@1' }, authorId: { codecId: 'mongo/objectId@1' } },
      storage: { collection: 'posts' },
      relations: {
        author: {
          kind: 'reference',
          to: 'User',
          cardinality: 'N:1',
          on: { localFields: ['authorId'], targetFields: ['_id'] },
        },
        comments: {
          kind: 'embed',
          to: 'Comment',
          cardinality: '1:N',
        },
      },
    },
    Comment: {
      fields: { text: { codecId: 'mongo/string@1' } },
      storage: {},
    },
  },
  roots: { users: 'User', posts: 'Post' },
} as unknown as MongoContractWithTypeMaps<never, never>;

function createMockExecutor(
  rows: unknown[] = [],
): MongoQueryExecutor & { lastPlan: MongoReadPlan | undefined } {
  const mock = {
    lastPlan: undefined as MongoReadPlan | undefined,
    execute<Row>(plan: MongoReadPlan<Row>): AsyncIterableResult<Row> {
      mock.lastPlan = plan as MongoReadPlan;
      async function* gen(): AsyncGenerator<Row> {
        for (const row of rows) {
          yield row as Row;
        }
      }
      return new AsyncIterableResult(gen());
    },
  };
  return mock;
}

describe('MongoCollection chaining', () => {
  it('returns a new instance from where()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(filtered).not.toBe(col);
    expect(filtered).toBeInstanceOf(MongoCollection);
  });

  it('accumulates filters from multiple where() calls', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .where(MongoFieldFilter.gte('age', 18));
    expect(col.state.filters).toHaveLength(2);
  });

  it('returns a new instance from select()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    const selected = col.select('name');
    expect(selected).not.toBe(col);
    expect(selected.state.selectedFields).toEqual(['name']);
  });

  it('returns a new instance from orderBy()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    const ordered = col.orderBy({ name: 1 });
    expect(ordered).not.toBe(col);
    expect(ordered.state.orderBy).toEqual({ name: 1 });
  });

  it('merges orderBy across calls', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor)
      .orderBy({ name: 1 })
      .orderBy({ age: -1 });
    expect(col.state.orderBy).toEqual({ name: 1, age: -1 });
  });

  it('returns a new instance from take()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    const limited = col.take(10);
    expect(limited).not.toBe(col);
    expect(limited.state.limit).toBe(10);
  });

  it('returns a new instance from skip()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    const skipped = col.skip(5);
    expect(skipped).not.toBe(col);
    expect(skipped.state.offset).toBe(5);
  });

  it('does not mutate original instance', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(col.state.filters).toHaveLength(0);
  });

  it('chains where, orderBy, take, skip together', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor)
      .where(MongoFieldFilter.eq('active', true))
      .orderBy({ name: 1 })
      .skip(10)
      .take(5);

    expect(col.state.filters).toHaveLength(1);
    expect(col.state.orderBy).toEqual({ name: 1 });
    expect(col.state.offset).toBe(10);
    expect(col.state.limit).toBe(5);
  });

  it('preserves custom subclasses via #createSelf', () => {
    const executor = createMockExecutor();

    class CustomCollection<
      C extends MongoContractWithTypeMaps<never, never>,
      M extends string & keyof C['models'],
    > extends MongoCollection<C, M> {}

    const col = new CustomCollection(minimalContract, 'User', executor);
    const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(filtered).toBeInstanceOf(CustomCollection);
  });
});

describe('MongoCollection include()', () => {
  it('adds a relation include', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor).include('posts');
    expect(col.state.includes).toHaveLength(1);
    expect(col.state.includes[0]).toEqual({
      relationName: 'posts',
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      cardinality: '1:N',
    });
  });

  it('throws for unknown relation', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'User', executor);
    expect(() => col.include('nonexistent')).toThrow('Unknown relation');
  });

  it('throws for embed relation', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(minimalContract, 'Post', executor);
    expect(() => col.include('comments')).toThrow('embed relation');
  });
});

describe('MongoCollection terminal methods', () => {
  it('all() executes the compiled plan', () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice' }]);
    const col = new MongoCollection(minimalContract, 'User', executor);
    col.all();
    expect(executor.lastPlan).toBeDefined();
    expect(executor.lastPlan!.collection).toBe('users');
  });

  it('first() returns the first row', async () => {
    const executor = createMockExecutor([
      { _id: '1', name: 'Alice' },
      { _id: '2', name: 'Bob' },
    ]);
    const col = new MongoCollection(minimalContract, 'User', executor);
    const result = await col.first();
    expect(result).toEqual({ _id: '1', name: 'Alice' });
  });

  it('first() returns null when no results', async () => {
    const executor = createMockExecutor([]);
    const col = new MongoCollection(minimalContract, 'User', executor);
    const result = await col.first();
    expect(result).toBeNull();
  });

  it('first() sets limit 1 on the compiled plan', async () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice' }]);
    const col = new MongoCollection(minimalContract, 'User', executor);
    await col.first();
    expect(executor.lastPlan!.stages.some((s) => s.kind === 'limit')).toBe(true);
  });
});
