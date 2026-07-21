import { describe, expectTypeOf, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import type { MongoCollection } from '../src/collection';
import { Collection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import { mongoOrm } from '../src/mongo-orm';

const contract = ormContractJson as unknown as Contract;
declare const executor: MongoQueryExecutor;

class UserRepository extends Collection<Contract, 'User'> {
  byName(name: string) {
    return this.where({ name });
  }

  newestFirst() {
    return this.orderBy({ _id: -1 });
  }
}

class NotACollection {
  constructor(
    public a: unknown,
    public b: unknown,
    public c: unknown,
  ) {}
}

describe('custom collection typing', () => {
  it('a registered root is typed as the subclass', () => {
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    expectTypeOf(client.users).toEqualTypeOf<UserRepository>();
    expectTypeOf(client.users.byName).toBeFunction();
  });

  it('unregistered roots keep the base collection type', () => {
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    expectTypeOf(client.tasks).toEqualTypeOf<MongoCollection<Contract, 'Task'>>();
  });

  it('no collections option keeps every root on the base type', () => {
    const client = mongoOrm({ contract, executor });
    expectTypeOf(client.users).toEqualTypeOf<MongoCollection<Contract, 'User'>>();
  });

  it('domain methods return a chainable collection', async () => {
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    const first = await client.users.byName('Alice').take(1).first();
    expectTypeOf(first).not.toBeAny();
  });

  it('base chaining methods preserve the subclass type', () => {
    const client = mongoOrm({ contract, executor, collections: { User: UserRepository } });
    const chained = client.users.byName('Alice').take(1).skip(1).newestFirst();
    expectTypeOf(chained).toEqualTypeOf<UserRepository>();
    expectTypeOf(
      client.users.where({ name: 'A' }).select('name').byName('B'),
    ).toEqualTypeOf<UserRepository>();
  });

  it('only Collection subclasses are accepted in the registry', () => {
    // @ts-expect-error a class that does not extend Collection is rejected
    mongoOrm({ contract, executor, collections: { User: NotACollection } });
  });
});
