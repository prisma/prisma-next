import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDbIntrospectCommand } from '../src/commands/db-introspect';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for db-introspect e2e tests
const fixtureSubdir = 'db-introspect';

describe('db introspect command (e2e)', () => {
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
    'outputs tree structure with real database',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        // Set up database schema first, then close connection
        await withClient(connectionString, async (client) => {
          await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                name TEXT
              )
            `);
          await client.query(`
              CREATE TABLE IF NOT EXISTS "post" (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                "userId" INTEGER REFERENCES "user"(id)
              )
            `);
          await client.query(`
              CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user"(email)
            `);
        });

        // Set up test directory with config
        const testSetup = setupTestDirectoryFromFixtures(
          fixtureSubdir,
          'prisma-next.config.with-db.ts',
          { '{{DB_URL}}': connectionString },
        );
        const configPath = testSetup.configPath;
        const cleanupDir = testSetup.cleanup;
        cleanupDirs.push(cleanupDir); // Track for afterEach cleanup

        try {
          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
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

          // Snapshot test for tree output
          expect(normalized).toMatchSnapshot();
        } finally {
          cleanupDir();
        }
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

        // Set up test directory with config
        const testSetup = setupTestDirectoryFromFixtures(
          fixtureSubdir,
          'prisma-next.config.with-db.ts',
          { '{{DB_URL}}': connectionString },
        );
        const configPath = testSetup.configPath;
        const cleanupDir = testSetup.cleanup;
        cleanupDirs.push(cleanupDir); // Track for afterEach cleanup

        try {
          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--json', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Get output and parse JSON
          const output = consoleOutput.join('\n');
          const jsonOutput = JSON.parse(output);

          // Normalize non-deterministic values (dbUrl and timing) for snapshot
          const normalized = {
            ...jsonOutput,
            meta: {
              ...jsonOutput.meta,
              dbUrl: jsonOutput.meta?.dbUrl
                ? jsonOutput.meta.dbUrl.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:XXXXX')
                : jsonOutput.meta?.dbUrl,
            },
            timings: {
              ...jsonOutput.timings,
              total: 0, // Normalize timing to 0 for snapshot
            },
          };

          // Snapshot test for JSON output
          expect(normalized).toMatchSnapshot();
        } finally {
          cleanupDir();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
