import { int4Column, textColumn as pgTextColumn } from '@prisma-next/adapter-postgres/column-types';
import {
  integerColumn,
  textColumn as sqliteTextColumn,
} from '@prisma-next/adapter-sqlite/column-types';
import type { Contract } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  defineContract as baseDefineContract,
  field,
} from '@prisma-next/sql-contract-ts/contract-builder';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import postgresPack from '@prisma-next/target-postgres/pack';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import {
  type ApplyMigrationOptions,
  applyMigration,
  type MigrationResult,
} from '@prisma-next/test-utils/migration-harness';
import { describe } from 'vitest';
import { postgresTestTarget } from './postgres';
import { sqliteTestTarget } from './sqlite';

/**
 * Helper for fanning out SQL migration tests across SQLite and Postgres.
 * Each test body runs once per target inside a `describe` block named
 * `${groupName} — sqlite` / `${groupName} — postgres`, so failures
 * attribute cleanly.
 *
 * The body receives a per-target context: column-type builders (`int`,
 * `text`, `integerColumn`, `textColumn`), a `defineContract` function
 * pre-bound to the current target's family/target pack (so test authors
 * write `defineContract({ models: { ... } })` without needing to know
 * which target is active), and `runMigration` — a wrapper around
 * `applyMigration` that exposes a structural `SqlTestDriver` capable of
 * executing `?`-placeholder SQL on both targets (postgres translates
 * internally).
 *
 * Sqlite-specific tests (e.g. recreate-table behavior) should not use
 * this — keep them as plain `describe` blocks importing from `./sqlite`.
 */

/**
 * Structural common shape over `SqliteTestDriver` and `PostgresControlDriver`.
 * Both targets' test drivers accept `?`-style placeholders in test SQL.
 */
export interface SqlTestDriver {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite' | 'postgres';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
}

export type SqlTargetName = 'sqlite' | 'postgres';

/**
 * Define a SQL contract for whichever target is active in the current
 * fan-out iteration. The family/target pack is closed over per-case;
 * test authors only supply `models`. The result is widened to
 * `Contract<SqlStorage>` so it can flow through the generic harness.
 */
export type DefineSqlContract = <TModels>(args: { models: TModels }) => Contract<SqlStorage>;

export interface SqlFanoutContext {
  readonly name: SqlTargetName;
  readonly int: ReturnType<typeof field.column>;
  readonly text: ReturnType<typeof field.column>;
  /** Raw integer column descriptor (sqlite `integerColumn` / postgres `int4Column`). */
  readonly integerColumn: ColumnTypeDescriptor;
  /** Raw text column descriptor (each target's `textColumn`). */
  readonly textColumn: ColumnTypeDescriptor;
  readonly defineContract: DefineSqlContract;
  runMigration(
    options: ApplyMigrationOptions<Contract<SqlStorage>, SqlTestDriver, MigrationOperationPolicy>,
    assertions: (result: MigrationResult<SqlSchemaIR, SqlTestDriver>) => Promise<void>,
  ): Promise<void>;
}

interface CaseSpec {
  name: SqlTargetName;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous targets are dispatched per iteration; the helper hides the union from callers
  target: any;
  intCol: ColumnTypeDescriptor;
  textCol: ColumnTypeDescriptor;
  // biome-ignore lint/suspicious/noExplicitAny: pack types differ per target; defineContract is wrapped per-case so callers don't see the union
  defineContract: (args: { models: any }) => any;
}

const cases: readonly CaseSpec[] = [
  {
    name: 'sqlite',
    target: sqliteTestTarget,
    intCol: integerColumn,
    textCol: sqliteTextColumn,
    defineContract: (args) =>
      baseDefineContract({ family: sqlFamilyPack, target: sqlitePack, models: args.models }),
  },
  {
    name: 'postgres',
    target: postgresTestTarget,
    intCol: int4Column,
    textCol: pgTextColumn,
    defineContract: (args) =>
      baseDefineContract({ family: sqlFamilyPack, target: postgresPack, models: args.models }),
  },
];

/**
 * Fan out a SQL migration scenario across SQLite and Postgres. Generates
 * one `describe` block per target. The body is invoked twice with a
 * per-target context.
 */
export function describeSqlMigration(
  groupName: string,
  body: (ctx: SqlFanoutContext) => void,
): void {
  for (const { name, target, intCol, textCol, defineContract: caseDefineContract } of cases) {
    describe(`${groupName} — ${name}`, () => {
      body({
        name,
        int: field.column(intCol),
        text: field.column(textCol),
        integerColumn: intCol,
        textColumn: textCol,
        defineContract: caseDefineContract as DefineSqlContract,
        runMigration: (options, assertions) =>
          applyMigration(
            target,
            options as ApplyMigrationOptions<
              Contract<SqlStorage>,
              unknown,
              MigrationOperationPolicy
            >,
            async (result) => {
              await assertions({
                driver: result.driver as SqlTestDriver,
                schema: result.schema as SqlSchemaIR,
                operationsExecuted: result.operationsExecuted,
                plannedOperationIds: result.plannedOperationIds,
              });
            },
          ),
      });
    });
  }
}
