import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initMarker } from '@prisma-next/adapter-mongo/control';
import { createDbVerifyCommand } from '@prisma-next/cli/commands/db-verify';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

const testContract: MongoContract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { users: 'User' },
  models: {
    User: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      },
      relations: {},
      storage: { collection: 'users' },
    },
  },
  storage: {
    collections: {
      users: {
        indexes: [{ keys: [{ field: 'email', direction: 1 as const }], unique: true }],
      },
    },
    storageHash: coreHash('sha256:mongo-verify-test'),
  },
  capabilities: {},
  extensionPacks: {},
  profileHash: profileHash('sha256:mongo-verify-test'),
  meta: {},
};

function extractJson(lines: string[]): unknown {
  const joined = lines.join('\n');
  const start = joined.indexOf('{');
  const end = joined.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in output:\n${joined}`);
  }
  return JSON.parse(joined.slice(start, end + 1));
}

function writeContractJson(testDir: string, contract: MongoContract): void {
  const outputDir = resolve(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'contract.json'), JSON.stringify(contract, null, 2), 'utf-8');
}

describe('mongo db verify command (e2e)', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let mongoUri: string;
  const dbName = 'verify_e2e_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: timeouts.spinUpDbServer, storageEngine: 'wiredTiger' }],
      replSet: { count: 1, storageEngine: 'wiredTiger', dbName },
    });
    const baseUri = replSet.getUri();
    const url = new URL(baseUri);
    url.pathname = `/${dbName}`;
    mongoUri = url.toString();
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpDbServer);

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // ignore cleanup errors
    }
  }, timeouts.spinUpDbServer);

  withTempDir(({ createTempDir }) => {
    let consoleOutput: string[] = [];
    let cleanupMocks: () => void = () => {};

    beforeEach(async () => {
      await db.dropDatabase();
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    it('reports error when marker is missing', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma-next.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const command = createDbVerifyCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testSetup.testDir);
        await expect(
          executeCommand(command, ['--config', testSetup.configPath, '--json']),
        ).rejects.toThrow('process.exit called');
      } finally {
        process.chdir(originalCwd);
      }

      expect(getExitCode()).not.toBe(0);
      const parsed = extractJson(consoleOutput) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        code: 'PN-RUN-3001',
      });
    });

    it('verifies matching marker and schema', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await initMarker(db, {
        storageHash: testContract.storage.storageHash,
        profileHash: testContract.profileHash!,
      });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma-next.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const outputStartIndex = consoleOutput.length;
      const command = createDbVerifyCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testSetup.testDir);
        await executeCommand(command, ['--config', testSetup.configPath, '--json']);
      } finally {
        process.chdir(originalCwd);
      }

      expect(getExitCode()).toBe(0);
      const parsed = extractJson(consoleOutput.slice(outputStartIndex)) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        ok: true,
        summary: expect.any(String),
      });
    });

    it('runs schema-only verification with matching schema', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma-next.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const outputStartIndex = consoleOutput.length;
      const command = createDbVerifyCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testSetup.testDir);
        await executeCommand(command, [
          '--config',
          testSetup.configPath,
          '--schema-only',
          '--json',
        ]);
      } finally {
        process.chdir(originalCwd);
      }

      expect(getExitCode()).toBe(0);
      const parsed = extractJson(consoleOutput.slice(outputStartIndex)) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        ok: true,
        summary: expect.stringContaining('matches contract'),
        meta: { strict: false },
      });
    });

    it('fails schema-only verification when index is missing', async () => {
      await db.createCollection('users');

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma-next.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const outputStartIndex = consoleOutput.length;
      const command = createDbVerifyCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testSetup.testDir);
        await expect(
          executeCommand(command, ['--config', testSetup.configPath, '--schema-only', '--json']),
        ).rejects.toThrow('process.exit called');
      } finally {
        process.chdir(originalCwd);
      }

      expect(getExitCode()).toBe(1);
      const parsed = extractJson(consoleOutput.slice(outputStartIndex)) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        ok: false,
      });
    });

    it('runs marker-only verification with matching marker', async () => {
      await initMarker(db, {
        storageHash: testContract.storage.storageHash,
        profileHash: testContract.profileHash!,
      });

      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'mongo-db-commands',
        'prisma-next.config.with-db.ts',
        { '{{MONGO_URI}}': mongoUri },
      );
      writeContractJson(testSetup.testDir, testContract);

      const outputStartIndex = consoleOutput.length;
      const command = createDbVerifyCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testSetup.testDir);
        await executeCommand(command, [
          '--config',
          testSetup.configPath,
          '--marker-only',
          '--json',
        ]);
      } finally {
        process.chdir(originalCwd);
      }

      expect(getExitCode()).toBe(0);
      const parsed = extractJson(consoleOutput.slice(outputStartIndex)) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        ok: true,
        mode: 'marker-only',
      });
    });
  });
});
