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
//
// `select` / `orderBy` mirror the real `Collection` API idiom
// (`.select('id', 'name').orderBy((row) => row.id.asc())`) so the asserted
// shape is intentional and stable when new model fields are added.
interface ScalarFilter {
  eq(value: unknown): unknown;
  gte(value: unknown): unknown;
}
interface OrderBy {
  asc(): unknown;
}
interface RefinementRow {
  id: OrderBy;
}
interface TaskRefinementRow extends RefinementRow {
  severity: ScalarFilter;
  priority: ScalarFilter;
}
interface PolyIncludeRefinement {
  variant(name: string): PolyIncludeRefinement;
  where(predicate: (row: TaskRefinementRow) => unknown): PolyIncludeRefinement;
  select(...fields: string[]): PolyIncludeRefinement;
  orderBy(selector: (row: TaskRefinementRow) => unknown): PolyIncludeRefinement;
}
interface ParentRow {
  id: OrderBy;
}
interface PolyIncludeParent {
  select(...fields: string[]): PolyIncludeParent;
  orderBy(selector: (row: ParentRow) => unknown): PolyIncludeParent;
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
  storage: {
    namespaces: Record<string, { entries: { table: Record<string, RawTable> } }>;
  };
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
  return raw.domain.namespaces['public']!.models;
}

// Index `public` explicitly rather than the first namespace: the storage
// envelope now also carries an `__unbound__` namespace (TML-2808), which
// sorts ahead of `public` and would otherwise shadow it.
function tablesOf(raw: RawContract): Record<string, RawTable> {
  return raw.storage.namespaces['public']!.entries.table;
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
        to: { model: 'User', namespace: 'public' },
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
        to: { model: 'Task', namespace: 'public' },
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
  await runtime.query("insert into projects_tbl (id, name) values (2, 'Empty')");
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
        // `select(['id','kind','role','plan'])` projects all four base columns
        // (STI variant fields are base-table columns); `mapPolymorphicRow`
        // then drops the sibling-variant field per row by the discriminator —
        // admin rows carry `role` (no `plan`), regular rows carry `plan`
        // (no `role`).
        const rows = await accounts
          .select('id', 'name')
          .orderBy((account) => account.id.asc())
          .include('members', (members) =>
            members.select('id', 'kind', 'role', 'plan').orderBy((member) => member.id.asc()),
          )
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Acme',
            members: [
              { id: 1, kind: 'admin', role: 'superadmin' },
              { id: 2, kind: 'regular', plan: 'free' },
              { id: 3, kind: 'admin', role: 'auditor' },
            ],
          },
          { id: 2, name: 'Empty', members: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'MTI-target include returns rows with the variant table column present',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // The MTI variant column (`features.priority`) is joined+projected by
        // the poly machinery regardless of `select`; the base columns are
        // controlled by `select`. So a bug row carries only the selected base
        // fields, a feature row additionally carries `priority`.
        // TML-2783: explicit `.select('id', 'title', 'type')` does NOT restrict
        // the poly variant columns — `priority` leaks in despite not being
        // selected. This asserts the current (buggy) shape, not the post-fix one.
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks.select('id', 'title', 'type').orderBy((task) => task.id.asc()),
          )
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 1, title: 'Crash on login', type: 'bug' },
              { id: 2, title: 'Null ref', type: 'bug' },
              { id: 3, title: 'Dark mode', type: 'feature', priority: 1 },
              { id: 4, title: 'Export PDF', type: 'feature', priority: 3 },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an STI variant-specific where on a poly include refinement filters by the variant field',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // `severity` is the Bug variant's discriminating field. Filtering an
        // STI-variant-narrowed include on it confirms the refinement's where
        // is scoped to the joined child rows and filters per the variant field.
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .variant('Bug')
              .where((task) => task.severity.eq('critical'))
              .select('id', 'title', 'type', 'severity')
              .orderBy((task) => task.id.asc()),
          )
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [{ id: 1, title: 'Crash on login', type: 'bug', severity: 'critical' }],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI variant-specific where on a poly include refinement filters by the variant table column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        // `priority` is the Feature (MTI) variant column — it lives on the
        // joined `features` table, not the base `tasks` table. Filtering on it
        // confirms the predicate accessor names the variant column against the
        // joined variant table inside the correlated child SELECT. The MTI
        // variant column projects regardless of select; seed has Feature id=3
        // (priority 1) and id=4 (priority 3), only id=4 passes priority >= 3.
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .variant('Feature')
              .where((task) => task.priority.gte(3))
              .select('id', 'title', 'type')
              .orderBy((task) => task.id.asc()),
          )
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [{ id: 4, title: 'Export PDF', type: 'feature', priority: 3 }],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI variant-narrowed include returns only that variant',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await setupMtiIncludeSchema(runtime);
        await seedMtiIncludeData(runtime);

        const projects = createProjectCollection(runtime);
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .variant('Feature')
              .select('id', 'title', 'type')
              .orderBy((task) => task.id.asc()),
          )
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 3, title: 'Dark mode', type: 'feature', priority: 1 },
              { id: 4, title: 'Export PDF', type: 'feature', priority: 3 },
            ],
          },
          { id: 2, name: 'Empty', tasks: [] },
        ]);
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
          .select('id', 'name')
          .orderBy((account) => account.id.asc())
          .include('members', (members) =>
            members
              .variant('Admin')
              .select('id', 'kind', 'role')
              .orderBy((member) => member.id.asc()),
          )
          .all()
          .toArray();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Acme',
            members: [
              { id: 1, kind: 'admin', role: 'superadmin' },
              { id: 3, kind: 'admin', role: 'auditor' },
            ],
          },
          { id: 2, name: 'Empty', members: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
