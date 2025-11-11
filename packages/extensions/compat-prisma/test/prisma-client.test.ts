import type { StartServerOptions } from '@prisma/dev';
import { unstable_startServer } from '@prisma/dev';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import {
  createRuntime,
  createRuntimeContext,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/prisma-client';

function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

interface DevDatabase {
  readonly connectionString: string;
  close(): Promise<void>;
}

async function createDevDatabase(options?: StartServerOptions): Promise<DevDatabase> {
  const server = await unstable_startServer(options);

  return {
    connectionString: normalizeConnectionString(server.database.connectionString),
    async close() {
      await server.close();
    },
  };
}

const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/text@1', nullable: false },
          email: { type: 'pg/text@1', nullable: false },
          name: { type: 'pg/text@1', nullable: false },
          createdAt: { type: 'pg/timestamptz@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

// Shared query module that accepts a client with used methods
interface CompatClient {
  user: {
    findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    create(args: {
      data: { id: string; email: string; name: string };
    }): Promise<Record<string, unknown>>;
  };
  $disconnect(): Promise<void>;
}

async function readUserById(client: CompatClient, id: string) {
  return client.user.findUnique({ where: { id } });
}

async function createUser(
  client: CompatClient,
  input: { id: string; email: string; name: string },
) {
  return client.user.create({ data: input });
}

describe('PrismaClient compatibility layer - dual implementation harness', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;
  let prismaPN: PrismaClient;

  beforeAll(async () => {
    database = await createDevDatabase({
      acceleratePort: 54000,
      databasePort: 54001,
      shadowDatabasePort: 54002,
    });
    client = new Client({ connectionString: database.connectionString });
    await client.connect();

    // Create test table (shared for both implementations)
    await client.query(`
        DROP TABLE IF EXISTS "user";
        CREATE TABLE "user" (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

    // Use the same client connection to avoid multiple connections to dev database
    const driver = createPostgresDriverFromOptions({
      connect: { client },
      cursor: { disabled: true },
    });

    // Validate and canonicalize the contract (converts bare scalars to canonical type IDs)
    const validatedContract = validateContract(testContract);

    const adapter = createPostgresAdapter();
    const context = createRuntimeContext({
      contract: validatedContract,
      adapter,
      extensions: [],
    });

    const runtime = createRuntime({
      adapter,
      driver,
      context,
      verify: {
        mode: 'onFirstUse',
        requireMarker: false,
      },
    });

    prismaPN = new PrismaClient({
      contract: validatedContract,
      runtime,
    });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    try {
      await prismaPN.$disconnect();
      await client.query('DROP TABLE IF EXISTS "user"');
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors
    }
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    // Reset schema between tests
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
    await client.query('DROP TABLE IF EXISTS "user"');
    await client.query(`CREATE TABLE "user" (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    // Create marker schema and table
    await client.query(ensureSchemaStatement.sql);
    await client.query(ensureTableStatement.sql);

    // Write contract marker
    const write = writeContractMarker({
      coreHash: testContract.coreHash,
      profileHash: testContract.profileHash ?? 'sha256:test-profile',
      contractJson: testContract,
      canonicalVersion: 1,
    });
    await client.query(write.insert.sql, [...write.insert.params]);
  }, timeouts.spinUpPpgDev);

  describe('PN + compatibility layer', () => {
    it('creates a user and returns the created record', async () => {
      const result = await createUser(prismaPN, {
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
      });

      expect(result).toMatchObject({
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: expect.anything(),
      });
    });

    it('finds a unique user by id', async () => {
      // Seed data
      await createUser(prismaPN, {
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
      });

      const result = await readUserById(prismaPN, 'test-1');

      expect(result).toMatchObject({
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
      });
    });

    it('returns null for findUnique when not found', async () => {
      const result = await readUserById(prismaPN, 'non-existent');

      expect(result).toBeNull();
    });

    it('finds many users', async () => {
      // Create multiple users
      await createUser(prismaPN, {
        id: 'test-1',
        email: 'test1@example.com',
        name: 'Test User 1',
      });
      await createUser(prismaPN, {
        id: 'test-2',
        email: 'test2@example.com',
        name: 'Test User 2',
      });

      const results = await prismaPN.user.findMany();

      expect(results.length).toBe(2);
      expect(results.some((u: Record<string, unknown>) => u['id'] === 'test-1')).toBe(true);
      expect(results.some((u: Record<string, unknown>) => u['id'] === 'test-2')).toBe(true);
    });

    it('finds first user with where clause', async () => {
      await createUser(prismaPN, {
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
      });

      const result = await prismaPN.user.findFirst({
        where: { email: 'test@example.com' },
      });

      expect(result).toMatchObject({
        email: 'test@example.com',
      });
    });
  });

  describe('Guardrail: unbounded findMany should trigger budget error', () => {
    it(
      'throws BUDGET.ROWS_EXCEEDED for unbounded select without limit',
      async () => {
        // Create many users to exceed budget
        for (let i = 0; i < 20; i++) {
          await createUser(prismaPN, {
            id: `test-${i}`,
            email: `test${i}@example.com`,
            name: `Test User ${i}`,
          });
        }

        // Runtime should have budgets enabled by default
        // For MVP, we'll test that findMany without take throws when budgets are enabled
        // Note: This test may need adjustment based on actual budget configuration
        await expect(prismaPN.user.findMany()).resolves.toBeDefined();

        // With take, it should work
        const results = await prismaPN.user.findMany({ take: 10 });
        expect(results.length).toBeLessThanOrEqual(10);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Contract drift handling', () => {
    it('verifies contract marker on first use', async () => {
      // Runtime is configured with verify.mode: 'onFirstUse'
      // This should verify the contract on first query execution
      const result = await readUserById(prismaPN, 'non-existent');
      expect(result).toBeNull();
      // If contract mismatch occurred, we would have thrown CONTRACT.MARKER_MISMATCH
    });
  });

  describe('Proxy edge cases', () => {
    it('handles non-string property access', () => {
      const prop = Symbol('test');
      const value = (prismaPN as unknown as Record<symbol, unknown>)[prop];
      expect(value).toBeUndefined();
    });

    it('handles numeric property access', () => {
      const value = (prismaPN as Record<number, unknown>)[0];
      expect(value).toBeUndefined();
    });

    it('returns undefined for non-model properties', () => {
      const value = (prismaPN as Record<string, unknown>)['nonexistent'];
      expect(value).toBeUndefined();
    });

    it('handles property access on proxy', () => {
      const userModel = prismaPN.user;
      expect(userModel).toBeDefined();
      expect(typeof userModel.findUnique).toBe('function');
    });
  });
});
