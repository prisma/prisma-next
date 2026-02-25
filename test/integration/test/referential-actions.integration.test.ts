import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgres from '@prisma-next/target-postgres/control';
import postgresPack from '@prisma-next/target-postgres/pack';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import type { Client } from 'pg';
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

  describe('DDL generation via planner', () => {
    beforeEach(async () => {
      if (!connectionString) throw new Error('Connection string not set');

      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
      });
    }, timeouts.spinUpPpgDev);

    it(
      'planned DDL contains ON DELETE and ON UPDATE clauses for contract with referential actions',
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

        const validatedContract = validateContract<SqlContract<SqlStorage>>(contract);
        const familyInstance = sql.create({
          target: postgres,
          adapter: postgresAdapter,
          driver: postgresDriver,
          extensionPacks: [],
        });

        // Introspect the empty database to get a baseline schema IR
        const driver = await postgresDriver.create(connectionString);
        try {
          const schemaIR = await familyInstance.introspect({ driver });

          // Plan migrations using the target's SQL-specific planner (contract → DDL)
          const planner = postgres.createPlanner(familyInstance);
          const planResult = planner.plan({
            contract: validatedContract,
            schema: schemaIR,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          });

          expect(planResult.kind).toBe('success');
          if (planResult.kind !== 'success') throw new Error('Expected planning success');

          const fkOps = planResult.plan.operations.filter((op) => op.id.startsWith('foreignKey.'));
          expect(fkOps.length).toBeGreaterThan(0);

          const fkSql = fkOps.flatMap((op) => op.execute.map((step) => step.sql)).join('\n');
          expect(fkSql).toContain('ON DELETE CASCADE');
          expect(fkSql).toContain('ON UPDATE RESTRICT');
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('runtime behavior', () => {
    /**
     * Helper: sets up parent/child tables with a specific ON DELETE action,
     * seeds data, deletes the parent, and returns the result.
     */
    async function setupAndDeleteParent(
      client: Client,
      onDeleteAction: string,
      options?: { childColumnNullable?: boolean; childColumnDefault?: number },
    ): Promise<{
      deleteError: Error | null;
      childRows: Array<{ id: number; parent_id: number | null }>;
    }> {
      const nullable = options?.childColumnNullable ?? false;
      const defaultClause =
        options?.childColumnDefault !== undefined ? ` DEFAULT ${options.childColumnDefault}` : '';
      const nullableClause = nullable ? '' : ' NOT NULL';

      await client.query('DROP TABLE IF EXISTS "child"');
      await client.query('DROP TABLE IF EXISTS "parent"');

      await client.query(`
        CREATE TABLE "parent" (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE "child" (
          id SERIAL PRIMARY KEY,
          parent_id INTEGER${nullableClause}${defaultClause},
          FOREIGN KEY ("parent_id") REFERENCES "parent"(id) ON DELETE ${onDeleteAction}
        )
      `);

      await client.query(`INSERT INTO "parent" (id, name) VALUES (1, 'parent-1')`);
      await client.query(`INSERT INTO "child" (id, parent_id) VALUES (1, 1), (2, 1)`);

      let deleteError: Error | null = null;
      try {
        await client.query(`DELETE FROM "parent" WHERE id = 1`);
      } catch (error) {
        deleteError = error as Error;
      }

      const childResult = await client.query<{ id: number; parent_id: number | null }>(
        `SELECT id, parent_id FROM "child" ORDER BY id`,
      );

      return { deleteError, childRows: childResult.rows };
    }

    it(
      'ON DELETE CASCADE removes child rows when parent is deleted',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'CASCADE');

          expect(deleteError).toBeNull();
          expect(childRows).toHaveLength(0);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE RESTRICT blocks parent deletion when children exist',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'RESTRICT');

          expect(deleteError).not.toBeNull();
          expect(deleteError!.message).toContain('violates foreign key constraint');
          expect(childRows).toHaveLength(2);
          expect(childRows[0]!.parent_id).toBe(1);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE SET NULL sets child FK to NULL when parent is deleted',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'SET NULL', {
            childColumnNullable: true,
          });

          expect(deleteError).toBeNull();
          expect(childRows).toHaveLength(2);
          expect(childRows[0]!.parent_id).toBeNull();
          expect(childRows[1]!.parent_id).toBeNull();
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE SET DEFAULT sets child FK to default value when parent is deleted',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          // Create a second parent to hold the default FK reference
          await client.query('DROP TABLE IF EXISTS "child"');
          await client.query('DROP TABLE IF EXISTS "parent"');

          await client.query(`
            CREATE TABLE "parent" (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL
            )
          `);
          // Insert the default-target parent first
          await client.query(`INSERT INTO "parent" (id, name) VALUES (99, 'default-parent')`);

          await client.query(`
            CREATE TABLE "child" (
              id SERIAL PRIMARY KEY,
              parent_id INTEGER NOT NULL DEFAULT 99,
              FOREIGN KEY ("parent_id") REFERENCES "parent"(id) ON DELETE SET DEFAULT
            )
          `);

          // Insert the parent to be deleted and its children
          await client.query(`INSERT INTO "parent" (id, name) VALUES (1, 'parent-1')`);
          await client.query(`INSERT INTO "child" (id, parent_id) VALUES (1, 1), (2, 1)`);

          // Delete the parent — children should have parent_id set to 99
          await client.query(`DELETE FROM "parent" WHERE id = 1`);

          const childResult = await client.query<{ id: number; parent_id: number }>(
            `SELECT id, parent_id FROM "child" ORDER BY id`,
          );
          expect(childResult.rows).toHaveLength(2);
          expect(childResult.rows[0]!.parent_id).toBe(99);
          expect(childResult.rows[1]!.parent_id).toBe(99);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE NO ACTION blocks parent deletion when children exist (deferred check)',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'NO ACTION');

          expect(deleteError).not.toBeNull();
          expect(deleteError!.message).toContain('violates foreign key constraint');
          expect(childRows).toHaveLength(2);
          expect(childRows[0]!.parent_id).toBe(1);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON UPDATE CASCADE propagates parent primary key changes to children',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "child"');
          await client.query('DROP TABLE IF EXISTS "parent"');

          await client.query(`
            CREATE TABLE "parent" (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "child" (
              id SERIAL PRIMARY KEY,
              parent_id INTEGER NOT NULL,
              FOREIGN KEY ("parent_id") REFERENCES "parent"(id) ON UPDATE CASCADE
            )
          `);

          await client.query(`INSERT INTO "parent" (id, name) VALUES (1, 'parent-1')`);
          await client.query(`INSERT INTO "child" (id, parent_id) VALUES (1, 1), (2, 1)`);

          // Update parent's PK — children should cascade
          await client.query(`UPDATE "parent" SET id = 100 WHERE id = 1`);

          const childResult = await client.query<{ id: number; parent_id: number }>(
            `SELECT id, parent_id FROM "child" ORDER BY id`,
          );
          expect(childResult.rows).toHaveLength(2);
          expect(childResult.rows[0]!.parent_id).toBe(100);
          expect(childResult.rows[1]!.parent_id).toBe(100);
        });
      },
      timeouts.databaseOperation,
    );
  });
});
