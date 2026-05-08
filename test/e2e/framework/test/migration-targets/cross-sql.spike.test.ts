import * as pgCols from '@prisma-next/adapter-postgres/column-types';
import * as sqliteCols from '@prisma-next/adapter-sqlite/column-types';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import { applyMigration } from '@prisma-next/test-utils/migration-harness';
import { timeouts } from '@prisma-next/test-utils/timeouts';
import { describe, expect, it } from 'vitest';
import { postgresTestTarget } from './postgres';
import { sqliteTestTarget } from './sqlite';

/**
 * Spike — same migration scenario fanned out across two SQL targets via
 * the generic `applyMigration` harness. The contract is target-specific
 * (column types differ between sqlite and postgres) but the assertion is
 * fully shared.
 *
 * Note: a single iteration over a heterogeneous `[sqlite, postgres]`
 * array doesn't typecheck because `applyMigration` is invariant in its
 * driver/contract type parameters. So we keep two parallel describe
 * blocks calling a shared assertion. A future SQL-fan-out helper could
 * paper over this by accepting the array typed-correctly and dispatching
 * internally.
 */

async function assertUserSchema(
  target: typeof sqliteTestTarget | typeof postgresTestTarget,
  contract: ReturnType<typeof sqliteUserContract> | ReturnType<typeof postgresUserContract>,
) {
  // Inferred call site keeps the schema check shared even though the
  // adapters are constructed independently above.
  if (target === sqliteTestTarget) {
    await applyMigration(sqliteTestTarget, { destination: contract }, sharedAssertion);
  } else {
    await applyMigration(postgresTestTarget, { destination: contract }, sharedAssertion);
  }
}

const sharedAssertion = async ({
  schema,
}: {
  schema: {
    tables: Record<
      string,
      { columns: Record<string, unknown>; uniques: readonly { columns: readonly string[] }[] }
    >;
  };
}) => {
  expect(schema.tables['User']).toBeDefined();
  expect(Object.keys(schema.tables['User']!.columns).sort()).toEqual(['email', 'id']);
  const uniques = schema.tables['User']!.uniques.map((u) => [...u.columns]);
  expect(uniques).toContainEqual(['email']);
};

const sqliteUserContract = () =>
  defineContract({
    family: sqlFamilyPack,
    target: sqlitePack,
    models: {
      User: model('User', {
        fields: {
          id: field.column(sqliteCols.integerColumn).id(),
          email: field.column(sqliteCols.textColumn).unique(),
        },
      }),
    },
  });

const postgresUserContract = () =>
  defineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    models: {
      User: model('User', {
        fields: {
          id: field.column(pgCols.int4Column).id(),
          email: field.column(pgCols.textColumn).unique(),
        },
      }),
    },
  });

describe('migration spike — sqlite', () => {
  it('creates a User table with PK and unique email', async () => {
    await assertUserSchema(sqliteTestTarget, sqliteUserContract());
  });
});

describe('migration spike — postgres', { timeout: timeouts.spinUpPpgDev }, () => {
  it('creates a User table with PK and unique email', async () => {
    await assertUserSchema(postgresTestTarget, postgresUserContract());
  });
});
