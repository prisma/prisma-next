import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import sqlFamily from '@prisma-next/family-sql/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('family instance schemaVerify', () => {
  let connectionString: string | undefined;

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    return async () => {
      await database.close();
    };
  }, timeouts.spinUpPpgDev);

  describe('happy path: schema matches contract', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            CONSTRAINT "user_email_unique" UNIQUE (email)
          )
        `);
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY ("userId") REFERENCES "user"(id)
          )
        `);
        await client.query('CREATE INDEX "post_userId_idx" ON "post"("userId")');
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=true with all pass nodes',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const User = model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique(),
          },
        }).sql({ table: 'user' });

        const Post = model('Post', {
          fields: {
            id: field.column(int4Column).id(),
            userId: field.column(int4Column),
            title: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'post',
          indexes: [constraints.index(cols.userId)],
          foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
        }));

        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          models: { User, Post },
        });

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            }),
          );

          const validatedContract = validateContract<Contract<SqlStorage>>(
            contract,
            emptyCodecLookup,
          );
          const frameworkComponents: ReadonlyArray<
            TargetBoundComponentDescriptor<'sql', 'postgres'>
          > = [postgres, postgresAdapter];
          const result = await familyInstance.schemaVerify({
            driver,
            contract: validatedContract,
            strict: false,
            context: { contractPath: './contract.json' },
            frameworkComponents,
          });

          expect(result.ok).toBe(true);
          expect(result.schema.counts.fail).toBe(0);
          expect(result.schema.counts.pass).toBeGreaterThan(0);
          expect(result.schema.root.status).toBe('pass');
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('missing table', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with missing_table issue',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql({ table: 'user' }),
            Post: model('Post', {
              fields: {
                id: field.column(int4Column).id(),
                title: field.column(textColumn),
              },
            }).sql({ table: 'post' }),
          },
        });

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            }),
          );

          const validatedContract = validateContract<Contract<SqlStorage>>(
            contract,
            emptyCodecLookup,
          );
          const frameworkComponents: ReadonlyArray<
            TargetBoundComponentDescriptor<'sql', 'postgres'>
          > = [postgres, postgresAdapter];
          const result = await familyInstance.schemaVerify({
            driver,
            contract: validatedContract,
            strict: false,
            context: { contractPath: './contract.json' },
            frameworkComponents,
          });

          expect(result.ok).toBe(false);
          expect(result.schema.counts.fail).toBeGreaterThan(0);
          expect(
            result.schema.issues.some((i) => i.kind === 'missing_table' && i.table === 'post'),
          ).toBe(true);
          expect(result.schema.root.status).toBe('fail');
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('missing column', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with missing_column issue',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql({ table: 'user' }),
          },
        });

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            }),
          );

          const validatedContract = validateContract<Contract<SqlStorage>>(
            contract,
            emptyCodecLookup,
          );
          const frameworkComponents: ReadonlyArray<
            TargetBoundComponentDescriptor<'sql', 'postgres'>
          > = [postgres, postgresAdapter];
          const result = await familyInstance.schemaVerify({
            driver,
            contract: validatedContract,
            strict: false,
            context: { contractPath: './contract.json' },
            frameworkComponents,
          });

          expect(result.ok).toBe(false);
          expect(result.schema.counts.fail).toBeGreaterThan(0);
          expect(
            result.schema.issues.some(
              (i) => i.kind === 'missing_column' && i.table === 'user' && i.column === 'email',
            ),
          ).toBe(true);
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
