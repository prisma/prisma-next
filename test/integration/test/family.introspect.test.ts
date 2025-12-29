import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Type for schemaIR returned by introspect
type SchemaIR = Awaited<ReturnType<ReturnType<typeof sql.create>['introspect']>>;

/**
 * Helper to run introspection and pass schemaIR to callback.
 * Handles driver lifecycle (create + close) automatically.
 */
async function withIntrospection<T>(
  connectionString: string,
  fn: (schemaIR: SchemaIR) => T | Promise<T>,
): Promise<T> {
  const driver = await postgresDriver.create(connectionString);
  try {
    const familyInstance = sql.create({
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [],
    });

    const schemaIR = await familyInstance.introspect({ driver });
    return await fn(schemaIR);
  } finally {
    await driver.close();
  }
}

describe('family instance introspect', () => {
  let database: DevDatabase | undefined;
  let connectionString: string | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    connectionString = database.connectionString;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, timeouts.spinUpPpgDev);

  describe('for a schema with tables and columns', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      // Setup schema first, then close the connection
      await withClient(connectionString, async (client) => {
        // Drop existing tables if they exist
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        // Create test schema
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
        await client.query(`
          CREATE INDEX "post_userId_idx" ON "post"("userId")
        `);
      }); // Connection closed here
    }, timeouts.spinUpPpgDev);

    it(
      'returns schema IR with tables and columns',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          expect(schemaIR).toBeDefined();
          expect(schemaIR.tables).toBeDefined();
          expect(schemaIR.extensions).toBeDefined();
          expect(Array.isArray(schemaIR.extensions)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes user table with correct columns',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          const userTable = schemaIR.tables['user'];
          expect(userTable).toBeDefined();
          if (!userTable) {
            throw new Error('user table not found');
          }
          expect(userTable.name).toBe('user');
          expect(userTable.columns).toBeDefined();

          const idColumn = userTable.columns['id'];
          expect(idColumn).toBeDefined();
          if (!idColumn) {
            throw new Error('id column not found');
          }
          expect(idColumn.name).toBe('id');
          expect(idColumn.nativeType).toBeDefined();
          expect(idColumn.nullable).toBe(false);

          const emailColumn = userTable.columns['email'];
          expect(emailColumn).toBeDefined();
          if (!emailColumn) {
            throw new Error('email column not found');
          }
          expect(emailColumn.name).toBe('email');
          expect(emailColumn.nativeType).toBeDefined();
          expect(emailColumn.nullable).toBe(false);

          const createdAtColumn = userTable.columns['createdAt'];
          expect(createdAtColumn).toBeDefined();
          if (!createdAtColumn) {
            throw new Error('createdAt column not found');
          }
          expect(createdAtColumn.name).toBe('createdAt');
          expect(createdAtColumn.nativeType).toBeDefined();
          expect(createdAtColumn.nullable).toBe(false);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes primary key for user table',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          const userTable = schemaIR.tables['user'];
          expect(userTable).toBeDefined();
          if (!userTable) {
            throw new Error('user table not found');
          }
          expect(userTable.primaryKey).toBeDefined();
          expect(userTable.primaryKey?.columns).toEqual(['id']);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes unique constraint for user email',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          const userTable = schemaIR.tables['user'];
          expect(userTable).toBeDefined();
          if (!userTable) {
            throw new Error('user table not found');
          }
          expect(userTable.uniques).toBeDefined();
          expect(userTable.uniques.length).toBeGreaterThan(0);
          const emailUnique = userTable.uniques.find((uq) => uq.name === 'user_email_unique');
          expect(emailUnique).toBeDefined();
          expect(emailUnique?.columns).toEqual(['email']);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes post table with foreign key to user',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          const postTable = schemaIR.tables['post'];
          expect(postTable).toBeDefined();
          if (!postTable) {
            throw new Error('post table not found');
          }
          expect(postTable.name).toBe('post');
          expect(postTable.columns['id']).toBeDefined();
          expect(postTable.columns['userId']).toBeDefined();
          expect(postTable.columns['title']).toBeDefined();

          expect(postTable.foreignKeys).toBeDefined();
          expect(postTable.foreignKeys.length).toBe(1);
          const fk = postTable.foreignKeys[0];
          if (!fk) {
            throw new Error('foreign key not found');
          }
          expect(fk.columns).toEqual(['userId']);
          expect(fk.referencedTable).toBe('user');
          expect(fk.referencedColumns).toEqual(['id']);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes indexes for post table',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          const postTable = schemaIR.tables['post'];
          expect(postTable).toBeDefined();
          if (!postTable) {
            throw new Error('post table not found');
          }
          expect(postTable.indexes).toBeDefined();
          expect(postTable.indexes.length).toBeGreaterThan(0);
          const userIdIndex = postTable.indexes.find((idx) => idx.name === 'post_userId_idx');
          expect(userIdIndex).toBeDefined();
          expect(userIdIndex?.columns).toEqual(['userId']);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes Postgres annotations',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          expect(schemaIR.annotations).toBeDefined();
          expect(schemaIR.annotations?.['pg']).toBeDefined();
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('for an adapter with invalid create method', () => {
    it(
      'throws error when create method returns invalid adapter',
      async () => {
        const adapterWithInvalidCreate = {
          ...postgresAdapter,
          create: () => ({}),
        } as unknown as typeof postgresAdapter;

        const familyInstance = sql.create({
          target: postgres,
          adapter: adapterWithInvalidCreate,
          driver: postgresDriver,
          extensions: [],
        });

        const mockDriver = {
          query: async () => ({ rows: [] }),
          close: async () => {},
        };

        await expect(
          familyInstance.introspect({
            driver: mockDriver,
          }),
        ).rejects.toThrow();
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('for an invalid database connection', () => {
    it(
      'handles connection errors gracefully',
      async () => {
        let invalidDriver: Awaited<ReturnType<typeof postgresDriver.create>> | undefined;
        try {
          invalidDriver = await postgresDriver.create('postgresql://invalid:5432/invalid');
        } catch (error) {
          // Driver creation failing immediately is unexpected - the test expects to create
          // the driver successfully, then have introspect() fail when using the invalid connection.
          // If driver creation fails, it may indicate an environment issue or changed behavior.
          throw new Error(
            'Expected postgresDriver.create() to succeed with invalid connection string, ' +
              'but it threw: ' +
              (error instanceof Error ? error.message : String(error)),
          );
        }

        try {
          const familyInstance = sql.create({
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensions: [],
          });

          await expect(
            familyInstance.introspect({
              driver: invalidDriver,
            }),
          ).rejects.toThrow();
        } finally {
          await invalidDriver.close().catch(() => {
            // Ignore cleanup errors
          });
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('for a schema with extensions', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      // Setup schema first, then close the connection
      await withClient(connectionString, async (client) => {
        // Create a table (required for schema to exist)
        await client.query(`
          CREATE TABLE IF NOT EXISTS "test" (
            id SERIAL PRIMARY KEY
          )
        `);
      }); // Connection closed here
    }, timeouts.spinUpPpgDev);

    it(
      'returns extensions array',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withIntrospection(connectionString, (schemaIR) => {
          expect(schemaIR.extensions).toBeDefined();
          expect(Array.isArray(schemaIR.extensions)).toBe(true);
          expect(schemaIR.extensions.length).toBeGreaterThanOrEqual(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
