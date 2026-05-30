import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import pgvectorRuntime from '@prisma-next/extension-pgvector/runtime';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { RuntimeQueryable } from '@prisma-next/sql-orm-client';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

export function isSelectAst(ast: unknown): ast is SelectAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'select';
}

const baseTestContract = new SqlContractSerializer().deserializeContract(contractJson) as Contract;

export type TestContract = Contract;

export function getTestContract(): TestContract {
  return structuredClone(baseTestContract);
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

const testContext: ExecutionContext<TestContract> = createExecutionContext({
  contract: baseTestContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
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
 */
export function buildMixedPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));

  raw.models.Task = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      table: 'tasks',
      fields: { id: { column: 'id' }, title: { column: 'title' }, type: { column: 'type' } },
    },
    discriminator: { field: 'type' },
    variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
  };

  raw.models.Bug = {
    fields: { severity: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { table: 'tasks', fields: { severity: { column: 'severity' } } },
    base: 'Task',
  };

  raw.models.Feature = {
    fields: { priority: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
    relations: {},
    storage: { table: 'features', fields: { priority: { column: 'priority' } } },
    base: 'Task',
  };

  raw.storage[UNBOUND_NAMESPACE_ID].tables.tasks = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      type: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      severity: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage[UNBOUND_NAMESPACE_ID].tables.features = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      priority: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as TestContract;
}

/**
 * Builds a contract with an STI-only User hierarchy:
 * - User (base, table: users, discriminator: kind)
 * - Admin (STI, table: users, value: admin) with `role` field
 * - Regular (STI, table: users, value: regular) with `plan` field
 */
export function buildStiPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));

  raw.models.User.fields.kind = {
    nullable: false,
    type: { kind: 'scalar', codecId: 'pg/text@1' },
  };
  raw.models.User.storage.fields.kind = { column: 'kind' };
  raw.models.User.discriminator = { field: 'kind' };
  raw.models.User.variants = {
    Admin: { value: 'admin' },
    Regular: { value: 'regular' },
  };

  raw.models.Admin = {
    fields: { role: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { table: 'users', fields: { role: { column: 'role' } } },
    base: 'User',
  };

  raw.models.Regular = {
    fields: { plan: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { table: 'users', fields: { plan: { column: 'plan' } } },
    base: 'User',
  };

  raw.storage[UNBOUND_NAMESPACE_ID].tables.users.columns.kind = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: false,
  };
  raw.storage[UNBOUND_NAMESPACE_ID].tables.users.columns.role = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };
  raw.storage[UNBOUND_NAMESPACE_ID].tables.users.columns.plan = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };

  return raw as TestContract;
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
