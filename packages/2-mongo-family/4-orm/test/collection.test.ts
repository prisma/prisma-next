import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import {
  MongoFieldFilter,
  type MongoLimitStage,
  type MongoLookupStage,
  type MongoMatchStage,
  type MongoProjectStage,
  type MongoReadStage,
  type MongoSkipStage,
  type MongoSortStage,
} from '@prisma-next/mongo-query-ast';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../1-core/test/fixtures/orm-contract';
import ormContractJson from '../../1-core/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';

const contract = ormContractJson as unknown as Contract;

function createMockExecutor(...responses: unknown[][]): MongoQueryExecutor & {
  lastPlan: MongoQueryPlan | undefined;
  readonly lastCommand: MongoQueryPlan['command'] | undefined;
  readonly lastStages: ReadonlyArray<MongoReadStage> | undefined;
} {
  let callIndex = 0;
  const mock = {
    lastPlan: undefined as MongoQueryPlan | undefined,
    get lastCommand() {
      return mock.lastPlan?.command;
    },
    get lastStages(): ReadonlyArray<MongoReadStage> | undefined {
      const cmd = mock.lastPlan?.command;
      if (cmd?.kind === 'aggregate') return cmd.pipeline as ReadonlyArray<MongoReadStage>;
      return undefined;
    },
    execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      mock.lastPlan = plan as MongoQueryPlan;
      const data = responses[callIndex] ?? [];
      if (callIndex < responses.length - 1) callIndex++;
      async function* gen(): AsyncGenerator<Row> {
        for (const row of data) yield row as Row;
      }
      return new AsyncIterableResult(gen());
    },
  };
  return mock;
}

describe('MongoCollection chaining', () => {
  it('returns a new instance from where()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
    expect(filtered).not.toBe(col);
  });

  it('accumulates filters from multiple where() calls', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .where(MongoFieldFilter.gte('email', 'a'));
    col.all();
    const match = executor.lastStages![0] as MongoMatchStage;
    expect(match.filter.kind).toBe('and');
  });

  it('returns a new instance from select()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const selected = col.select('name');
    expect(selected).not.toBe(col);
    selected.all();
    expect(executor.lastStages!.some((s) => s.kind === 'project')).toBe(true);
  });

  it('accumulates fields across multiple select() calls', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor).select('name').select('_id');
    col.all();
    const project = executor.lastStages!.find((s) => s.kind === 'project') as MongoProjectStage;
    expect(project.projection).toEqual({ name: 1, _id: 1 });
  });

  it('returns a new instance from orderBy()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const ordered = col.orderBy({ name: 1 });
    expect(ordered).not.toBe(col);
    ordered.all();
    const sort = executor.lastStages!.find((s) => s.kind === 'sort') as MongoSortStage;
    expect(sort.sort).toEqual({ name: 1 });
  });

  it('merges orderBy across calls', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .orderBy({ name: 1 })
      .orderBy({ email: -1 });
    col.all();
    const sort = executor.lastStages!.find((s) => s.kind === 'sort') as MongoSortStage;
    expect(sort.sort).toEqual({ name: 1, email: -1 });
  });

  it('returns a new instance from take()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const limited = col.take(10);
    expect(limited).not.toBe(col);
    limited.all();
    const limit = executor.lastStages!.find((s) => s.kind === 'limit') as MongoLimitStage;
    expect(limit.limit).toBe(10);
  });

  it('returns a new instance from skip()', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const skipped = col.skip(5);
    expect(skipped).not.toBe(col);
    skipped.all();
    const skip = executor.lastStages!.find((s) => s.kind === 'skip') as MongoSkipStage;
    expect(skip.skip).toBe(5);
  });

  it('does not mutate original instance', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    col.where(MongoFieldFilter.eq('name', 'Alice'));
    col.all();
    expect(executor.lastStages!).toHaveLength(0);
  });

  it('chains where, orderBy, take, skip together', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor)
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .orderBy({ name: 1 })
      .skip(10)
      .take(5);
    col.all();
    const stageKinds = executor.lastStages!.map((s) => s.kind);
    expect(stageKinds).toEqual(['match', 'sort', 'skip', 'limit']);
  });
});

