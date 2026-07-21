import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type {
  MongoMatchStage,
  MongoQueryPlan,
  MongoSortStage,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import {
  Collection,
  createMongoCollection,
  isMongoCollectionClass,
  MONGO_ORM_COLLECTION_BRAND,
} from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import { mongoOrm } from '../src/mongo-orm';

const contract = ormContractJson as unknown as Contract;

function createMockExecutor(...responses: unknown[][]): MongoQueryExecutor & {
  lastPlan: MongoQueryPlan | undefined;
  readonly lastStages: ReadonlyArray<unknown> | undefined;
} {
  let callIndex = 0;
  const mock = {
    lastPlan: undefined as MongoQueryPlan | undefined,
    get lastStages(): ReadonlyArray<unknown> | undefined {
      const cmd = mock.lastPlan?.command;
      if (cmd?.kind === 'aggregate') return cmd.pipeline as ReadonlyArray<unknown>;
      return undefined;
    },
    execute<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      mock.lastPlan = plan as MongoQueryPlan;
      const data = responses[callIndex] ?? [];
      callIndex++;
      async function* gen(): AsyncGenerator<Row> {
        for (const row of data) yield row as Row;
      }
      return new AsyncIterableResult(gen());
    },
  };
  return mock;
}

class UserRepository extends Collection<Contract, 'User'> {
  byName(name: string) {
    return this.where({ name });
  }

  newestFirst() {
    return this.orderBy({ _id: -1 });
  }
}

class TaskRepository extends Collection<Contract, 'Task'> {
  bugs() {
    return this.variant('Bug');
  }
}

describe('custom collection subclasses', () => {
  it('mongoOrm exposes a registered subclass on its root', () => {
    const executor = createMockExecutor();
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    expect(client.users).toBeInstanceOf(UserRepository);
  });

  it('roots without a registered subclass get the base collection', () => {
    const executor = createMockExecutor();
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    expect(client.tasks).toBeInstanceOf(Collection);
    expect(client.tasks).not.toBeInstanceOf(UserRepository);
  });

  it('a domain method compiles the same plan as the base collection', async () => {
    const repoExecutor = createMockExecutor([]);
    const baseExecutor = createMockExecutor([]);
    const client = mongoOrm({
      contract,
      executor: repoExecutor,
      collections: { User: UserRepository },
    });
    const base = createMongoCollection(contract, 'User', baseExecutor);

    for await (const _row of client.users.byName('Alice').all()) {
      // drain
    }
    for await (const _row of base.where({ name: 'Alice' }).all()) {
      // drain
    }

    const repoMatch = repoExecutor.lastStages?.[0] as MongoMatchStage;
    const baseMatch = baseExecutor.lastStages?.[0] as MongoMatchStage;
    expect(repoMatch).toEqual(baseMatch);
  });

  it('chaining preserves the subclass', () => {
    const executor = createMockExecutor();
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    const users = client.users;
    expect(users.byName('Alice')).toBeInstanceOf(UserRepository);
    expect(users.newestFirst()).toBeInstanceOf(UserRepository);
    expect(users.byName('Alice').take(5).skip(1).select('name')).toBeInstanceOf(UserRepository);
  });

  it('variant() preserves the subclass', () => {
    const executor = createMockExecutor();
    const client = mongoOrm({ contract, executor, collections: { Task: TaskRepository } });
    const tasks = client.tasks;
    expect(tasks.bugs()).toBeInstanceOf(TaskRepository);
  });

  it('rejects a registered class that does not extend Collection', () => {
    class NotACollection {}
    const executor = createMockExecutor();
    expect(() =>
      mongoOrm({ contract, executor, collections: { User: NotACollection as never } }),
    ).toThrow("Custom collection 'User' must be a Collection class");
  });

  it('rejects an instance where a class was expected', () => {
    const executor = createMockExecutor();
    expect(() =>
      mongoOrm({
        contract,
        executor,
        collections: { User: new UserRepository(contract, 'User', executor) as never },
      }),
    ).toThrow("Custom collection 'User' must be a Collection class");
  });

  it('rejects a key that names no model, rather than silently ignoring it', () => {
    const executor = createMockExecutor();
    expect(() => mongoOrm({ contract, executor, collections: { Uesr: UserRepository } })).toThrow(
      "No model found for custom collection 'Uesr'",
    );
  });

  it('rejects the registry before constructing any of its classes', () => {
    let constructed = false;
    class EagerRepository extends Collection<Contract, 'User'> {
      constructor(c: Contract, m: 'User', e: MongoQueryExecutor) {
        super(c, m, e);
        constructed = true;
      }
    }
    const executor = createMockExecutor();
    expect(() =>
      mongoOrm({
        contract,
        executor,
        collections: { User: EagerRepository, Uesr: UserRepository },
      }),
    ).toThrow("No model found for custom collection 'Uesr'");
    expect(constructed).toBe(false);
  });

  it('recognises a subclass from a duplicated package copy, where instanceof fails', () => {
    class ForeignCopyCollection {
      static readonly [MONGO_ORM_COLLECTION_BRAND] = true;
      readonly modelName: string;
      constructor(_contract: Contract, modelName: string, _executor: MongoQueryExecutor) {
        this.modelName = modelName;
      }
    }
    expect(ForeignCopyCollection.prototype instanceof Collection).toBe(false);
    expect(isMongoCollectionClass(ForeignCopyCollection)).toBe(true);
    expect(isMongoCollectionClass(UserRepository)).toBe(true);
    expect(isMongoCollectionClass(class Unrelated {})).toBe(false);
    expect(isMongoCollectionClass(new UserRepository(contract, 'User', createMockExecutor()))).toBe(
      false,
    );
  });

  it('a directly constructed subclass executes queries', async () => {
    const executor = createMockExecutor([{ _id: '1', name: 'Alice' }]);
    const repo = new UserRepository(contract, 'User', executor);
    const row = await repo.byName('Alice').first();
    expect(row).toEqual({ _id: '1', name: 'Alice' });
  });

  it('domain methods compose with base chaining before execution', async () => {
    const executor = createMockExecutor([]);
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    const users = client.users;
    for await (const _row of users.byName('Alice').orderBy({ name: 1 }).take(2).all()) {
      // drain
    }
    const stages = executor.lastStages as Array<MongoMatchStage | MongoSortStage>;
    expect(stages.map((s) => (s as { kind: string }).kind).slice(0, 3)).toEqual([
      'match',
      'sort',
      'limit',
    ]);
  });
});
