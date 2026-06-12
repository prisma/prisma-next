import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import {
  domainModelsAtDefaultNamespace,
  type Contract as FrameworkContract,
} from '@prisma-next/contract/types';
import type {
  CodecDescriptor,
  CodecInstanceContext,
} from '@prisma-next/framework-components/codec';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Codec, SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type RuntimeParameterizedCodecDescriptor,
  type SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import type { RuntimeQueryable } from '../src/types';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };
import { defineTestCodec } from './test-codec';

export function isSelectAst(ast: unknown): ast is SelectAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'select';
}

const postgresContractSerializer = new PostgresContractSerializer();

export function deserializeTestContract(json: unknown = contractJson): Contract {
  return postgresContractSerializer.deserializeContract(json) as Contract;
}

const baseTestContract = deserializeTestContract();

export type TestContract = Contract;

export function getTestContract(): TestContract {
  return deserializeTestContract(JSON.parse(JSON.stringify(contractJson)));
}

/**
 * Override the capabilities of a {@link TestContract} for a test scenario.
 *
 * The narrow `TestContract` type fixes `capabilities` to the literal shape
 * generated for `fixtures/generated/contract.json`. Tests need contracts
 * with arbitrary capability shapes — empty, only-jsonAgg, cross-namespace,
 * etc. — and want the override's literal types preserved so capability-
 * dependent type checks remain meaningful.
 *
 * The result widens `TestContract`'s `capabilities` slot to the caller's
 * `TCaps`, which the framework `Contract` interface already permits
 * (`capabilities: Record<string, Record<string, boolean>>`).
 */
export function withCapabilities<TCaps extends Record<string, Record<string, boolean>>>(
  contract: TestContract,
  capabilities: TCaps,
): Omit<TestContract, 'capabilities'> & { readonly capabilities: TCaps } {
  return { ...contract, capabilities };
}

export function withPatchedDomainModels<T extends FrameworkContract<SqlStorage>>(
  contract: T,
  patch: (models: Record<string, unknown>) => Record<string, unknown>,
): T {
  const [namespaceId, namespace] = Object.entries(contract.domain.namespaces)[0]!;
  const models = domainModelsAtDefaultNamespace(contract.domain);
  return {
    ...contract,
    domain: {
      namespaces: {
        ...contract.domain.namespaces,
        [namespaceId]: {
          ...namespace,
          models: patch({ ...models }) as typeof namespace.models,
        },
      },
    },
  } as T;
}

type MutableDomainModels = Record<
  string,
  {
    fields: Record<string, unknown>;
    relations: Record<string, unknown>;
    storage: Record<string, unknown>;
    discriminator?: { field: string };
    variants?: Record<string, { value: string }>;
    base?: { model: string; namespace: string };
  }
>;

function unboundDomainModels(raw: {
  domain: { namespaces: Record<string, { models: MutableDomainModels }> };
}): MutableDomainModels {
  const ns = Object.values(raw.domain.namespaces)[0];
  if (!ns) throw new Error('no domain namespace found');
  return ns.models;
}

const pgVectorCodecStubExtension: SqlRuntimeExtensionDescriptor<'postgres'> = (() => {
  const factory: (params: { length: number }) => (ctx: CodecInstanceContext) => Codec = () => () =>
    defineTestCodec({
      typeId: 'pg/vector@1',
      encode: (value: number[]) => value,
      decode: (wire: number[]) => wire,
    });

  const vectorDescriptor: RuntimeParameterizedCodecDescriptor<{ length: number }> = {
    codecId: 'pg/vector@1',
    traits: ['equality'],
    targetTypes: ['vector'],
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value: value as { length: number } }),
      },
    },
    isParameterized: true,
    factory,
  };

  const descriptors: ReadonlyArray<CodecDescriptor> = [
    vectorDescriptor as unknown as CodecDescriptor,
  ];

  return {
    kind: 'extension' as const,
    id: 'pgvector',
    version: '0.0.0',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
})();

const testContext: ExecutionContext<TestContract> = createExecutionContext({
  contract: baseTestContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgVectorCodecStubExtension],
  }),
});

export function getTestContext(): ExecutionContext<TestContract> {
  return testContext;
}

export interface MockExecution {
  plan: SqlExecutionPlan | SqlQueryPlan<unknown>;
  rows: Record<string, unknown>[];
}

export interface MockRuntime extends RuntimeQueryable {
  readonly executions: MockExecution[];
  setNextResults(results: Record<string, unknown>[][]): void;
}

/**
 * Builds a contract with a mixed-polymorphism Task hierarchy:
 * - Task (base, table: tasks, discriminator: type)
 * - Bug (STI, table: tasks, value: bug) with `severity` field
 * - Feature (MTI, table: features, value: feature) with `priority` field
 *
 * A non-polymorphic `Project` parent (table: projects_tbl) owns a `tasks`
 * relation targeting the polymorphic `Task`, so an include can be planned
 * against a polymorphic target. `Task` also carries a self-relation
 * `subtasks` (parent_id → id) so the self-relation alias path can be
 * exercised on a polymorphic target.
 */
