import type { ControlPlaneDriver } from '@prisma-next/core-control-plane/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresDriverFromOptions } from '../../postgres-driver/src/postgres-driver';
import { createPostgresAdapter } from '../src/core/adapter';
import { introspectPostgresSchema } from '../src/exports/introspect';

/**
 * Creates a ControlPlaneDriver from a Postgres client.
 */
function createDriverFromClient(client: Client): ControlPlaneDriver {
  return createPostgresDriverFromOptions({
    connect: { client },
    cursor: { disabled: true },
  });
}

/**
 * Gets the codec registry from the Postgres adapter.
 * The adapter's codec registry contains all Postgres codecs with their nativeType metadata.
 */
function getAdapterCodecRegistry(): CodecRegistry {
  const adapter = createPostgresAdapter();
  return adapter.profile.codecs();
}

describe('introspectPostgresSchema (integration with real database)', () => {
  it(
    'introspects complete schema with tables, columns, constraints, indexes, and extensions',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Create a comprehensive schema to test introspection
            // Try to create pgvector extension (may not be available in all test environments)
            try {
              await client.query('CREATE EXTENSION IF NOT EXISTS vector');
            } catch {
              // pgvector extension not available - skip vector-related tests
            }

            await client.query(`
              -- Create users table with various column types
              CREATE TABLE "users" (
                "id" SERIAL PRIMARY KEY,
                "email" TEXT NOT NULL,
                "name" VARCHAR(255),
                "age" SMALLINT,
                "score" REAL,
                "balance" DOUBLE PRECISION,
                "is_active" BOOLEAN NOT NULL DEFAULT true,
                "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "metadata" JSONB,
                "tags" TEXT[]
              );

              -- Create posts table with foreign key
              CREATE TABLE "posts" (
                "id" SERIAL PRIMARY KEY,
                "user_id" INTEGER NOT NULL,
                "title" TEXT NOT NULL,
                "content" TEXT,
                "published" BOOLEAN NOT NULL DEFAULT false,
                "created_at" TIMESTAMPTZ NOT NULL,
                FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
              );

              -- Create unique constraint on users.email
              ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");

              -- Create composite unique constraint
              ALTER TABLE "posts" ADD CONSTRAINT "posts_user_title_unique" UNIQUE ("user_id", "title");

              -- Create indexes
              CREATE INDEX "idx_users_email" ON "users"("email");
              CREATE INDEX "idx_posts_user_id" ON "posts"("user_id");
              CREATE INDEX "idx_posts_created_at" ON "posts"("created_at" DESC);
              CREATE UNIQUE INDEX "idx_users_name_active" ON "users"("name") WHERE "is_active" = true;

            `);

            // Create table with vector column only if pgvector extension is available
            try {
              await client.query(`
                CREATE TABLE IF NOT EXISTS "embeddings" (
                  "id" SERIAL PRIMARY KEY,
                  "text" TEXT NOT NULL,
                  "embedding" vector(1536)
                )
              `);
            } catch {
              // pgvector extension not available - skip embeddings table
            }

            // Create driver and codec registry
            const driver = createDriverFromClient(client);
            const codecRegistry = getAdapterCodecRegistry();

            try {
              // Introspect the schema
              const schemaIR = await introspectPostgresSchema(driver, codecRegistry);

              // Verify schema structure
              expect(schemaIR.tables).toBeDefined();
              expect(typeof schemaIR.tables).toBe('object');

              // Verify users table
              expect(schemaIR.tables).toHaveProperty('users');
              const usersTable = schemaIR.tables['users']!;
              expect(usersTable).toBeDefined();
              expect(usersTable?.name).toBe('users');
              expect(usersTable?.primaryKey).toEqual({ columns: ['id'] });

              // Verify users table columns
              expect(usersTable?.columns).toBeDefined();
              expect(usersTable?.columns.id).toMatchObject({
                name: 'id',
                typeId: 'pg/int4@1',
                nativeType: 'integer',
                nullable: false,
              });
              expect(usersTable?.columns.email).toMatchObject({
                name: 'email',
                typeId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
              });
              expect(usersTable?.columns.name).toMatchObject({
                name: 'name',
                typeId: 'pg/text@1',
                nativeType: 'character varying',
                nullable: true,
              });
              expect(usersTable?.columns.age).toMatchObject({
                name: 'age',
                typeId: 'pg/int2@1',
                nativeType: 'smallint',
                nullable: true,
              });
              expect(usersTable?.columns.score).toMatchObject({
                name: 'score',
                typeId: 'pg/float4@1',
                nativeType: 'real',
                nullable: true,
              });
              expect(usersTable?.columns.balance).toMatchObject({
                name: 'balance',
                typeId: 'pg/float8@1',
                nativeType: 'double precision',
                nullable: true,
              });
              expect(usersTable?.columns.is_active).toMatchObject({
                name: 'is_active',
                typeId: 'pg/bool@1',
                nativeType: 'boolean',
                nullable: false,
              });
              expect(usersTable?.columns.created_at).toMatchObject({
                name: 'created_at',
                typeId: 'pg/timestamp@1',
                nativeType: 'timestamp without time zone',
                nullable: false,
              });
              expect(usersTable?.columns.updated_at).toMatchObject({
                name: 'updated_at',
                typeId: 'pg/timestamptz@1',
                nativeType: 'timestamp with time zone',
                nullable: false,
              });

              // Verify unique constraints on users table
              expect(usersTable?.uniques).toBeDefined();
              expect(usersTable?.uniques.length).toBeGreaterThan(0);
              const emailUnique = usersTable?.uniques.find((u) => u.columns.includes('email'));
              expect(emailUnique).toBeDefined();
              expect(emailUnique?.columns).toEqual(['email']);

              // Verify indexes on users table
              expect(usersTable?.indexes).toBeDefined();
              expect(usersTable?.indexes.length).toBeGreaterThan(0);
              const emailIndex = usersTable?.indexes.find((idx) => idx.columns.includes('email'));
              expect(emailIndex).toBeDefined();
              expect(emailIndex?.unique).toBe(false);

              // Verify posts table
              expect(schemaIR.tables).toHaveProperty('posts');
              const postsTable = schemaIR.tables.posts;
              expect(postsTable).toBeDefined();
              expect(postsTable?.name).toBe('posts');
              expect(postsTable?.primaryKey).toEqual({ columns: ['id'] });

              // Verify posts table columns
              expect(postsTable?.columns.user_id).toMatchObject({
                name: 'user_id',
                typeId: 'pg/int4@1',
                nativeType: 'integer',
                nullable: false,
              });

              // Verify foreign keys on posts table
              expect(postsTable?.foreignKeys).toBeDefined();
              expect(postsTable?.foreignKeys.length).toBe(1);
              const userFk = postsTable?.foreignKeys[0];
              expect(userFk).toMatchObject({
                columns: ['user_id'],
                referencedTable: 'users',
                referencedColumns: ['id'],
              });

              // Verify composite unique constraint on posts table
              expect(postsTable?.uniques).toBeDefined();
              const compositeUnique = postsTable?.uniques.find(
                (u) => u.columns.includes('user_id') && u.columns.includes('title'),
              );
              expect(compositeUnique).toBeDefined();
              expect(compositeUnique?.columns).toEqual(['user_id', 'title']);

              // Verify indexes on posts table
              expect(postsTable?.indexes).toBeDefined();
              expect(postsTable?.indexes.length).toBeGreaterThan(0);
              const userIdIndex = postsTable?.indexes.find((idx) =>
                idx.columns.includes('user_id'),
              );
              expect(userIdIndex).toBeDefined();

              // Verify extensions (should include vector if available)
              expect(schemaIR.extensions).toBeDefined();
              expect(Array.isArray(schemaIR.extensions)).toBe(true);
              // vector extension should be present if pgvector is installed
              if (schemaIR.extensions.includes('vector')) {
                // Verify embeddings table exists if vector extension is available
                expect(schemaIR.tables).toHaveProperty('embeddings');
                const embeddingsTable = schemaIR.tables.embeddings;
                expect(embeddingsTable?.columns.embedding).toBeDefined();
                // Note: vector type mapping would require pgvector codec to be registered
                // For now, we just verify the column exists
                expect(embeddingsTable?.columns.embedding?.name).toBe('embedding');
              }

              // Verify overall schema structure
              expect(Object.keys(schemaIR.tables).length).toBeGreaterThanOrEqual(2); // users and posts at minimum
            } finally {
              await driver.close();
            }
          });
        },
        { acceleratePort: 54300, databasePort: 54301, shadowDatabasePort: 54302 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'correctly maps database types to codec IDs using nativeType metadata',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Create table with various PostgreSQL types
            await client.query(`
              CREATE TABLE "type_test" (
                "int_col" INTEGER,
                "bigint_col" BIGINT,
                "smallint_col" SMALLINT,
                "text_col" TEXT,
                "varchar_col" VARCHAR(100),
                "bool_col" BOOLEAN,
                "real_col" REAL,
                "double_col" DOUBLE PRECISION,
                "timestamp_col" TIMESTAMP,
                "timestamptz_col" TIMESTAMPTZ
              )
            `);

            const driver = createDriverFromClient(client);
            const codecRegistry = getAdapterCodecRegistry();

            try {
              const schemaIR = await introspectPostgresSchema(driver, codecRegistry);

              const typeTestTable = schemaIR.tables.type_test;
              expect(typeTestTable).toBeDefined();

              // Verify type mappings
              expect(typeTestTable?.columns.int_col).toMatchObject({
                typeId: 'pg/int4@1',
                nativeType: 'integer',
              });
              expect(typeTestTable?.columns.bigint_col).toMatchObject({
                typeId: 'pg/int8@1',
                nativeType: 'bigint',
              });
              expect(typeTestTable?.columns.smallint_col).toMatchObject({
                typeId: 'pg/int2@1',
                nativeType: 'smallint',
              });
              expect(typeTestTable?.columns.text_col).toMatchObject({
                typeId: 'pg/text@1',
                nativeType: 'text',
              });
              expect(typeTestTable?.columns.varchar_col).toMatchObject({
                typeId: 'pg/text@1',
                nativeType: 'character varying',
              });
              expect(typeTestTable?.columns.bool_col).toMatchObject({
                typeId: 'pg/bool@1',
                nativeType: 'boolean',
              });
              expect(typeTestTable?.columns.real_col).toMatchObject({
                typeId: 'pg/float4@1',
                nativeType: 'real',
              });
              expect(typeTestTable?.columns.double_col).toMatchObject({
                typeId: 'pg/float8@1',
                nativeType: 'double precision',
              });
              expect(typeTestTable?.columns.timestamp_col).toMatchObject({
                typeId: 'pg/timestamp@1',
                nativeType: 'timestamp without time zone',
              });
              expect(typeTestTable?.columns.timestamptz_col).toMatchObject({
                typeId: 'pg/timestamptz@1',
                nativeType: 'timestamp with time zone',
              });
            } finally {
              await driver.close();
            }
          });
        },
        { acceleratePort: 54303, databasePort: 54304, shadowDatabasePort: 54305 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'filters tables based on contract when provided',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Create multiple tables
            await client.query(`
              CREATE TABLE "users" (
                "id" SERIAL PRIMARY KEY,
                "email" TEXT NOT NULL
              );
              CREATE TABLE "posts" (
                "id" SERIAL PRIMARY KEY,
                "title" TEXT NOT NULL
              );
              CREATE TABLE "comments" (
                "id" SERIAL PRIMARY KEY,
                "content" TEXT NOT NULL
              );
            `);

            const driver = createDriverFromClient(client);
            const codecRegistry = getAdapterCodecRegistry();

            // Create a contract that only references users and posts
            const contract = {
              storage: {
                tables: {
                  users: {},
                  posts: {},
                },
              },
            };

            try {
              // Introspect with contract filter
              const schemaIR = await introspectPostgresSchema(driver, codecRegistry, contract);

              // Should only include tables from contract
              expect(schemaIR.tables).toHaveProperty('users');
              expect(schemaIR.tables).toHaveProperty('posts');
              expect(schemaIR.tables).not.toHaveProperty('comments');
            } finally {
              await driver.close();
            }
          });
        },
        { acceleratePort: 54306, databasePort: 54307, shadowDatabasePort: 54308 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
