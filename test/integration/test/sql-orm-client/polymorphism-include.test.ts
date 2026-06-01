import { Collection } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  getTestContext,
  type TestContract,
} from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

// The poly contracts are patched in at runtime, so the parent models
// (`Account` / `Project`) and their polymorphic-target relations are
// absent from the static `TestContract` Models type. These minimal
// surfaces let the tests drive `.include('<polyRel>')` and read the
// included rows without a static contract for the patched models. This
// mirrors the cast pattern the unit `collection-variant.test.ts` uses.
interface ScalarFilter {
  eq(value: unknown): unknown;
  gte(value: unknown): unknown;
}
interface TaskRefinementRow {
  severity: ScalarFilter;
  priority: ScalarFilter;
}
interface PolyIncludeRefinement {
  variant(name: string): PolyIncludeRefinement;
  where(predicate: (row: TaskRefinementRow) => unknown): PolyIncludeRefinement;
}
interface PolyIncludeParent {
  include(
    relation: string,
    refine?: (collection: PolyIncludeRefinement) => PolyIncludeRefinement,
  ): {
    all(): { toArray(): Promise<Record<string, unknown>[]> };
  };
}

// Build the parent-bearing poly contracts locally rather than widening the
// shared `buildStiPolyContract` / `buildMixedPolyContract` helpers: a parent
// relation + FK column on the poly child is only needed by these
// include-against-a-poly-target tests, and adding it to the shared helpers
// breaks sibling tests whose hand-rolled DDL omits the FK column. This is the
// "standalone poly fixture, shared contract stays stable" position.
type RawContract = {
  domain: { namespaces: Record<string, { models: Record<string, MutableModel> }> };
  storage: { namespaces: Record<string, { tables: Record<string, RawTable> }> };
};
type MutableModel = {
  fields: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: { table: string; fields: Record<string, { column: string }> };
};
type RawTable = {
  columns: Record<string, unknown>;
  primaryKey: { columns: string[] };
  uniques: never[];
  indexes: never[];
  foreignKeys: never[];
};

function rawOf(contract: TestContract): RawContract {
  return JSON.parse(JSON.stringify(contract)) as RawContract;
}

function modelsOf(raw: RawContract): Record<string, MutableModel> {
  return Object.values(raw.domain.namespaces)[0]!.models;
}

function tablesOf(raw: RawContract): Record<string, RawTable> {
  return Object.values(raw.storage.namespaces)[0]!.tables;
}

