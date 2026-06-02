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

// These tests extend the poly-include coverage to relationship shapes the
// sibling `polymorphism-include.test.ts` doesn't reach:
//   1. a poly (MTI) model as the include PARENT (poly model is the root);
//   2. a to-one / N:1 include whose TARGET is a poly model;
//   3. a base with two MTI variant tables (no cross-variant contamination);
//   4. a nested include through a poly target (Parent -> tasks(poly) -> child);
//   5. relationship-level implicit-default selection (no `.select(...)`).
//
// As in the sibling file, the poly models are patched in at runtime and are
// absent from the static `TestContract` Models type, so minimal cast
// interfaces drive `.include('<polyRel>')` / `.select` / `.orderBy` and read
// the rows back. Fixtures stay LOCAL here (the `build*Contract` helpers below
// deep-clone the shared poly contracts before mutating) so the shared
// `helpers.ts` builders — and the sibling tests' hand-rolled DDL — stay stable.
//
// Ordering is ALWAYS by a base-table column (`id`): TML-2782 makes orderBy on
// an MTI variant column throw. Poly result columns are asserted at their
// CURRENT behavior — explicit `.select(...)` does not restrict MTI variant
// columns (TML-2783) — so the no-select implicit-default shape is the primary
// vehicle for poly result assertions here.

interface OrderBy {
  asc(): unknown;
}
interface BaseRow {
  id: OrderBy;
}
interface IncludeRefinement {
  variant(name: string): IncludeRefinement;
  select(...fields: string[]): IncludeRefinement;
  orderBy(selector: (row: BaseRow) => unknown): IncludeRefinement;
  include(
    relation: string,
    refine?: (collection: IncludeRefinement) => IncludeRefinement,
  ): IncludeRefinement;
}
interface IncludeRoot {
  select(...fields: string[]): IncludeRoot;
  orderBy(selector: (row: BaseRow) => unknown): IncludeRoot;
  include(
    relation: string,
    refine?: (collection: IncludeRefinement) => IncludeRefinement,
  ): IncludeRoot & {
    include(
      relation: string,
      refine?: (collection: IncludeRefinement) => IncludeRefinement,
    ): IncludeRoot;
    all(): { toArray(): Promise<Record<string, unknown>[]> };
  };
}

