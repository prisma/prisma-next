import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContractEmitCommand } from '../src/commands/contract-emit';
import { createDbSignCommand } from '../src/commands/db-sign';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for db-sign e2e tests
const fixtureSubdir = 'db-sign';

describe('db sign command (e2e)', () => {
  let consoleOutput: string[] = [];
  let cleanupMocks: () => void;
  let cleanupDirs: Array<() => void> = [];

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    consoleOutput = mocks.consoleOutput;
    cleanupMocks = mocks.cleanup;
    cleanupDirs = [];
  });

  afterEach(() => {
    cleanupMocks();
    // Clean up all test directories, even if test failed or timed out
    for (const cleanupDir of cleanupDirs) {
      try {
        cleanupDir();
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
  });

  it(
    'creates marker when schema matches contract',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up database schema first, then close connection
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL
              )
            `);
          });

          // Set up test directory with config and contract
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;
          cleanupDirs.push(cleanupDir); // Track for afterEach cleanup

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          try {
            const command = createDbSignCommand();
            try {
              process.chdir(testSetup.testDir);
              await executeCommand(command, ['--config', configPath, '--no-color']);
            } finally {
              process.chdir(originalCwd);
            }

            // Get output and strip ANSI for snapshot
            const output = consoleOutput.join('\n');
            const stripped = stripAnsi(output);

            // Normalize database URL (port number) in output for snapshot
            const normalized = stripped.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:XXXXX');

            // Verify marker was created in database
            await withClient(connectionString, async (client) => {
              const result = await client.query(
                'select core_hash, profile_hash from prisma_contract.marker where id = $1',
                [1],
              );
              expect(result.rows.length).toBe(1);
              expect(result.rows[0]?.core_hash).toBeDefined();
            });

            // Snapshot test for output
            expect(normalized).toMatchSnapshot();
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54220, databasePort: 54221, shadowDatabasePort: 54222 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'fails when schema does not match contract',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up database schema that does NOT match contract (missing table)
          await withClient(connectionString, async (client) => {
            // Create a different table, not "user"
            await client.query(`
              CREATE TABLE IF NOT EXISTS "post" (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL
              )
            `);
          });

          // Set up test directory with config and contract
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;
          cleanupDirs.push(cleanupDir); // Track for afterEach cleanup

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          try {
            const command = createDbSignCommand();
            try {
              process.chdir(testSetup.testDir);
              await expect(
                executeCommand(command, ['--config', configPath, '--no-color']),
              ).rejects.toThrow();
            } finally {
              process.chdir(originalCwd);
            }

            // Verify marker was NOT created in database
            await withClient(connectionString, async (client) => {
              // Ensure marker table exists (might have been created by sign attempt)
              await client.query(`
                CREATE SCHEMA IF NOT EXISTS prisma_contract
              `);
              await client.query(`
                CREATE TABLE IF NOT EXISTS prisma_contract.marker (
                  id smallint primary key default 1,
                  core_hash text not null,
                  profile_hash text not null,
                  contract_json jsonb,
                  canonical_version int,
                  updated_at timestamptz not null default now(),
                  app_tag text,
                  meta jsonb not null default '{}'
                )
              `);
              const result = await client.query(
                'select count(*) as count from prisma_contract.marker where id = $1',
                [1],
              );
              // Marker should not exist (sign should have failed before writing)
              expect(Number.parseInt(result.rows[0]?.count ?? '0', 10)).toBe(0);
            });
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54260, databasePort: 54261, shadowDatabasePort: 54262 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'outputs JSON envelope with real database',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          // Set up database schema first, then close connection
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL
              )
            `);
          });

          // Set up test directory with config and contract
          const testSetup = setupTestDirectoryFromFixtures(
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;
          const cleanupDir = testSetup.cleanup;
          cleanupDirs.push(cleanupDir); // Track for afterEach cleanup

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          try {
            const command = createDbSignCommand();
            try {
              process.chdir(testSetup.testDir);
              await executeCommand(command, ['--config', configPath, '--json', '--no-color']);
            } finally {
              process.chdir(originalCwd);
            }

            // Get output and parse JSON
            // When --json is used, only JSON should be output, but filter out any non-JSON lines just in case
            const output = consoleOutput.join('\n');
            // Find the JSON portion - look for first { and last }
            const firstBrace = output.indexOf('{');
            const lastBrace = output.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
              throw new Error(`No valid JSON found in output: ${output.substring(0, 200)}`);
            }
            const jsonText = output.substring(firstBrace, lastBrace + 1);
            const jsonOutput = JSON.parse(jsonText);

            // Normalize non-deterministic values (timing) for snapshot
            const normalized = {
              ...jsonOutput,
              timings: {
                total: expect.any(Number),
              },
            };

            // Verify structure
            expect(normalized.ok).toBe(true);
            expect(normalized.summary).toBeDefined();
            expect(normalized.contract.coreHash).toBeDefined();
            expect(normalized.marker.created).toBe(true);
            expect(normalized.marker.updated).toBe(false);

            // Snapshot test for JSON output
            expect(normalized).toMatchSnapshot();
          } finally {
            cleanupDir();
          }
        },
        { acceleratePort: 54270, databasePort: 54271, shadowDatabasePort: 54272 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
