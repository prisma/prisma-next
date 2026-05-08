import * as pgCols from '@prisma-next/adapter-postgres/column-types';
import * as sqliteCols from '@prisma-next/adapter-sqlite/column-types';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import { describeAcrossTargets } from '@prisma-next/test-utils/migration-fanout';
import { expect, it } from 'vitest';
import { postgresTestTarget } from './postgres';
import { sqliteTestTarget } from './sqlite';

/**
 * Same migration scenario fanned out across two SQL targets via the L1
 * `describeAcrossTargets` helper. The contract is target-specific
 * (column types differ between sqlite and postgres) but the assertion
 * is fully shared. The fan-out helper produces one `describe` block per
 * target so failures attribute cleanly.
 */

const contracts = {
  sqlite: () =>
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
    }),
  postgres: () =>
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
    }),
};

describeAcrossTargets(
  'migration spike',
  {
    sqlite: { target: sqliteTestTarget },
    postgres: { target: postgresTestTarget },
  },
  ({ name, runMigration }) => {
    it('creates a User table with PK and unique email', async () => {
      const contract = contracts[name as keyof typeof contracts]();
      await runMigration({ destination: contract }, async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
        expect(Object.keys(schema.tables['User']!.columns).sort()).toEqual(['email', 'id']);
        const uniques = schema.tables['User']!.uniques.map((u) => [...u.columns]);
        expect(uniques).toContainEqual(['email']);
      });
    });
  },
);