type RawContract = {
  domain: { namespaces: Record<string, { models: Record<string, MutableModel> }> };
  storage: { namespaces: Record<string, { tables: Record<string, RawTable> }> };
};
type MutableModel = {
  fields: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: { table: string; fields: Record<string, { column: string }> };
  discriminator?: { field: string };
  variants?: Record<string, { value: string }>;
  base?: string;
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
function int(nullable: boolean) {
  return { nullable, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
}
function text(nullable: boolean) {
  return { nullable, type: { kind: 'scalar', codecId: 'pg/text@1' } };
}
function intCol(nullable: boolean) {
  return { nativeType: 'int4', codecId: 'pg/int4@1', nullable };
}
function textCol(nullable: boolean) {
  return { nativeType: 'text', codecId: 'pg/text@1', nullable };
}

// Task (Bug STI / Feature MTI poly) as the include PARENT --comments(1:N)-->
// Comment (plain). The poly model is the include ROOT here: its base+variant
// span must correlate to the child rows.
function buildPolyParentContract(): TestContract {
  const raw = rawOf(buildMixedPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const task = models['Task']!;
  task.relations['comments'] = {
    to: { model: 'TaskComment', namespace: 'public' },
    cardinality: '1:N',
    on: { localFields: ['id'], targetFields: ['taskId'] },
  };

  models['TaskComment'] = {
    fields: { id: int(false), body: text(false), taskId: int(true) },
    relations: {},
    storage: {
      table: 'task_comments',
      fields: { id: { column: 'id' }, body: { column: 'body' }, taskId: { column: 'task_id' } },
    },
  };
  tables['task_comments'] = {
    columns: { id: intCol(false), body: textCol(false), task_id: intCol(true) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Ticket (plain) --owner(N:1)--> User (Admin/Regular STI poly). A to-one
// include whose TARGET is a poly model: per-row variant mapping on a single
// included object, not an array.
function buildToOnePolyTargetContract(): TestContract {
  const raw = rawOf(buildStiPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  models['Ticket'] = {
    fields: { id: int(false), subject: text(false), ownerId: int(true) },
    relations: {
      owner: {
        to: { model: 'User', namespace: 'public' },
        cardinality: 'N:1',
        on: { localFields: ['ownerId'], targetFields: ['id'] },
      },
    },
    storage: {
      table: 'tickets',
      fields: {
        id: { column: 'id' },
        subject: { column: 'subject' },
        ownerId: { column: 'owner_id' },
      },
    },
  };
  tables['tickets'] = {
    columns: { id: intCol(false), subject: textCol(false), owner_id: intCol(true) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Project (plain) --tasks(1:N)--> Task with TWO MTI variants:
//   Feature (MTI -> features.priority) and Epic (MTI -> epics.scope).
// Confirms each row carries ONLY its own variant table's column.
function buildTwoMtiVariantContract(): TestContract {
  const raw = rawOf(buildMixedPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const task = models['Task']!;
  task.fields['projectId'] = int(true);
  task.storage.fields['projectId'] = { column: 'project_id' };
  task.variants = { Bug: { value: 'bug' }, Feature: { value: 'feature' }, Epic: { value: 'epic' } };
  tables['tasks']!.columns['project_id'] = intCol(true);

  models['Epic'] = {
    fields: { scope: text(false) },
    relations: {},
    storage: { table: 'epics', fields: { scope: { column: 'scope' } } },
    base: 'Task',
  };
  tables['epics'] = {
    columns: { id: intCol(false), scope: textCol(false) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  models['Project'] = {
    fields: { id: int(false), name: text(false) },
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
    columns: { id: intCol(false), name: textCol(false) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Project --tasks(1:N)--> Task (poly) --reporter(N:1)--> Person.
// Nested include through a poly target: a relation hanging off the poly child
// must stitch when the child row is variant-mapped.
function buildNestedThroughPolyContract(): TestContract {
  const raw = rawOf(buildMixedPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const task = models['Task']!;
  task.fields['projectId'] = int(true);
  task.storage.fields['projectId'] = { column: 'project_id' };
  task.fields['reporterId'] = int(true);
  task.storage.fields['reporterId'] = { column: 'reporter_id' };
  task.relations['reporter'] = {
    to: { model: 'Person', namespace: 'public' },
    cardinality: 'N:1',
    on: { localFields: ['reporterId'], targetFields: ['id'] },
  };
  tables['tasks']!.columns['project_id'] = intCol(true);
  tables['tasks']!.columns['reporter_id'] = intCol(true);

  models['Person'] = {
    fields: { id: int(false), name: text(false) },
    relations: {},
    storage: { table: 'people', fields: { id: { column: 'id' }, name: { column: 'name' } } },
  };
  tables['people'] = {
    columns: { id: intCol(false), name: textCol(false) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  models['Project'] = {
    fields: { id: int(false), name: text(false) },
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
    columns: { id: intCol(false), name: textCol(false) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Account --members(1:N)--> User (STI poly), for relationship-level
// implicit-default coverage. Mirrors `buildStiIncludeContract` in the sibling
// file but stays local here.
function buildStiMembersContract(): TestContract {
  const raw = rawOf(buildStiPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const user = models['User']!;
  user.fields['accountId'] = int(true);
  user.storage.fields['accountId'] = { column: 'account_id' };
  tables['users']!.columns['account_id'] = intCol(true);

  models['Account'] = {
    fields: { id: int(false), name: text(false) },
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
    columns: { id: intCol(false), name: textCol(false) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

// Project --tasks(1:N)--> Task (Bug STI / Feature MTI), for the MTI half of
// relationship-level implicit-default coverage.
function buildMtiTasksContract(): TestContract {
  const raw = rawOf(buildMixedPolyContract());
  const models = modelsOf(raw);
  const tables = tablesOf(raw);

  const task = models['Task']!;
  task.fields['projectId'] = int(true);
  task.storage.fields['projectId'] = { column: 'project_id' };
  tables['tasks']!.columns['project_id'] = intCol(true);

  models['Project'] = {
    fields: { id: int(false), name: text(false) },
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
    columns: { id: intCol(false), name: textCol(false) },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as unknown as TestContract;
}

function collectionOf(
  runtime: PgIntegrationRuntime,
  contract: TestContract,
  model: string,
): IncludeRoot {
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, model as never) as unknown as IncludeRoot;
}

describe('integration/polymorphism-include-relationships', () => {
  it(
    'a poly (MTI) parent correlates its child relation across base + variant tables',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await runtime.query('drop table if exists task_comments');
        await runtime.query('drop table if exists features');
        await runtime.query('drop table if exists tasks');
        await runtime.query(`
          create table tasks (
            id integer primary key,
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
        await runtime.query(`
          create table task_comments (
            id integer primary key,
            body text not null,
            task_id integer
          )
        `);
        await runtime.query(
          "insert into tasks (id, title, type, severity) values (1, 'Crash', 'bug', 'critical')",
        );
        await runtime.query(
          "insert into tasks (id, title, type) values (2, 'Dark mode', 'feature')",
        );
        await runtime.query('insert into features (id, priority) values (2, 5)');
        await runtime.query(
          "insert into task_comments (id, body, task_id) values (10, 'repro attached', 1)",
        );
        await runtime.query(
          "insert into task_comments (id, body, task_id) values (11, 'ship it', 2)",
        );
        await runtime.query(
          "insert into task_comments (id, body, task_id) values (12, 'me too', 1)",
        );

        const tasks = collectionOf(runtime, buildPolyParentContract(), 'Task');
        const rows = await tasks
          .orderBy((task) => task.id.asc())
          .include('comments', (comments) =>
            comments.select('id', 'body', 'taskId').orderBy((comment) => comment.id.asc()),
          )
          .all()
          .toArray();

        // The bug row (base-only) and the feature row (base + features variant
        // table) each correlate their `comments` by the base `id`. No-select on
        // the poly ROOT yields the full default per-variant shape: the bug row
        // carries `severity`, the feature row carries `priority` (TML-2783).
        expect(rows).toEqual([
          {
            id: 1,
            title: 'Crash',
            type: 'bug',
            severity: 'critical',
            comments: [
              { id: 10, body: 'repro attached', taskId: 1 },
              { id: 12, body: 'me too', taskId: 1 },
            ],
          },
          {
            id: 2,
            title: 'Dark mode',
            type: 'feature',
            priority: 5,
            comments: [{ id: 11, body: 'ship it', taskId: 2 }],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a to-one (N:1) include whose target is a poly model variant-maps the single object',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await runtime.query('drop table if exists tickets');
        await runtime.query('drop table if exists users');
        await runtime.query(`
          create table users (
            id integer primary key,
            name text not null,
            email text not null,
            invited_by_id integer,
            address jsonb,
            kind text not null,
            role text,
            plan text
          )
        `);
        await runtime.query(`
          create table tickets (
            id integer primary key,
            subject text not null,
            owner_id integer
          )
        `);
        await runtime.query(
          "insert into users (id, name, email, kind, role) values (1, 'Ada', 'ada@x', 'admin', 'superadmin')",
        );
        await runtime.query(
          "insert into users (id, name, email, kind, plan) values (2, 'Bob', 'bob@x', 'regular', 'free')",
        );
        await runtime.query(
          "insert into tickets (id, subject, owner_id) values (100, 'Login broken', 1)",
        );
        await runtime.query(
          "insert into tickets (id, subject, owner_id) values (101, 'Add export', 2)",
        );
        await runtime.query(
          "insert into tickets (id, subject, owner_id) values (102, 'Orphan', null)",
        );

        const tickets = collectionOf(runtime, buildToOnePolyTargetContract(), 'Ticket');
        const rows = await tickets
          .select('id', 'subject')
          .orderBy((ticket) => ticket.id.asc())
          .include('owner')
          .all()
          .toArray();

        // `owner` is a single object (or null), not an array. Each owner is
        // variant-mapped: the admin carries `role`, the regular carries `plan`.
        expect(rows).toEqual([
          {
            id: 100,
            subject: 'Login broken',
            owner: {
              id: 1,
              name: 'Ada',
              email: 'ada@x',
              invitedById: null,
              address: null,
              kind: 'admin',
              role: 'superadmin',
            },
          },
          {
            id: 101,
            subject: 'Add export',
            owner: {
              id: 2,
              name: 'Bob',
              email: 'bob@x',
              invitedById: null,
              address: null,
              kind: 'regular',
              plan: 'free',
            },
          },
          { id: 102, subject: 'Orphan', owner: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a base with two MTI variant tables surfaces only the matching variant column per row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await runtime.query('drop table if exists epics');
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
        await runtime.query(`
          create table epics (
            id integer primary key references tasks(id),
            scope text not null
          )
        `);
        await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
        await runtime.query(
          "insert into tasks (id, title, type, severity, project_id) values (1, 'Crash', 'bug', 'critical', 1)",
        );
        await runtime.query(
          "insert into tasks (id, title, type, project_id) values (2, 'Dark mode', 'feature', 1)",
        );
        await runtime.query('insert into features (id, priority) values (2, 3)');
        await runtime.query(
          "insert into tasks (id, title, type, project_id) values (3, 'Billing', 'epic', 1)",
        );
        await runtime.query("insert into epics (id, scope) values (3, 'Q3')");

        const projects = collectionOf(runtime, buildTwoMtiVariantContract(), 'Project');
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
          .all()
          .toArray();

        // No-select on the poly include → full default per-variant shape.
        // The bug row carries `severity`, the feature row carries `priority`
        // (from `features`), the epic row carries `scope` (from `epics`). No
        // row carries a sibling variant's column — no cross-variant
        // contamination across the two MTI variant tables.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 1, title: 'Crash', type: 'bug', severity: 'critical', projectId: 1 },
              { id: 2, title: 'Dark mode', type: 'feature', projectId: 1, priority: 3 },
              { id: 3, title: 'Billing', type: 'epic', projectId: 1, scope: 'Q3' },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // A nested `.include('reporter')` hanging off a polymorphic include TARGET
  // used to decode to `null` for every row, regardless of data: `mapPolymorphicRow`
  // (`collection-runtime.ts`) keeps only base/variant MODEL-field columns, so the
  // nested-include payload column (`reporter`) was dropped before
  // `decodeIncludePayload` (`collection-dispatch.ts`) read it back at the mapped
  // row. The fix sources each nested-include payload from the RAW child row, which
  // always carries the relation alias. This test asserts the CORRECT (stitched)
  // shape; do not weaken it to match the old bug.
  it(
    'a nested include through a poly target stitches the grandchild on variant-mapped rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await runtime.query('drop table if exists features');
        await runtime.query('drop table if exists tasks');
        await runtime.query('drop table if exists people');
        await runtime.query('drop table if exists projects_tbl');
        await runtime.query(`
          create table projects_tbl (
            id integer primary key,
            name text not null
          )
        `);
        await runtime.query(`
          create table people (
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
            project_id integer,
            reporter_id integer
          )
        `);
        await runtime.query(`
          create table features (
            id integer primary key references tasks(id),
            priority integer not null
          )
        `);
        await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
        await runtime.query("insert into people (id, name) values (50, 'Ada')");
        await runtime.query("insert into people (id, name) values (51, 'Bob')");
        await runtime.query(
          "insert into tasks (id, title, type, severity, project_id, reporter_id) values (1, 'Crash', 'bug', 'critical', 1, 50)",
        );
        await runtime.query(
          "insert into tasks (id, title, type, project_id, reporter_id) values (2, 'Dark mode', 'feature', 1, 51)",
        );
        await runtime.query('insert into features (id, priority) values (2, 7)');

        const projects = collectionOf(runtime, buildNestedThroughPolyContract(), 'Project');
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) =>
            tasks
              .orderBy((task) => task.id.asc())
              .include('reporter', (reporter) => reporter.select('id', 'name')),
          )
          .all()
          .toArray();

        // The poly child rows are variant-mapped (bug carries `severity`,
        // feature carries `priority`) AND each carries the nested `reporter`
        // grandchild stitched by `reporter_id`.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              {
                id: 1,
                title: 'Crash',
                type: 'bug',
                severity: 'critical',
                projectId: 1,
                reporterId: 50,
                reporter: { id: 50, name: 'Ada' },
              },
              {
                id: 2,
                title: 'Dark mode',
                type: 'feature',
                projectId: 1,
                reporterId: 51,
                priority: 7,
                reporter: { id: 51, name: 'Bob' },
              },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an STI-target include with no select returns the full default per-variant shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
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
        await runtime.query("insert into accounts (id, name) values (1, 'Acme')");
        await runtime.query(
          "insert into users (id, name, email, kind, role, account_id) values (1, 'Ada', 'ada@x', 'admin', 'superadmin', 1)",
        );
        await runtime.query(
          "insert into users (id, name, email, kind, plan, account_id) values (2, 'Bob', 'bob@x', 'regular', 'free', 1)",
        );

        const accounts = collectionOf(runtime, buildStiMembersContract(), 'Account');
        const rows = await accounts
          .select('id', 'name')
          .orderBy((account) => account.id.asc())
          .include('members', (members) => members.orderBy((member) => member.id.asc()))
          .all()
          .toArray();

        // No `.select(...)` on the poly include — the deliberate
        // implicit-default exception in the whole-shape rule. The admin row
        // carries `role` (no `plan`), the regular row carries `plan` (no
        // `role`); both carry the full base shape.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Acme',
            members: [
              {
                id: 1,
                name: 'Ada',
                email: 'ada@x',
                invitedById: null,
                address: null,
                kind: 'admin',
                role: 'superadmin',
                accountId: 1,
              },
              {
                id: 2,
                name: 'Bob',
                email: 'bob@x',
                invitedById: null,
                address: null,
                kind: 'regular',
                plan: 'free',
                accountId: 1,
              },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an MTI-target include with no select returns the full default per-variant shape',
    async () => {
      await withCollectionRuntime(async (runtime) => {
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
        await runtime.query("insert into projects_tbl (id, name) values (1, 'Roadmap')");
        await runtime.query(
          "insert into tasks (id, title, type, severity, project_id) values (1, 'Crash', 'bug', 'critical', 1)",
        );
        await runtime.query(
          "insert into tasks (id, title, type, project_id) values (2, 'Dark mode', 'feature', 1)",
        );
        await runtime.query('insert into features (id, priority) values (2, 9)');

        const projects = collectionOf(runtime, buildMtiTasksContract(), 'Project');
        const rows = await projects
          .select('id', 'name')
          .orderBy((project) => project.id.asc())
          .include('tasks', (tasks) => tasks.orderBy((task) => task.id.asc()))
          .all()
          .toArray();

        // No `.select(...)` on the poly include — implicit-default exception.
        // The bug row carries `severity`, the feature row carries `priority`
        // (joined from the `features` MTI variant table); neither carries the
        // sibling variant's column.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Roadmap',
            tasks: [
              { id: 1, title: 'Crash', type: 'bug', severity: 'critical', projectId: 1 },
              { id: 2, title: 'Dark mode', type: 'feature', projectId: 1, priority: 9 },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
