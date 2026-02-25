import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> = [
  postgres,
  postgresAdapter,
];

describe('referential actions integration', () => {
  let connectionString: string | undefined;

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    return async () => {
      await database.close();
    };
  }, timeouts.spinUpPpgDev);

  describe('introspection', () => {
    beforeEach(async () => {
      if (!connectionString) throw new Error('Connection string not set');

      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "comment"');
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');

        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE
          )
        `);
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE RESTRICT
          )
        `);
        await client.query(`
          CREATE TABLE "comment" (
            id SERIAL PRIMARY KEY,
            "postId" INTEGER,
            body TEXT NOT NULL,
            FOREIGN KEY ("postId") REFERENCES "post"(id) ON DELETE SET NULL ON UPDATE CASCADE
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'introspects ON DELETE CASCADE and ON UPDATE RESTRICT',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensionPacks: [],
          });

          const schemaIR = await familyInstance.introspect({ driver });

          const postTable = schemaIR.tables['post'];
          expect(postTable).toBeDefined();
          expect(postTable?.foreignKeys).toHaveLength(1);

          const fk = postTable!.foreignKeys[0]!;
          expect(fk.columns).toEqual(['userId']);
          expect(fk.referencedTable).toBe('user');
          expect(fk.onDelete).toBe('cascade');
          expect(fk.onUpdate).toBe('restrict');
        } finally {
          await driver.close();
        }
      },
      timeouts.databaseOperation,
    );

    it(
      'introspects ON DELETE SET NULL and ON UPDATE CASCADE',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensionPacks: [],
          });

          const schemaIR = await familyInstance.introspect({ driver });

          const commentTable = schemaIR.tables['comment'];
          expect(commentTable).toBeDefined();
          expect(commentTable?.foreignKeys).toHaveLength(1);

          const fk = commentTable!.foreignKeys[0]!;
          expect(fk.columns).toEqual(['postId']);
          expect(fk.referencedTable).toBe('post');
          expect(fk.onDelete).toBe('setNull');
          expect(fk.onUpdate).toBe('cascade');
        } finally {
          await driver.close();
        }
      },
      timeouts.databaseOperation,
    );

    it(
      'omits NO ACTION (the default) from introspection result',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "comment"');
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');
          await client.query(`CREATE TABLE "user" (id SERIAL PRIMARY KEY)`);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE NO ACTION ON UPDATE NO ACTION
            )
          `);
        });

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensionPacks: [],
          });

          const schemaIR = await familyInstance.introspect({ driver });
          const fk = schemaIR.tables['post']?.foreignKeys[0];
          expect(fk).toBeDefined();
          expect(fk!.onDelete).toBeUndefined();
          expect(fk!.onUpdate).toBeUndefined();
        } finally {
          await driver.close();
        }
      },
      timeouts.databaseOperation,
    );
  });

  describe('schema verification', () => {
    describe('matching referential actions', () => {
      beforeEach(async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');

          await client.query(`
            CREATE TABLE "user" (
              id SERIAL PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              title TEXT NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE RESTRICT
            )
          `);
          await client.query('CREATE INDEX "post_userId_idx" ON "post"("userId")');
        });
      }, timeouts.spinUpPpgDev);

      it(
        'returns ok=true when contract and DB referential actions match',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const contract = defineContract<CodecTypes>()
            .target(postgresPack)
            .table('user', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('email', { type: textColumn, nullable: false })
                .primaryKey(['id']),
            )
            .table('post', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('userId', { type: int4Column, nullable: false })
                .column('title', { type: textColumn, nullable: false })
                .primaryKey(['id'])
                .foreignKey(
                  ['userId'],
                  { table: 'user', columns: ['id'] },
                  {
                    onDelete: 'cascade',
                    onUpdate: 'restrict',
                  },
                )
                .index(['userId']),
            )
            .foreignKeyDefaults({ constraint: true, index: true })
            .build();

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create({
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);
            const result = await familyInstance.schemaVerify({
              driver,
              contractIR: validatedContract,
              strict: false,
              context: { contractPath: './contract.json' },
              frameworkComponents,
            });

            expect(result.ok).toBe(true);
            expect(result.schema.counts.fail).toBe(0);
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('mismatched referential actions', () => {
      beforeEach(async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');

          await client.query(`
            CREATE TABLE "user" (
              id SERIAL PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              title TEXT NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE SET NULL ON UPDATE CASCADE
            )
          `);
          await client.query('CREATE INDEX "post_userId_idx" ON "post"("userId")');
        });
      }, timeouts.spinUpPpgDev);

      it(
        'returns ok=false when onDelete mismatches',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const contract = defineContract<CodecTypes>()
            .target(postgresPack)
            .table('user', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('email', { type: textColumn, nullable: false })
                .primaryKey(['id']),
            )
            .table('post', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('userId', { type: int4Column, nullable: false })
                .column('title', { type: textColumn, nullable: false })
                .primaryKey(['id'])
                .foreignKey(
                  ['userId'],
                  { table: 'user', columns: ['id'] },
                  {
                    onDelete: 'cascade',
                    onUpdate: 'cascade',
                  },
                )
                .index(['userId']),
            )
            .foreignKeyDefaults({ constraint: true, index: true })
            .build();

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create({
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);
            const result = await familyInstance.schemaVerify({
              driver,
              contractIR: validatedContract,
              strict: false,
              context: { contractPath: './contract.json' },
              frameworkComponents,
            });

            expect(result.ok).toBe(false);
            expect(result.schema.counts.fail).toBeGreaterThan(0);
            expect(
              result.schema.issues.some(
                (i) => i.kind === 'foreign_key_mismatch' && i.table === 'post',
              ),
            ).toBe(true);
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'returns ok=false when onUpdate mismatches',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const contract = defineContract<CodecTypes>()
            .target(postgresPack)
            .table('user', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('email', { type: textColumn, nullable: false })
                .primaryKey(['id']),
            )
            .table('post', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('userId', { type: int4Column, nullable: false })
                .column('title', { type: textColumn, nullable: false })
                .primaryKey(['id'])
                .foreignKey(
                  ['userId'],
                  { table: 'user', columns: ['id'] },
                  {
                    onDelete: 'setNull',
                    onUpdate: 'restrict',
                  },
                )
                .index(['userId']),
            )
            .foreignKeyDefaults({ constraint: true, index: true })
            .build();

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create({
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);
            const result = await familyInstance.schemaVerify({
              driver,
              contractIR: validatedContract,
              strict: false,
              context: { contractPath: './contract.json' },
              frameworkComponents,
            });

            expect(result.ok).toBe(false);
            expect(result.schema.counts.fail).toBeGreaterThan(0);
            expect(
              result.schema.issues.some(
                (i) => i.kind === 'foreign_key_mismatch' && i.table === 'post',
              ),
            ).toBe(true);
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('contract without referential actions', () => {
      beforeEach(async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');

          await client.query(`
            CREATE TABLE "user" (
              id SERIAL PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              title TEXT NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
            )
          `);
          await client.query('CREATE INDEX "post_userId_idx" ON "post"("userId")');
        });
      }, timeouts.spinUpPpgDev);

      it(
        'returns ok=true when contract omits referential actions (no comparison)',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const contract = defineContract<CodecTypes>()
            .target(postgresPack)
            .table('user', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('email', { type: textColumn, nullable: false })
                .primaryKey(['id']),
            )
            .table('post', (t) =>
              t
                .column('id', { type: int4Column, nullable: false })
                .column('userId', { type: int4Column, nullable: false })
                .column('title', { type: textColumn, nullable: false })
                .primaryKey(['id'])
                .foreignKey(['userId'], { table: 'user', columns: ['id'] })
                .index(['userId']),
            )
            .foreignKeyDefaults({ constraint: true, index: true })
            .build();

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create({
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensionPacks: [],
            });

            const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);
            const result = await familyInstance.schemaVerify({
              driver,
              contractIR: validatedContract,
              strict: false,
              context: { contractPath: './contract.json' },
              frameworkComponents,
            });

            expect(result.ok).toBe(true);
            expect(result.schema.counts.fail).toBe(0);
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
