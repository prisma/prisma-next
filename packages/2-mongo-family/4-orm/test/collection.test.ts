import type { MongoReadPlan } from '@prisma-next/mongo-query-ast';
import { lowerPipeline, MongoFieldFilter } from '@prisma-next/mongo-query-ast';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../1-core/test/fixtures/orm-contract';
import ormContractJson from '../../1-core/test/fixtures/orm-contract.json';
import { MongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';

const contract = ormContractJson as unknown as Contract;

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

function loweredStageKinds(plan: MongoReadPlan): string[] {
  return lowerPipeline(plan.stages).map((s) => Object.keys(s)[0] as string);
}

describe('MongoCollection chaining', () => {
  it('returns a new instance from where()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor);
    const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(filtered).not.toBe(col);
    expect(filtered).toBeInstanceOf(MongoCollection);
  });

  it('accumulates filters from multiple where() calls', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .where(MongoFieldFilter.gte('email', 'a'));
    col.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    expect(lowered[0]).toEqual({
      $match: { $and: [{ name: { $eq: 'Alice' } }, { email: { $gte: 'a' } }] },
    });
  });

  it('returns a new instance from select()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor);
    const selected = col.select('name');
    expect(selected).not.toBe(col);
    selected.all();
    expect(loweredStageKinds(executor.lastPlan!)).toContain('$project');
  });

  it('accumulates fields across multiple select() calls', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor).select('name').select('_id');
    col.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    const project = lowered.find((s) => '$project' in s);
    expect(project).toEqual({ $project: { name: 1, _id: 1 } });
  });

  it('returns a new instance from orderBy()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor);
    const ordered = col.orderBy({ name: 1 });
    expect(ordered).not.toBe(col);
    ordered.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    expect(lowered).toContainEqual({ $sort: { name: 1 } });
  });

  it('merges orderBy across calls', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor)
      .orderBy({ name: 1 })
      .orderBy({ email: -1 });
    col.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    expect(lowered).toContainEqual({ $sort: { name: 1, email: -1 } });
  });

  it('returns a new instance from take()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor);
    const limited = col.take(10);
    expect(limited).not.toBe(col);
    limited.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    expect(lowered).toContainEqual({ $limit: 10 });
  });

  it('returns a new instance from skip()', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor);
    const skipped = col.skip(5);
    expect(skipped).not.toBe(col);
    skipped.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    expect(lowered).toContainEqual({ $skip: 5 });
  });

  it('does not mutate original instance', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor);
    col.where(MongoFieldFilter.eq('name', 'Alice'));
    col.all();
    expect(executor.lastPlan!.stages).toHaveLength(0);
  });

  it('chains where, orderBy, take, skip together', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .orderBy({ name: 1 })
      .skip(10)
      .take(5);
    col.all();
    const stageKinds = loweredStageKinds(executor.lastPlan!);
    expect(stageKinds).toEqual(['$match', '$sort', '$skip', '$limit']);
  });

  it('preserves custom subclasses via #createSelf', () => {
    const executor = createMockExecutor();

    class CustomCollection<
      C extends Contract,
      M extends string & keyof C['models'],
    > extends MongoCollection<C, M> {}

    const col = new CustomCollection(contract, 'User', executor);
    const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(filtered).toBeInstanceOf(CustomCollection);
  });
});

describe('MongoCollection include()', () => {
  it('adds a relation include', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'Task', executor).include('assignee');
    col.all();
    const lowered = lowerPipeline(executor.lastPlan!.stages);
    expect(lowered).toContainEqual({
      $lookup: {
        from: 'users',
        localField: 'assigneeId',
        foreignField: '_id',
        as: 'assignee',
      },
    });
  });

  it('throws for unknown relation', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'Task', executor);
    // @ts-expect-error 'nonexistent' is not a valid reference relation key
    expect(() => col.include('nonexistent')).toThrow('Unknown relation');
  });

  it('throws for embed relation', () => {
    const executor = createMockExecutor();
    const col = new MongoCollection(contract, 'Task', executor);
    // @ts-expect-error 'comments' is an embed relation, not a reference relation
    expect(() => col.include('comments')).toThrow('embed relation');
  });
});

describe('MongoCollection terminal methods', () => {
  it('all() executes the compiled plan', () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice', email: 'a@b.c' }]);
    const col = new MongoCollection(contract, 'User', executor);
    col.all();
    expect(executor.lastPlan).toBeDefined();
    expect(executor.lastPlan!.collection).toBe('users');
  });

  it('first() returns the first row', async () => {
    const executor = createMockExecutor([
      { _id: '1', name: 'Alice', email: 'a@b.c' },
      { _id: '2', name: 'Bob', email: 'b@b.c' },
    ]);
    const col = new MongoCollection(contract, 'User', executor);
    const result = await col.first();
    expect(result).toEqual({ _id: '1', name: 'Alice', email: 'a@b.c' });
  });

  it('first() returns null when no results', async () => {
    const executor = createMockExecutor([]);
    const col = new MongoCollection(contract, 'User', executor);
    const result = await col.first();
    expect(result).toBeNull();
  });

  it('first() sets limit 1 on the compiled plan', async () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice', email: 'a@b.c' }]);
    const col = new MongoCollection(contract, 'User', executor);
    await col.first();
    const limitStage = executor.lastPlan!.stages.find((s) => s.kind === 'limit') as
      | { kind: 'limit'; limit: number }
      | undefined;
    expect(limitStage?.limit).toBe(1);
  });
});
