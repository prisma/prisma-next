import { mongoOrm } from '@prisma-next/mongo-orm';
import { acc, mongoPipeline } from '@prisma-next/mongo-pipeline-builder';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import { expect, expectTypeOf, it } from 'vitest';
import { contract } from './fixtures/contract';
import { describeWithMongoDB } from './setup';

type PlanRow<TPlan> = TPlan extends MongoQueryPlan<infer Row> ? Row : never;

describeWithMongoDB('Mongo no-emit integration', (ctx) => {
  it('mongoOrm executes with a builder-authored contract directly', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertOne({
      _id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [],
    });
    await db.collection('tasks').insertOne({
      _id: 't1',
      title: 'Fix bug',
      type: 'bug',
      assigneeId: 'u1',
      severity: 'high',
      comments: [{ _id: 'c1', text: 'Investigating', createdAt: new Date('2025-01-01') }],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const tasks = await orm.tasks.include('assignee').all();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Fix bug',
      assignee: {
        name: 'Alice',
        email: 'alice@example.com',
      },
    });
    expect(tasks[0]!.comments[0]).toMatchObject({
      text: 'Investigating',
    });

    expectTypeOf(tasks[0]!.comments[0]!.createdAt).toEqualTypeOf<Date>();

    if (tasks[0]!.type === 'bug') {
      expectTypeOf(tasks[0]!.severity).toEqualTypeOf<string>();
    }
  });

  it('mongoPipeline executes with a builder-authored contract directly', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertOne({
      _id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [],
    });
    await db.collection('tasks').insertMany([
      {
        _id: 't1',
        title: 'Fix crash',
        type: 'bug',
        assigneeId: 'u1',
        severity: 'critical',
        comments: [],
      },
      {
        _id: 't2',
        title: 'Fix typo',
        type: 'bug',
        assigneeId: 'u1',
        severity: 'low',
        comments: [],
      },
    ]);

    const plan = mongoPipeline<typeof contract>({ contractJson: contract })
      .from('tasks')
      .group((f) => ({
        _id: f.type,
        count: acc.count(),
      }))
      .build();

    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      count: number;
    }>();

    const results = await ctx.runtime.execute(plan).toArray();

    expect(results).toEqual([
      {
        _id: 'bug',
        count: 2,
      },
    ]);
  });
});
