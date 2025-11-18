import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDbIntrospectCommand } from '../src/commands/db-introspect';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// Fixture subdirectory for db-introspect e2e tests
const fixtureSubdir = 'db-introspect';

describe('db introspect command (e2e)', () => {
  let consoleOutput: string[] = [];
  let _consoleErrors: string[] = [];
  let cleanupMocks: () => void;

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    consoleOutput = mocks.consoleOutput;
    _consoleErrors = mocks.consoleErrors;
    cleanupMocks = mocks.cleanup;
  });

  afterEach(() => {
    cleanupMocks();
  });

  it(
    'outputs tree structure with real database',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Set up database schema
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

            // Set up test directory with config
            const testSetup = setupTestDirectoryFromFixtures(
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );
            const configPath = testSetup.configPath;
            const cleanupDir = testSetup.cleanup;

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

              // Snapshot test for tree output
              expect(stripped).toMatchSnapshot();
            } finally {
              cleanupDir();
            }
          });
        },
        { acceleratePort: 54040, databasePort: 54041, shadowDatabasePort: 54042 },
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'outputs JSON envelope with real database',
    async () => {
      await withDevDatabase(
        async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Set up database schema
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL
              )
            `);

            // Set up test directory with config
            const testSetup = setupTestDirectoryFromFixtures(
              fixtureSubdir,
              'prisma-next.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );
            const configPath = testSetup.configPath;
            const cleanupDir = testSetup.cleanup;

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

              // Snapshot test for JSON output
              expect(jsonOutput).toMatchSnapshot();
            } finally {
              cleanupDir();
            }
          });
        },
        { acceleratePort: 54043, databasePort: 54044, shadowDatabasePort: 54045 },
      );
    },
    timeouts.spinUpPpgDev,
  );
});