// Account (parent) --members(1:N)--> User (STI poly target).
function buildStiIncludeContract(): TestContract {
  const raw = rawOf(buildStiPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const user = models['User']!;
  user.fields['accountId'] = { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
  user.storage.fields['accountId'] = { column: 'account_id' };
  tables['users']!.columns['account_id'] = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: true,
  };

  models['Account'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {
      members: {
        to: { model: 'User' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['accountId'] },
      },
    },
    storage: { table: 'accounts', fields: { id: { column: 'id' }, name: { column: 'name' } } },
  };
  tables['accounts'] = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Project (parent) --tasks(1:N)--> Task (Bug STI / Feature MTI poly target).
function buildMtiIncludeContract(): TestContract {
  const raw = rawOf(buildMixedPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const task = models['Task']!;
  task.fields['projectId'] = { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
  task.storage.fields['projectId'] = { column: 'project_id' };
  tables['tasks']!.columns['project_id'] = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: true,
  };

  models['Project'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {
      tasks: {
        to: { model: 'Task' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['projectId'] },
      },
    },
    storage: { table: 'projects_tbl', fields: { id: { column: 'id' }, name: { column: 'name' } } },
  };
  tables['projects_tbl'] = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

function createAccountCollection(runtime: PgIntegrationRuntime): PolyIncludeParent {
  const contract = buildStiIncludeContract();
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Account' as never) as unknown as PolyIncludeParent;
}

function createProjectCollection(runtime: PgIntegrationRuntime): PolyIncludeParent {
  const contract = buildMtiIncludeContract();
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Project' as never) as unknown as PolyIncludeParent;
}

async function setupStiIncludeSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists users');
  await runtime.query('drop table if exists accounts');

  await runtime.query(`
    create table accounts (
      id integer primary key,
      name text not null
    )
  `);
  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null,
      email text not null,
      invited_by_id integer,
      address jsonb,
      kind text not null,
      role text,
      plan text,
      account_id integer
    )
  `);
}

async function seedStiIncludeData(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query("insert into accounts (id, name) values (1, 'Acme')");
  await runtime.query("insert into accounts (id, name) values (2, 'Empty')");
  await runtime.query(
    "insert into users (id, name, email, kind, role, account_id) values (1, 'Ada', 'ada@x', 'admin', 'superadmin', 1)",
  );
  await runtime.query(
    "insert into users (id, name, email, kind, plan, account_id) values (2, 'Bob', 'bob@x', 'regular', 'free', 1)",
  );
  await runtime.query(
    "insert into users (id, name, email, kind, role, account_id) values (3, 'Cal', 'cal@x', 'admin', 'auditor', 1)",
  );
}

async function setupMtiIncludeSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists features');
  await runtime.query('drop table if exists tasks');
  await runtime.query('drop table if exists projects_tbl');

  await runtime.query(`
    create table projects_tbl (
      id integer primary key,
      name text not null
    )
  `);
  await runtime.query(`
    create table tasks (
      id integer primary key,
      title text not null,
      type text not null,
      severity text,
      project_id integer
    )
  `);
  await runtime.query(`
    create table features (
      id integer primary key references tasks(id),
      priority integer not null
    )
  `);
}

async function seedMtiIncludeData(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
  await runtime.query(
    "insert into tasks (id, title, type, severity, project_id) values (1, 'Crash on login', 'bug', 'critical', 1)",
  );
  await runtime.query(
    "insert into tasks (id, title, type, severity, project_id) values (2, 'Null ref', 'bug', 'low', 1)",
  );
  await runtime.query(
    "insert into tasks (id, title, type, project_id) values (3, 'Dark mode', 'feature', 1)",
  );
  await runtime.query('insert into features (id, priority) values (3, 1)');
  await runtime.query(
    "insert into tasks (id, title, type, project_id) values (4, 'Export PDF', 'feature', 1)",
  );
  await runtime.query('insert into features (id, priority) values (4, 3)');
}

describe('integration/polymorphism-include', () => {
  it(
    'STI-target include returns each child row shaped per its discriminator variant',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupStiIncludeSchema(runtime);
        await seedStiIncludeData(runtime);

        const accounts = createAccountCollection(runtime);
        const rows = await accounts.include('members').all().toArray();

        const acme = rows.find((r) => r['id'] === 1)!;
        const members = acme['members'] as Record<string, unknown>[];
        expect(members).toHaveLength(3);

        const ada = members.find((m) => m['id'] === 1)!;
        expect(ada).toMatchObject({ id: 1, name: 'Ada', kind: 'admin', role: 'superadmin' });
        // Admin rows must not carry the Regular variant's `plan` field.
        expect(ada).not.toHaveProperty('plan');

        const bob = members.find((m) => m['id'] === 2)!;
        expect(bob).toMatchObject({ id: 2, name: 'Bob', kind: 'regular', plan: 'free' });
        // Regular rows must not carry the Admin variant's `role` field.
        expect(bob).not.toHaveProperty('role');

        const cal = members.find((m) => m['id'] === 3)!;
        expect(cal).toMatchObject({ id: 3, kind: 'admin', role: 'auditor' });
        expect(cal).not.toHaveProperty('plan');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'MTI-target include returns rows with the variant tables columns present',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        const rows = await projects.include('tasks').all().toArray();

        const roadmap = rows.find((r) => r['id'] === 1)!;
        const tasks = roadmap['tasks'] as Record<string, unknown>[];
        expect(tasks).toHaveLength(4);

        const bug = tasks.find((t) => t['id'] === 1)!;
        expect(bug).toMatchObject({
          id: 1,
          title: 'Crash on login',
          type: 'bug',
          severity: 'critical',
        });
        // Bug (STI) rows must not carry the Feature (MTI) variant column.
        expect(bug).not.toHaveProperty('priority');

        const feature = tasks.find((t) => t['id'] === 3)!;
        // The MTI variant column (`features.priority`) is joined into the
        // child SELECT and surfaces on the row.
        expect(feature).toMatchObject({ id: 3, title: 'Dark mode', type: 'feature', priority: 1 });
        expect(feature).not.toHaveProperty('severity');

        const otherFeature = tasks.find((t) => t['id'] === 4)!;
        expect(otherFeature).toMatchObject({ id: 4, type: 'feature', priority: 3 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a variant-specific where on a poly include refinement filters correctly',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // `severity` is the Bug variant's discriminating field. Filtering an
        // STI-variant-narrowed include on it confirms the refinement's where
        // is scoped to the joined child rows and filters per the variant
        // field — the runtime confirmation of variant-specific where.
        const rows = await projects
          .include('tasks', (tasks) =>
            tasks.variant('Bug').where((task) => task.severity.eq('critical')),
          )
          .all()
          .toArray();

        const roadmap = rows.find((r) => r['id'] === 1)!;
        const tasks = roadmap['tasks'] as Record<string, unknown>[];
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ id: 1, type: 'bug', severity: 'critical' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a variant-narrowed include returns only that variant',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        const rows = await projects
          .include('tasks', (tasks) => tasks.variant('Feature'))
          .all()
          .toArray();

        const roadmap = rows.find((r) => r['id'] === 1)!;
        const tasks = roadmap['tasks'] as Record<string, unknown>[];
        expect(tasks).toHaveLength(2);
        for (const task of tasks) {
          expect(task['type']).toBe('feature');
          expect(task).toHaveProperty('priority');
          expect(task).not.toHaveProperty('severity');
        }
        expect(tasks.map((t) => t['id']).sort()).toEqual([3, 4]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an STI-target variant-narrowed include returns only that variant shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupStiIncludeSchema(runtime);
        await seedStiIncludeData(runtime);

        const accounts = createAccountCollection(runtime);
        const rows = await accounts
          .include('members', (members) => members.variant('Admin'))
          .all()
          .toArray();

        const acme = rows.find((r) => r['id'] === 1)!;
        const members = acme['members'] as Record<string, unknown>[];
        expect(members).toHaveLength(2);
        for (const member of members) {
          expect(member['kind']).toBe('admin');
          expect(member).toHaveProperty('role');
          expect(member).not.toHaveProperty('plan');
        }
        expect(members.map((m) => m['id']).sort()).toEqual([1, 3]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