export function buildMixedPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));

  const domainModels = unboundDomainModels(raw);
  domainModels['Task'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      projectId: { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      parentId: { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {
      subtasks: {
        to: { model: 'Task', namespace: 'public' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['parentId'] },
      },
    },
    storage: {
      namespaceId: 'public',
      table: 'tasks',
      fields: {
        id: { column: 'id' },
        title: { column: 'title' },
        type: { column: 'type' },
        projectId: { column: 'project_id' },
        parentId: { column: 'parent_id' },
      },
    },
    discriminator: { field: 'type' },
    variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
  };

  domainModels['Project'] = {
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
    storage: {
      namespaceId: 'public',
      table: 'projects_tbl',
      fields: { id: { column: 'id' }, name: { column: 'name' } },
    },
  };

  domainModels['Bug'] = {
    fields: { severity: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: {
      namespaceId: 'public',
      table: 'tasks',
      fields: { severity: { column: 'severity' } },
    },
    base: { model: 'Task', namespace: 'public' },
  };

  domainModels['Feature'] = {
    fields: { priority: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
    relations: {},
    storage: {
      namespaceId: 'public',
      table: 'features',
      fields: { priority: { column: 'priority' } },
    },
    base: { model: 'Task', namespace: 'public' },
  };

  raw.storage.namespaces.public.entries.table.tasks = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      type: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      severity: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
      project_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
      parent_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.namespaces.public.entries.table.projects_tbl = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.namespaces.public.entries.table.features = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      priority: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return deserializeTestContract(raw);
}

/**
 * Builds a contract with an STI-only User hierarchy:
 * - User (base, table: users, discriminator: kind)
 * - Admin (STI, table: users, value: admin) with `role` field
 * - Regular (STI, table: users, value: regular) with `plan` field
 *
 * A non-polymorphic `Account` parent (table: accounts) owns a `members`
 * relation targeting the STI-polymorphic `User`, so an include can be
 * planned against an STI-only polymorphic target (no MTI variant tables,
 * so no joins — only discriminator + variant base-table column projection).
 */
export function buildStiPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));
  const domainModels = unboundDomainModels(raw);

  const userModel = domainModels['User']!;
  userModel.fields['kind'] = {
    nullable: false,
    type: { kind: 'scalar', codecId: 'pg/text@1' },
  };
  (userModel.storage as { fields: Record<string, { column: string }> }).fields['kind'] = {
    column: 'kind',
  };
  userModel.fields['accountId'] = {
    nullable: true,
    type: { kind: 'scalar', codecId: 'pg/int4@1' },
  };
  (userModel.storage as { fields: Record<string, { column: string }> }).fields['accountId'] = {
    column: 'account_id',
  };
  userModel.discriminator = { field: 'kind' };
  userModel.variants = {
    Admin: { value: 'admin' },
    Regular: { value: 'regular' },
  };

  domainModels['Account'] = {
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
    storage: {
      namespaceId: 'public',
      table: 'accounts',
      fields: { id: { column: 'id' }, name: { column: 'name' } },
    },
  };

  domainModels['Admin'] = {
    fields: { role: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { namespaceId: 'public', table: 'users', fields: { role: { column: 'role' } } },
    base: { model: 'User', namespace: 'public' },
  };

  domainModels['Regular'] = {
    fields: { plan: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { namespaceId: 'public', table: 'users', fields: { plan: { column: 'plan' } } },
    base: { model: 'User', namespace: 'public' },
  };

  const usersStorageTable = Object.values(
    raw.storage.namespaces as Record<
      string,
      { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
    >,
  ).find((ns) => ns.entries.table['users'])?.entries.table['users'];
  if (!usersStorageTable) throw new Error('users table not found in any storage namespace');
  usersStorageTable.columns['kind'] = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: false,
  };
  usersStorageTable.columns['role'] = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };
  usersStorageTable.columns['plan'] = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };
  usersStorageTable.columns['account_id'] = {
    codecId: 'pg/int4@1',
    nativeType: 'int4',
    nullable: true,
  };

  raw.storage.namespaces.public.entries.table.accounts = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return deserializeTestContract(raw);
}

type RawColumn = { nativeType: string; codecId: string; nullable: boolean; default?: unknown };

/**
 * Builds a minimal M:N contract with Parent <-> Child via a junction table.
 * Used by unit tests that assert M:N include and nested-write behavior.
 */