describe('MongoCollection include()', () => {
  it('adds a relation include', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor).include('assignee');
    col.all();
    const lookup = executor.lastStages!.find((s) => s.kind === 'lookup') as MongoLookupStage;
    expect(lookup.from).toBe('users');
    expect(lookup.localField).toBe('assigneeId');
    expect(lookup.foreignField).toBe('_id');
    expect(lookup.as).toBe('assignee');
  });

  it('throws for unknown relation', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor);
    // @ts-expect-error 'nonexistent' is not a valid reference relation key
    expect(() => col.include('nonexistent')).toThrow('Unknown relation');
  });

  it('throws for embed relation', () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'Task', executor);
    // @ts-expect-error 'comments' is an embed relation, not a reference relation
    expect(() => col.include('comments')).toThrow('embed relation');
  });
});

describe('MongoCollection terminal methods', () => {
  it('all() executes the compiled plan', () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice', email: 'a@b.c' }]);
    const col = createMongoCollection(contract, 'User', executor);
    col.all();
    expect(executor.lastPlan).toBeDefined();
    expect(executor.lastPlan!.collection).toBe('users');
    expect(executor.lastPlan!.command.kind).toBe('aggregate');
  });

  it('first() returns the first row', async () => {
    const executor = createMockExecutor([
      { _id: '1', name: 'Alice', email: 'a@b.c' },
      { _id: '2', name: 'Bob', email: 'b@b.c' },
    ]);
    const col = createMongoCollection(contract, 'User', executor);
    const result = await col.first();
    expect(result).toEqual({ _id: '1', name: 'Alice', email: 'a@b.c' });
  });

  it('first() returns null when no results', async () => {
    const executor = createMockExecutor();
    const col = createMongoCollection(contract, 'User', executor);
    const result = await col.first();
    expect(result).toBeNull();
  });

  it('first() sets limit 1 on the compiled plan', async () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice', email: 'a@b.c' }]);
    const col = createMongoCollection(contract, 'User', executor);
    await col.first();
    const limitStage = executor.lastStages!.find((s) => s.kind === 'limit') as
      | MongoLimitStage
      | undefined;
    expect(limitStage?.limit).toBe(1);
  });
});

