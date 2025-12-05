import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContractEmitCommand } from '../src/commands/contract-emit';
import { createDbSignCommand } from '../src/commands/db-sign';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/test-helpers';

// Fixture subdirectory for db-sign e2e tests
const fixtureSubdir = 'db-sign';

withTempDir(({ createTempDir }) => {
  describe('db sign command (e2e)', () => {
    let consoleOutput: string[] = [];
    let consoleErrors: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      // Set up console and process.exit mocks
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      consoleErrors = mocks.consoleErrors;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    it(
      'creates marker when schema matches contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
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
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

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

          // Normalize paths and database URL for snapshot
          let normalized = stripped;
          // Replace file paths
          normalized = normalized.replace(
            /\/(?:Users|home|tmp|var|opt|mnt|root|[A-Z]:\\?)[^\s\n]*/g,
            '<path>',
          );
          // Normalize database URL (port number)
          normalized = normalized.replace(/(127\.0\.0\.1|localhost):\d+/g, '127.0.0.1:XXXXX');

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
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'fails when schema does not match contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
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
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

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
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs JSON envelope with real database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
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
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Clear console output before running the command we want to test
          // (previous commands like 'contract emit' may have added output)
          const outputStartIndex = consoleOutput.length;

          const command = createDbSignCommand();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--json', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Get output and parse JSON (only from this command)
          const output = consoleOutput.slice(outputStartIndex).join('\n').trim();
          const jsonOutput = JSON.parse(output) as Record<string, unknown>;

          // Normalize non-deterministic values (timing, contractPath) for snapshot
          const meta = jsonOutput['meta'] as Record<string, unknown> | undefined;
          const normalized: Record<string, unknown> = {
            ...jsonOutput,
            meta: {
              ...meta,
              contractPath: meta?.['contractPath']
                ? String(meta['contractPath']).replace(/^.*\//, '<path>/')
                : meta?.['contractPath'],
            },
            timings: {
              total: expect.any(Number),
            },
          };

          // Verify structure
          expect(normalized).toMatchObject({
            ok: true,
            summary: expect.any(String),
            contract: {
              coreHash: expect.any(String),
            },
            marker: {
              created: true,
              updated: false,
            },
          });

          // Snapshot test for JSON output
          expect(normalized).toMatchSnapshot();
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles missing contract file (ENOENT error)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Don't create contract.json - it should be missing
          const command = createDbSignCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await expect(
              executeCommand(command, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();
          } finally {
            process.chdir(originalCwd);
          }

          // Verify error output (errors go to stderr/consoleErrors)
          const errorOutput = consoleErrors.join('\n');
          expect(errorOutput).toContain('PN-CLI-4');
          expect(errorOutput).toMatch(/file.*not found|not found.*file/i);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles contract file read errors (non-ENOENT)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Create a contract file with invalid JSON (causes parse error, not ENOENT)
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, 'invalid json content', 'utf-8');

          const command = createDbSignCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // JSON.parse throws SyntaxError, which is caught and wrapped as errorUnexpected
            // The command should exit with non-zero code or throw
            await expect(
              executeCommand(command, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();
          } finally {
            process.chdir(originalCwd);
          }

          // Verify error was handled (command failed)
          // The error path is covered even if we don't check the exact error message format
          // This tests the branch where file read succeeds but JSON.parse fails
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles quiet mode flag',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL
              )
            `);
          });

          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Emit contract first
          const emitCommand = createContractEmitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          const command = createDbSignCommand();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--quiet', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // In quiet mode, only errors should be output
          const output = consoleOutput.join('\n');
          expect(output).not.toContain('Database signed');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
