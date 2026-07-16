import { MongoContractSerializer } from '@prisma-next/family-mongo/ir';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { MongoFieldFilter, MongoOrExpr } from '@prisma-next/mongo-query-ast/execution';
import { expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import ormContractJson from './fixtures/generated/contract.json';
import { describeWithMongoDB } from './setup';

const contract = new MongoContractSerializer().deserializeContract(ormContractJson) as Contract;

// Ported from upstream MongoDB-only regressions:
//   #103 prisma/prisma#13089 — a `$`-prefixed string value is data, not a Mongo operator.
//   #104 prisma-engines prisma_22007 — `OR: [{ NOT: { f: "b" } }, { f: "c" } ]` evaluates to {a, c}.
describeWithMongoDB('ported MongoDB regressions', (ctx) => {
  it('#103 filters by a string value containing a literal `$`', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'foo', email: 'foo@example.com', addresses: [] },
      { name: '$foo', email: 'dollar-foo@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.where(MongoFieldFilter.eq('name', '$foo')).all();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: '$foo', email: 'dollar-foo@example.com' });
  });

  it('#103 updates a record matched by a string value containing a literal `$`', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'foo', email: 'foo@example.com', addresses: [] },
      { name: '$foo', email: 'dollar-foo@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const updated = await orm.users
      .where(MongoFieldFilter.eq('name', '$foo'))
      .update({ name: '$$foo' });

    expect(updated).toMatchObject({ name: '$$foo', email: 'dollar-foo@example.com' });

    const afterUpdate = await orm.users.where(MongoFieldFilter.eq('name', '$$foo')).all();
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]).toMatchObject({ name: '$$foo' });

    const originalGone = await orm.users.where(MongoFieldFilter.eq('name', '$foo')).all();
    expect(originalGone).toHaveLength(0);
  });

  it('#104 renders `OR: [{ NOT: b }, c ]` to the {a, c} result set', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'a', email: 'a@example.com', addresses: [] },
      { name: 'b', email: 'b@example.com', addresses: [] },
      { name: 'c', email: 'c@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const filter = MongoOrExpr.of([
      MongoFieldFilter.eq('name', 'b').not(),
      MongoFieldFilter.eq('name', 'c'),
    ]);
    const results = await orm.users.where(filter).orderBy({ name: 1 }).all();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(['a', 'c']);
  });
});