describe('MongoCollection write methods', () => {
  describe('create()', () => {
    it('returns created row with _id from insertedId', async () => {
      const executor = createMockExecutor([{ insertedId: 'new-id-1' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.create({ name: 'Alice', email: 'a@b.c' });
      expect(result).toEqual({ _id: 'new-id-1', name: 'Alice', email: 'a@b.c' });
    });

    it('sends an InsertOneCommand', async () => {
      const executor = createMockExecutor([{ insertedId: 'id' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.create({ name: 'Bob', email: 'b@b.c' });
      expect(executor.lastCommand).toBeDefined();
      expect(executor.lastCommand!.kind).toBe('insertOne');
      expect(executor.lastCommand!.collection).toBe('users');
    });
  });

  describe('createAll()', () => {
    it('returns all created rows with _ids', async () => {
      const executor = createMockExecutor([{ insertedIds: ['id-1', 'id-2'], insertedCount: 2 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const rows: unknown[] = [];
      for await (const row of col.createAll([
        { name: 'Alice', email: 'a@b.c' },
        { name: 'Bob', email: 'b@b.c' },
      ])) {
        rows.push(row);
      }
      expect(rows).toEqual([
        { _id: 'id-1', name: 'Alice', email: 'a@b.c' },
        { _id: 'id-2', name: 'Bob', email: 'b@b.c' },
      ]);
    });
  });

  describe('createCount()', () => {
    it('returns the count of inserted documents', async () => {
      const executor = createMockExecutor([{ insertedIds: ['a', 'b'], insertedCount: 2 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col.createCount([
        { name: 'Alice', email: 'a@b.c' },
        { name: 'Bob', email: 'b@b.c' },
      ]);
      expect(count).toBe(2);
    });
  });

  describe('update()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.update({ name: 'Changed' })).rejects.toThrow('requires a .where()');
    });

    it('returns updated row via findOneAndUpdate', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col
        .where(MongoFieldFilter.eq('_id', 'id-1'))
        .update({ name: 'Updated' });
      expect(result).toEqual({ _id: 'id-1', name: 'Updated', email: 'a@b.c' });
      expect(executor.lastCommand!.kind).toBe('findOneAndUpdate');
    });

    it('passes MongoFilterExpr to command', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Updated', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).update({ name: 'Updated' });
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndUpdate');
      if (command.kind === 'findOneAndUpdate') {
        expect(command.filter).not.toBeNull();
        expect(command.filter!.kind).toBe('field');
      }
    });

    it('returns null when no match', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('_id', 'missing')).update({ name: 'X' });
      expect(result).toBeNull();
    });
  });

  describe('updateCount()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.updateCount({ name: 'X' })).rejects.toThrow('requires a .where()');
    });

    it('returns the modified count', async () => {
      const executor = createMockExecutor([{ matchedCount: 3, modifiedCount: 3 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col.where(MongoFieldFilter.eq('email', 'a')).updateCount({ name: 'X' });
      expect(count).toBe(3);
    });
  });

  describe('delete()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.delete()).rejects.toThrow('requires a .where()');
    });

    it('returns deleted row via findOneAndDelete', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('_id', 'id-1')).delete();
      expect(result).toEqual({ _id: 'id-1', name: 'Alice', email: 'a@b.c' });
      expect(executor.lastCommand!.kind).toBe('findOneAndDelete');
    });

    it('passes MongoFilterExpr to command', async () => {
      const executor = createMockExecutor([{ _id: 'id-1', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.where(MongoFieldFilter.eq('_id', 'id-1')).delete();
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndDelete');
      if (command.kind === 'findOneAndDelete') {
        expect(command.filter.kind).toBe('field');
      }
    });

    it('returns null when no match', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.where(MongoFieldFilter.eq('_id', 'none')).delete();
      expect(result).toBeNull();
    });
  });

  describe('deleteCount()', () => {
    it('throws without .where()', async () => {
      const executor = createMockExecutor();
      const col = createMongoCollection(contract, 'User', executor);
      await expect(col.deleteCount()).rejects.toThrow('requires a .where()');
    });

    it('returns the deleted count', async () => {
      const executor = createMockExecutor([{ deletedCount: 2 }]);
      const col = createMongoCollection(contract, 'User', executor);
      const count = await col.where(MongoFieldFilter.eq('email', 'x')).deleteCount();
      expect(count).toBe(2);
    });
  });

  describe('upsert()', () => {
    it('sends findOneAndUpdate with upsert true', async () => {
      const executor = createMockExecutor([{ _id: 'new-id', name: 'Alice', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      const result = await col.upsert({
        create: { name: 'Alice', email: 'a@b.c' },
        update: { name: 'Alice Updated' },
      });
      expect(result).toEqual({ _id: 'new-id', name: 'Alice', email: 'a@b.c' });
      expect(executor.lastCommand!.kind).toBe('findOneAndUpdate');
    });

    it('passes null filter when no where clause', async () => {
      const executor = createMockExecutor([{ _id: 'id', name: 'A', email: 'a@b.c' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.upsert({
        create: { name: 'A', email: 'a@b.c' },
        update: { name: 'B' },
      });
      const command = executor.lastCommand!;
      expect(command.kind).toBe('findOneAndUpdate');
      if (command.kind === 'findOneAndUpdate') {
        expect(command.filter).toBeNull();
      }
    });
  });

  describe('immutability', () => {
    it('write methods do not mutate collection state', async () => {
      const executor = createMockExecutor([{ insertedId: 'x' }]);
      const col = createMongoCollection(contract, 'User', executor);
      await col.create({ name: 'Alice', email: 'a@b.c' });
      const filtered = col.where(MongoFieldFilter.eq('name', 'Alice'));
      expect(filtered).not.toBe(col);
    });
  });
});