export function buildManyToManyContract(opts: {
  junctionTable: string;
  parentColumns: string[];
  childColumns: string[];
  targetColumns: string[];
  localFields?: string[];
  extraColumns?: Record<string, RawColumn>;
}): FrameworkContract<SqlStorage> {
  const {
    junctionTable,
    parentColumns,
    childColumns,
    targetColumns,
    localFields = ['id'],
    extraColumns = {},
  } = opts;

  const junctionStorageColumns: Record<string, RawColumn> = {};
  for (const col of parentColumns) {
    junctionStorageColumns[col] = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
  }
  for (const col of childColumns) {
    junctionStorageColumns[col] = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
  }
  for (const [name, col] of Object.entries(extraColumns)) {
    junctionStorageColumns[name] = col;
  }

  const parentStorageColumns: Record<string, RawColumn> = {};
  for (const col of localFields) {
    parentStorageColumns[col] = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
  }

  const parentStorageFields: Record<string, { column: string }> = {};
  for (const col of localFields) {
    parentStorageFields[col] = { column: col };
  }

  const parentFields: Record<
    string,
    { nullable: boolean; type: { kind: string; codecId: string } }
  > = {};
  for (const col of localFields) {
    parentFields[col] = { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } };
  }

  return {
    domain: {
      namespaces: {
        public: {
          id: 'public',
          models: {
            Parent: {
              fields: parentFields,
              relations: {
                children: {
                  to: { model: 'Child', namespace: 'public' },
                  cardinality: 'N:M',
                  on: { localFields, targetFields: targetColumns },
                  through: {
                    table: junctionTable,
                    namespaceId: 'public',
                    parentColumns,
                    childColumns,
                    targetColumns,
                  },
                },
              },
              storage: { namespaceId: 'public', table: 'parents', fields: parentStorageFields },
            },
            Child: {
              fields: Object.fromEntries(
                targetColumns.map((col) => [
                  col,
                  { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                ]),
              ),
              relations: {},
              storage: {
                namespaceId: 'public',
                table: 'children',
                fields: Object.fromEntries(targetColumns.map((col) => [col, { column: col }])),
              },
            },
            Junction: {
              fields: {},
              relations: {},
              storage: { namespaceId: 'public', table: junctionTable, fields: {} },
            },
          },
        },
      },
    },
    storage: {
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              parents: {
                columns: parentStorageColumns,
                primaryKey: { columns: localFields },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              children: {
                columns: Object.fromEntries(
                  targetColumns.map((col) => [
                    col,
                    { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  ]),
                ),
                primaryKey: { columns: targetColumns },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              [junctionTable]: {
                columns: junctionStorageColumns,
                primaryKey: { columns: [...parentColumns, ...childColumns] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    capabilities: {},
  } as unknown as FrameworkContract<SqlStorage>;
}

/**
 * Extends {@link buildManyToManyContract} with an `Owner` model and an N:1
 * `owner` relation on `Child` (children.owner_id → owners.id), so tests can
 * exercise junction-created targets that carry their own relation mutations.
 */
export function buildManyToManyContractWithTargetRelation(): FrameworkContract<SqlStorage> {
  const contract = buildManyToManyContract({
    junctionTable: 'parent_child',
    parentColumns: ['parent_id'],
    childColumns: ['child_id'],
    targetColumns: ['id'],
  });

  const intColumn = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
  const intField = { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } };

  interface MutableModel {
    fields: Record<string, unknown>;
    relations: Record<string, unknown>;
    storage: { namespaceId: string; table: string; fields: Record<string, unknown> };
  }
  interface MutableTable {
    columns: Record<string, unknown>;
    primaryKey: { columns: string[] };
    uniques: unknown[];
    indexes: unknown[];
    foreignKeys: unknown[];
  }
  const raw = contract as unknown as {
    domain: { namespaces: { public: { models: Record<string, MutableModel> } } };
    storage: { namespaces: { public: { entries: { table: Record<string, MutableTable> } } } };
  };

  const models = raw.domain.namespaces.public.models;
  models['Owner'] = {
    fields: { id: intField },
    relations: {},
    storage: { namespaceId: 'public', table: 'owners', fields: { id: { column: 'id' } } },
  };
  const child = models['Child']!;
  child.fields['owner_id'] = intField;
  child.storage.fields['owner_id'] = { column: 'owner_id' };
  child.relations['owner'] = {
    to: { model: 'Owner', namespace: 'public' },
    cardinality: 'N:1',
    on: { localFields: ['owner_id'], targetFields: ['id'] },
  };

  const tables = raw.storage.namespaces.public.entries.table;
  tables['owners'] = {
    columns: { id: intColumn },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
  tables['children']!.columns['owner_id'] = intColumn;

  return contract;
}

export function createMockRuntime(): MockRuntime {
  const executions: MockExecution[] = [];
  let nextResult: Record<string, unknown>[][] = [];

  const runtime: MockRuntime = {
    executions,
    setNextResults(results: Record<string, unknown>[][]) {
      nextResult = [...results];
    },
    execute<Row>(
      plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    ): AsyncIterableResult<Row> {
      const rows = (nextResult.shift() ?? []) as Row[];
      executions.push({
        plan,
        rows: rows as Record<string, unknown>[],
      });
      const gen = async function* (): AsyncGenerator<Row, void, unknown> {
        for (const row of rows) {
          yield row;
        }
      };
      return new AsyncIterableResult(gen());
    },
  };

  return runtime;
}
