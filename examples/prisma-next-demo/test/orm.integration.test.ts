import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContractFromTs } from '@prisma-next/cli';
import { emit } from '@prisma-next/emitter';
import {
  assembleOperationRegistry,
  convertOperationManifest,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '@prisma-next/family-sql/test-utils';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { type createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import { closeTestRuntime, createTestRuntime, initTestDatabase } from './utils/control-client';
import {
  getSqlDescriptorBundle,
  pgvectorExtensionDescriptor,
  pgvectorExtensionRuntimeDescriptor,
  postgresAdapterRuntimeDescriptor,
  postgresTargetRuntimeDescriptor,
} from './utils/framework-components';

let contract: Contract;
let contractIR: Awaited<ReturnType<typeof loadContractFromTs>>;

beforeAll(async () => {
  const contractPath = resolve(__dirname, '../prisma/contract.ts');
  const outputDir = resolve(__dirname, '../src/prisma');

  contractIR = await loadContractFromTs(contractPath);
  const { adapter, target, extensions, descriptors } = getSqlDescriptorBundle({
    extensions: [pgvectorExtensionDescriptor],
  });
  const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
  const codecTypeImports = extractCodecTypeImports(descriptors);
  const operationTypeImports = extractOperationTypeImports(descriptors);
  const extensionIds = extractExtensionIds(adapter, target, extensions);

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
  writeFileSync(join(outputDir, 'contract.json'), result.contractJson, 'utf-8');
  writeFileSync(join(outputDir, 'contract.d.ts'), result.contractDts, 'utf-8');

  const contractJson = JSON.parse(result.contractJson);
  contract = validateContract<Contract>(contractJson);
}, timeouts.typeScriptCompilation);

/**
 * Creates a runtime context for the given contract.
 */
function createContext<TContract extends SqlContract<SqlStorage>>(contract: TContract) {
  return createRuntimeContext({
    contract,
    target: postgresTargetRuntimeDescriptor,
    adapter: postgresAdapterRuntimeDescriptor,
    extensionPacks: [pgvectorExtensionRuntimeDescriptor],
  });
}

/**
 * Seeds test data using the runtime and query DSL.
 */
async function seedTestData(
  runtime: ReturnType<typeof createRuntime>,
  contract: Contract,
  data: { users?: string[]; posts?: Array<{ title: string; userIndex: number }> },
): Promise<{ userIds: number[] }> {
  const context = createContext(contract);
  const tables = schema(context).tables;
  const userTable = tables['user']!;
  const postTable = tables['post']!;

  const userIds: number[] = [];

  // Insert users
  if (data.users) {
    for (const email of data.users) {
      const plan = sql({ context })
        .insert(userTable, { email: param('email') })
        .returning(userTable.columns['id']!)
        .build({ params: { email } });

      for await (const row of runtime.execute(plan)) {
        userIds.push((row as { id: number }).id);
      }
    }
  }

  // Insert posts
  if (data.posts) {
    for (const post of data.posts) {
      const userId = userIds[post.userIndex];
      if (userId === undefined) continue;

      const plan = sql({ context })
        .insert(postTable, { title: param('title'), userId: param('userId') })
        .build({ params: { title: post.title, userId } });

      for await (const _row of runtime.execute(plan)) {
        // consume iterator
      }
    }
  }

  return { userIds };
}

describe('ORM integration tests', () => {
  it(
    'orm.getUsers returns users with selected fields, respects limit and ordering',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        // Initialize schema using control client
        await initTestDatabase({ connection: connectionString, contractIR });

        const { runtime, pool } = createTestRuntime(connectionString, contract);
        try {
          // Seed data using runtime
          await seedTestData(runtime, contract, {
            users: ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
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
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await seedTestData(runtime, contract, { users: ['alice@example.com'] });

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
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await seedTestData(runtime, contract, {
            users: ['alice@example.com', 'bob@example.com'],
            posts: [{ title: 'First Post', userIndex: 0 }],
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
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await seedTestData(runtime, contract, {
            users: ['alice@example.com', 'bob@example.com'],
            posts: [
              { title: 'First Post', userIndex: 0 },
              { title: 'Second Post', userIndex: 0 },
              { title: 'Third Post', userIndex: 1 },
            ],
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
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          process.env['DATABASE_URL'] = connectionString;
          const { ormCreateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormCreateUser('alice@example.com', runtime);

          expect(affectedRows).toBe(1);
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
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await seedTestData(runtime, contract, { users: ['alice@example.com'] });

          process.env['DATABASE_URL'] = connectionString;
          const { ormUpdateUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormUpdateUser(1, 'alice-updated@example.com', runtime);

          expect(affectedRows).toBe(1);
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
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          await seedTestData(runtime, contract, { users: ['alice@example.com'] });

          process.env['DATABASE_URL'] = connectionString;
          const { ormDeleteUser } = await import('../src/queries/orm-writes');
          const affectedRows = await ormDeleteUser(1, runtime);

          expect(affectedRows).toBe(1);
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm pagination: ormGetUsersByIdCursor returns paginated users with gt cursor',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          const emails = Array.from({ length: 10 }, (_, i) => `user${i + 1}@example.com`);
          await seedTestData(runtime, contract, { users: emails });

          process.env['DATABASE_URL'] = connectionString;
          const { ormGetUsersByIdCursor } = await import('../src/queries/orm-pagination');

          const firstPage = await ormGetUsersByIdCursor(null, 3, runtime);
          expect(firstPage).toHaveLength(3);
          expect(firstPage.map((u) => u.id)).toEqual([1, 2, 3]);

          const secondPage = await ormGetUsersByIdCursor(3, 3, runtime);
          expect(secondPage).toHaveLength(3);
          expect(secondPage.map((u) => u.id)).toEqual([4, 5, 6]);

          const thirdPage = await ormGetUsersByIdCursor(6, 3, runtime);
          expect(thirdPage).toHaveLength(3);
          expect(thirdPage.map((u) => u.id)).toEqual([7, 8, 9]);

          const lastPage = await ormGetUsersByIdCursor(9, 3, runtime);
          expect(lastPage).toHaveLength(1);
          expect(lastPage.map((u) => u.id)).toEqual([10]);

          const emptyPage = await ormGetUsersByIdCursor(10, 3, runtime);
          expect(emptyPage).toHaveLength(0);
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orm pagination: ormGetUsersBackward returns users before cursor with lt operator',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contractIR });
        const { runtime, pool } = createTestRuntime(connectionString, contract);

        try {
          const emails = Array.from({ length: 10 }, (_, i) => `user${i + 1}@example.com`);
          await seedTestData(runtime, contract, { users: emails });

          process.env['DATABASE_URL'] = connectionString;
          const { ormGetUsersBackward } = await import('../src/queries/orm-pagination');

          const page = await ormGetUsersBackward(8, 3, runtime);
          expect(page).toHaveLength(3);
          expect(page.map((u) => u.id)).toEqual([7, 6, 5]);

          const earlierPage = await ormGetUsersBackward(4, 3, runtime);
          expect(earlierPage).toHaveLength(3);
          expect(earlierPage.map((u) => u.id)).toEqual([3, 2, 1]);

          const partialPage = await ormGetUsersBackward(2, 3, runtime);
          expect(partialPage).toHaveLength(1);
          expect(partialPage.map((u) => u.id)).toEqual([1]);

          const emptyPage = await ormGetUsersBackward(1, 3, runtime);
          expect(emptyPage).toHaveLength(0);
        } finally {
          await closeTestRuntime({ runtime, pool });
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
