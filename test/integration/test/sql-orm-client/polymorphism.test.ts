import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { withReturningCapability } from '../collection-fixtures';
import { buildMixedPolyContract, getTestContext, type TestContract } from '../helpers';
import { timeouts, withCollectionRuntime } from './helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

function polyContract() {
  return withReturningCapability(buildMixedPolyContract()) as TestContract;
}

function createTaskCollection(runtime: PgIntegrationRuntime) {
  const contract = polyContract();
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Task');
}

async function setupPolySchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists features');
  await runtime.query('drop table if exists tasks');

  await runtime.query(`
    create table tasks (
      id serial primary key,
      title text not null,
      type text not null,
      severity text
    )
  `);

  await runtime.query(`
    create table features (
      id integer primary key references tasks(id),
      priority integer not null
    )
  `);
}

async function seedPolyData(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(
    "insert into tasks (id, title, type, severity) values (1, 'Crash on login', 'bug', 'critical')",
  );
  await runtime.query(
    "insert into tasks (id, title, type, severity) values (2, 'Null ref in parser', 'bug', 'low')",
  );
  await runtime.query("insert into tasks (id, title, type) values (3, 'Dark mode', 'feature')");
  await runtime.query('insert into features (id, priority) values (3, 1)');
  await runtime.query("insert into tasks (id, title, type) values (4, 'Export to PDF', 'feature')");
  await runtime.query('insert into features (id, priority) values (4, 3)');
}

describe('integration/polymorphism', () => {
  it(
    'base query returns all variants with discriminator-aware mapping',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await seedPolyData(runtime);

        const tasks = createTaskCollection(runtime);
        const rows = await tasks.all().toArray();

        expect(rows).toHaveLength(4);

        const bug = rows.find((r) => r['title'] === 'Crash on login');
        expect(bug).toMatchObject({
          id: 1,
          title: 'Crash on login',
          type: 'bug',
          severity: 'critical',
        });
        expect(bug).not.toHaveProperty('priority');

        const feature = rows.find((r) => r['title'] === 'Dark mode');
        expect(feature).toMatchObject({ id: 3, title: 'Dark mode', type: 'feature', priority: 1 });
        expect(feature).not.toHaveProperty('severity');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'variant(Bug) query returns only STI Bug rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await seedPolyData(runtime);

        const tasks = createTaskCollection(runtime);
        const bugs = await (tasks.variant('Bug' as never) as typeof tasks).all().toArray();

        expect(bugs).toHaveLength(2);
        for (const bug of bugs) {
          expect(bug['type']).toBe('bug');
          expect(bug).toHaveProperty('severity');
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'variant(Feature) query INNER JOINs and returns only MTI Feature rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);
        await seedPolyData(runtime);

        const tasks = createTaskCollection(runtime);
        const features = await (tasks.variant('Feature' as never) as typeof tasks).all().toArray();

        expect(features).toHaveLength(2);
        for (const feature of features) {
          expect(feature['type']).toBe('feature');
          expect(feature).toHaveProperty('priority');
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'STI variant create auto-injects discriminator and returns mapped row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        const tasks = createTaskCollection(runtime);
        const bugs = tasks.variant('Bug' as never) as typeof tasks;
        const created = await bugs.create({ title: 'New bug', severity: 'high' } as never);

        expect(created).toMatchObject({ title: 'New bug', type: 'bug', severity: 'high' });
        expect(created['id']).toBeDefined();

        const rows = await runtime.query<{ type: string }>('select type from tasks where id = $1', [
          created['id'],
        ]);
        expect(rows[0]!.type).toBe('bug');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'MTI variant create inserts into both tables within a transaction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupPolySchema(runtime);

        const tasks = createTaskCollection(runtime);
        const features = tasks.variant('Feature' as never) as typeof tasks;
        const created = await features.create({
          title: 'New feature',
          priority: 5,
        } as never);

        expect(created).toMatchObject({ title: 'New feature', type: 'feature', priority: 5 });
        expect(created['id']).toBeDefined();

        const baseRows = await runtime.query<{ title: string; type: string }>(
          'select title, type from tasks where id = $1',
          [created['id']],
        );
        expect(baseRows).toHaveLength(1);
        expect(baseRows[0]).toMatchObject({ title: 'New feature', type: 'feature' });

        const variantRows = await runtime.query<{ priority: number }>(
          'select priority from features where id = $1',
          [created['id']],
        );
        expect(variantRows).toHaveLength(1);
        expect(variantRows[0]!.priority).toBe(5);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
