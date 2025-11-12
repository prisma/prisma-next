import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { loadContractFromTs } from '@prisma-next/cli';
import {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractExtensionIdsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '@prisma-next/cli/pack-assembly';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres/runtime';
import { emit } from '@prisma-next/emitter';
import sqlFamilyDescriptor from '@prisma-next/family-sql/cli';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadExtensionPacks } from '../../../packages/framework/tooling/cli/src/pack-loading';
import { stampMarker } from '../scripts/stamp-marker';
import type { Contract } from '../src/prisma/contract.d';
import { closeRuntime } from '../src/prisma/runtime';

let contract: Contract;

beforeAll(async () => {
  const contractPath = resolve(__dirname, '../prisma/contract.ts');
  const outputDir = resolve(__dirname, '../src/prisma');
  const adapterPath = resolve(__dirname, '../../../packages/targets/postgres-adapter');

  const contractIR = await loadContractFromTs(contractPath);
  const packs = loadExtensionPacks(adapterPath, []);
  const operationRegistry = assembleOperationRegistryFromPacks(packs, sqlFamilyDescriptor);
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

describe('ORM integration tests', () => {
  it(
    'orm.getUsers returns users with selected fields, respects limit and ordering',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        await closeRuntime();

        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query(
              'insert into "user" (email, "createdAt") values ($1, now()), ($2, now()), ($3, now())',
              ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
            );
          });

          const { ormGetUsers } = await import('../src/queries/orm-get-users');
          const users = await ormGetUsers(2);

          expect(users).toHaveLength(2);
          expect(users[0]).toHaveProperty('id');
          expect(users[0]).toHaveProperty('email');
          expect(users[0]).toHaveProperty('createdAt');
          expect(users[0]).not.toHaveProperty('posts');
          expect(typeof (users[0] as { id: unknown }).id).toBe('number');
          expect(typeof (users[0] as { email: unknown }).email).toBe('string');
        } finally {
          await runtime.close();
          await closeRuntime();
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'orm.getUserById returns single user by ID',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        await closeRuntime();
        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          const { ormGetUserById } = await import('../src/queries/orm-get-user-by-id');
          const user = await ormGetUserById(1);

          expect(user).not.toBeNull();
          expect(user).toHaveProperty('id', 1);
          expect(user).toHaveProperty('email', 'alice@example.com');
          expect(user).toHaveProperty('createdAt');
        } finally {
          await runtime.close();
          await closeRuntime();
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm relation filters: where.related.posts.some() returns users with at least one post',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        await closeRuntime();
        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
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

          const { ormGetUsersWithPosts } = await import('../src/queries/orm-relation-filters');
          const users = await ormGetUsersWithPosts();

          expect(users.length).toBeGreaterThan(0);
          expect(users[0]).toHaveProperty('id');
          expect(users[0]).toHaveProperty('email');
        } finally {
          await runtime.close();
          await closeRuntime();
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm includes: include.posts() returns users with nested posts arrays',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        await closeRuntime();
        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
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

          const { ormGetUsersWithPosts } = await import('../src/queries/orm-includes');
          const users = await ormGetUsersWithPosts(10);

          expect(users.length).toBeGreaterThan(0);
          expect(users[0]).toHaveProperty('id');
          expect(users[0]).toHaveProperty('email');
          expect(users[0]).toHaveProperty('posts');
          expect(Array.isArray((users[0] as { posts: unknown }).posts)).toBe(true);
        } finally {
          await runtime.close();
          await closeRuntime();
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: create() inserts a user',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        // Reset cached runtime so it uses the new connection string
        await closeRuntime();

        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
          });

          const { ormCreateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormCreateUser('alice@example.com');

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
          await runtime.close();
          await closeRuntime(); // Clean up runtime created by getRuntime()
          // Restore original DATABASE_URL
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: update() updates a user',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        await closeRuntime();
        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          // Ensure DATABASE_URL is still set before calling the function
          if (!process.env['DATABASE_URL']) {
            process.env['DATABASE_URL'] = connectionString;
          }
          const { ormUpdateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormUpdateUser(1, 'alice-updated@example.com');

          expect(affectedRows).toBe(1);

          const email = await withClient(connectionString, async (client: import('pg').Client) => {
            const result = await client.query('select email from "user" where id = $1', [1]);
            return result.rows[0]?.email as string;
          });
          expect(email).toBe('alice-updated@example.com');
        } finally {
          await runtime.close();
          await closeRuntime(); // Clean up runtime created by getRuntime()
          // Restore original DATABASE_URL
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm writes: delete() deletes a user',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        // Set DATABASE_URL for getRuntime() used by query functions
        const originalDatabaseUrl = process.env['DATABASE_URL'];
        process.env['DATABASE_URL'] = connectionString;
        // Reset cached runtime so it uses the new connection string
        await closeRuntime();
        const adapter = createPostgresAdapter();
        const context = createRuntimeContext({ contract, adapter, extensions: [] });
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

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          const { ormDeleteUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormDeleteUser(1);

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
          await runtime.close();
          await closeRuntime();
          if (originalDatabaseUrl !== undefined) {
            process.env['DATABASE_URL'] = originalDatabaseUrl;
          } else {
            delete process.env['DATABASE_URL'];
          }
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
