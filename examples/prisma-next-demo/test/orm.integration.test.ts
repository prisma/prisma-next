import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { loadContractFromTs } from '@prisma-next/cli';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres/runtime';
import { emit } from '@prisma-next/emitter';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadExtensionPacks } from '../../../packages/framework/tooling/cli/src/pack-loading';
import {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractExtensionIdsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '../../../packages/sql/family/src/core/assembly';
import { stampMarker } from '../scripts/stamp-marker';
import type { Contract } from '../src/prisma/contract.d';

let contract: Contract;

beforeAll(async () => {
  const contractPath = resolve(__dirname, '../prisma/contract.ts');
  const outputDir = resolve(__dirname, '../src/prisma');
  const adapterPath = resolve(__dirname, '../../../packages/targets/postgres-adapter');
  const pgvectorPath = resolve(__dirname, '../../../packages/extensions/pgvector');

  const contractIR = await loadContractFromTs(contractPath);
  const packs = loadExtensionPacks(adapterPath, [pgvectorPath]);
  const operationRegistry = assembleOperationRegistryFromPacks(packs);
  const codecTypeImports = extractCodecTypeImportsFromPacks(packs);
  const operationTypeImports = extractOperationTypeImportsFromPacks(packs);
  const extensionIds = extractExtensionIdsFromPacks(packs);

  const result = await emit(
    contractIR,
    {
      outputDir,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    },
    sqlTargetFamilyHook,
  );

  mkdirSync(outputDir, { recursive: true });

  // Write emitted JSON directly - do not call validateContract here as it adds mappings
  // The emitted JSON should not contain mappings (they are computed at runtime)
  writeFileSync(join(outputDir, 'contract.json'), result.contractJson, 'utf-8');
  writeFileSync(join(outputDir, 'contract.d.ts'), result.contractDts, 'utf-8');

  // Validate contract for use in tests (this adds mappings at runtime, which is correct)
  const contractJson = JSON.parse(result.contractJson);
  contract = validateContract<Contract>(contractJson);
}, timeouts.typeScriptCompilation);

/**
 * Creates a test runtime with adapter, context, pool, driver, and runtime configured.
 * Returns both runtime and pool for cleanup.
 */
function createTestRuntime(
  connectionString: string,
  contract: Contract,
): {
  runtime: ReturnType<typeof createRuntime>;
  pool: Pool;
} {
  const adapter = createPostgresAdapter();
  const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
  const pool = new Pool({ connectionString });
  const driver = createPostgresDriverFromOptions({
    connect: { pool },
    cursor: { disabled: true },
  });
  const runtime = createRuntime({
    context,
    adapter,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
    plugins: [
      budgets({
        maxRows: 10_000,
        defaultTableRows: 10_000,
        tableRows: { user: 10_000, post: 10_000 },
      }),
    ],
  });
  return { runtime, pool };
}

/**
 * Closes the test runtime and pool.
 */
async function closeTestRuntime({
  runtime,
  pool,
}: {
  runtime: ReturnType<typeof createRuntime>;
  pool: Pool;
}): Promise<void> {
  try {
    await runtime.close();
  } finally {
    await pool.end();
  }
}

describe('ORM integration tests', () => {
  it(
    'orm.getUsers returns users with selected fields, respects limit and ordering',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query(
              'insert into "user" (email, "createdAt") values ($1, now()), ($2, now()), ($3, now())',
              ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
            );
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormGetUsers } = await import('../src/queries/orm-get-users');
          const users = await ormGetUsers(2, runtime);

          expect(users).toHaveLength(2);
          expect(users[0]).toMatchObject({
            id: expect.any(Number),
            email: expect.any(String),
            createdAt: expect.anything(),
          });
          expect(users[0]).not.toMatchObject({ posts: expect.anything() });
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'orm.getUserById returns single user by ID',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormGetUserById } = await import('../src/queries/orm-get-user-by-id');
          const user = await ormGetUserById(1, runtime);

          expect(user).not.toBeNull();
          expect(user).toMatchObject({
            id: 1,
            email: 'alice@example.com',
            createdAt: expect.anything(),
          });
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm relation filters: where.related.posts.some() returns users with at least one post',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query(
              'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
            );
            await client.query('truncate table "post", "user" restart identity cascade');
            await client.query(
              'insert into "user" (email, "createdAt") values ($1, now()), ($2, now())',
              ['alice@example.com', 'bob@example.com'],
            );
            await client.query(
              'insert into "post" (title, "userId", "createdAt") values ($1, $2, now())',
              ['First Post', 1],
            );
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormGetUsersWithPosts } = await import('../src/queries/orm-relation-filters');
          const users = await ormGetUsersWithPosts(runtime);

          expect(users.length).toBeGreaterThan(0);
          expect(users[0]).toMatchObject({
            id: expect.anything(),
            email: expect.anything(),
          });
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm includes: include.posts() returns users with nested posts arrays',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query(
              'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
            );
            await client.query('truncate table "post", "user" restart identity cascade');
            await client.query(
              'insert into "user" (email, "createdAt") values ($1, now()), ($2, now())',
              ['alice@example.com', 'bob@example.com'],
            );
            await client.query(
              'insert into "post" (title, "userId", "createdAt") values ($1, $2, now()), ($3, $2, now()), ($4, $5, now())',
              ['First Post', 1, 'Second Post', 'Third Post', 2],
            );
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormGetUsersWithPosts } = await import('../src/queries/orm-includes');
          const users = await ormGetUsersWithPosts(10, runtime);

          expect(users.length).toBeGreaterThan(0);
          expect(users[0]).toMatchObject({
            id: expect.anything(),
            email: expect.anything(),
            posts: expect.any(Array),
          });
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: create() inserts a user',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormCreateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormCreateUser('alice@example.com', runtime);

          expect(affectedRows).toBe(1);

          const rowCount = await withClient(
            connectionString,
            async (client: import('pg').Client) => {
              const result = await client.query('select count(*)::int as count from "user"');
              return result.rows[0]?.count as number;
            },
          );
          expect(rowCount).toBe(1);
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: update() updates a user',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormUpdateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormUpdateUser(1, 'alice-updated@example.com', runtime);

          expect(affectedRows).toBe(1);

          const email = await withClient(connectionString, async (client: import('pg').Client) => {
            const result = await client.query('select email from "user" where id = $1', [1]);
            return result.rows[0]?.email as string;
          });
          expect(email).toBe('alice-updated@example.com');
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: delete() deletes a user',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          process.env['DATABASE_URL'] = connectionString;
          const { ormDeleteUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormDeleteUser(1, runtime);

          expect(affectedRows).toBe(1);

          const rowCount = await withClient(
            connectionString,
            async (client: import('pg').Client) => {
              const result = await client.query('select count(*)::int as count from "user"');
              return result.rows[0]?.count as number;
            },
          );
          expect(rowCount).toBe(0);
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
