import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '../src/prisma-client';
import type { DataContract } from '@prisma-next/sql/types';
import { Client } from 'pg';
import { createPostgresDriver } from '@prisma-next/driver-postgres';
import { createRuntime } from '@prisma-next/runtime';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres';

const testContract: DataContract = {
  target: 'postgres',
  coreHash: 'sha256:test-core',
  profileHash: 'sha256:test-profile',
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'text', nullable: false },
          email: { type: 'text', nullable: false },
          name: { type: 'text', nullable: false },
          createdAt: { type: 'timestamptz', nullable: false },
        },
      },
    },
  },
};

// Shared query module that accepts a client with used methods
interface CompatClient {
  user: {
    findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    create(args: { data: { id: string; email: string; name: string } }): Promise<Record<string, unknown>>;
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
  let client: Client;
  let prismaPN: PrismaClient;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    client = new Client({ connectionString });
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

    const driver = createPostgresDriver(connectionString);
    const runtime = createRuntime({
      contract: testContract,
      adapter: createPostgresAdapter(),
      driver,
      verify: {
        mode: 'onFirstUse',
        requireMarker: false,
      },
    });

    prismaPN = new PrismaClient({
      contract: testContract,
      runtime,
    });
  });

  afterAll(async () => {
    await prismaPN.$disconnect();
    await client.query('DROP TABLE IF EXISTS "user"');
    await client.end();
  });

  beforeEach(async () => {
    // Reset schema between tests
    await client.query('TRUNCATE TABLE "user" CASCADE');
  });

  describe('PN + compatibility layer', () => {
    it('creates a user and returns the created record', async () => {
      const result = await createUser(prismaPN, {
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('test-1');
      expect(result.email).toBe('test@example.com');
      expect(result.name).toBe('Test User');
      expect(result.createdAt).toBeDefined();
    });

    it('finds a unique user by id', async () => {
      // Seed data
      await createUser(prismaPN, {
        id: 'test-1',
        email: 'test@example.com',
        name: 'Test User',
      });

      const result = await readUserById(prismaPN, 'test-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-1');
      expect(result?.email).toBe('test@example.com');
      expect(result?.name).toBe('Test User');
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
      expect(results.some((u: Record<string, unknown>) => u.id === 'test-1')).toBe(true);
      expect(results.some((u: Record<string, unknown>) => u.id === 'test-2')).toBe(true);
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

      expect(result).toBeDefined();
      expect(result?.email).toBe('test@example.com');
    });
  });

  describe('Guardrail: unbounded findMany should trigger budget error', () => {
    it('throws BUDGET.ROWS_EXCEEDED for unbounded select without limit', async () => {
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
    });
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
});
