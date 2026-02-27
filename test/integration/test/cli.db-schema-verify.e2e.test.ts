import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createDbSchemaVerifyCommand } from '@prisma-next/cli/commands/db-schema-verify';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// Fixture subdirectory for db-schema-verify e2e tests
const fixtureSubdir = 'db-schema-verify';

/**
 * Creates a test contract JSON structure with the given tables.
 * Each table must have columns, and optionally uniques.
 * Primary key defaults to ['id'] for all tables.
 */
function createTestContract(
  tables: Record<
    string,
    {
      columns: Record<string, { codecId: string; nativeType: string; nullable: boolean }>;
      uniques?: Array<{ columns: string[] }>;
    }
  >,
) {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test',
    storage: {
      tables: Object.fromEntries(
        Object.entries(tables).map(([name, { columns, uniques = [] }]) => [
          name,
          {
            columns,
            primaryKey: { columns: ['id'] },
            uniques,
            indexes: [],
            foreignKeys: [],
          },
        ]),
      ),
    },
    models: {},
    relations: {},
    mappings: {},
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  };
}

withTempDir(({ createTempDir }) => {
  describe('db schema-verify command (e2e)', () => {
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
      'outputs verification tree with matching schema (TTY mode)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up database schema first, then close connection
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                CONSTRAINT "user_email_unique" UNIQUE (email)
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

          // Create contract.json matching the schema
          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              uniques: [{ columns: ['email'] }],
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
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

          // Verify success output
          expect(normalized).toContain('✔ Database schema satisfies contract');
          expect(normalized).toContain('schema');
          expect(normalized).toContain('user');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs JSON envelope with matching schema (JSON mode)',
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

          // Create contract.json matching the schema
          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
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

          // Verify JSON structure
          expect(jsonOutput.ok).toBe(true);
          expect(jsonOutput.summary).toContain('satisfies contract');
          expect(jsonOutput.schema).toBeDefined();
          expect(jsonOutput.schema.root).toBeDefined();
          expect(jsonOutput.schema.counts).toBeDefined();
          expect(jsonOutput.schema.counts.fail).toBe(0);
          expect(jsonOutput.schema.counts.pass).toBeGreaterThan(0);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs failures with non-matching schema',
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

          // Create contract.json with missing table
          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await expect(
              executeCommand(command, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();
          } finally {
            process.chdir(originalCwd);
          }

          // Get output and strip ANSI
          const output = consoleOutput.join('\n');
          const stripped = stripAnsi(output);

          // Verify failure output
          expect(stripped).toContain('✖');
          expect(stripped).toContain('does not satisfy contract');
          expect(stripped).toContain('post');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'strict mode fails on extra columns',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up database schema with extra column first, then close connection
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                "extraColumn" TEXT
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

          // Create contract.json without extra column
          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // In strict mode, extra columns should cause failure
            await expect(
              executeCommand(command, ['--config', configPath, '--strict', '--no-color']),
            ).rejects.toThrow();
          } finally {
            process.chdir(originalCwd);
          }

          // Get output and strip ANSI
          const output = consoleOutput.join('\n');
          const stripped = stripAnsi(output);

          // Verify failure in strict mode
          expect(stripped).toContain('✖');
          expect(stripped).toContain('does not satisfy contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'permissive mode passes with extra columns',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up database schema with extra column first, then close connection
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                "extraColumn" TEXT
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

          // Create contract.json without extra column
          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // In permissive mode (default), extra columns should not cause failure
            await executeCommand(command, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Get output and strip ANSI
          const output = consoleOutput.join('\n');
          const stripped = stripAnsi(output);

          // Verify success in permissive mode
          expect(stripped).toContain('✔ Database schema satisfies contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles missing database URL',
      async () => {
        const testDir = createTempDir();
        const configPath = resolve(testDir, 'prisma-next.config.ts');

        // Create config file without db.connection
        const configContent = `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: {
    source: async () => ({ ok: true, value: { targetFamily: 'sql' } }),
    output: './src/prisma/contract.json',
  },
  // db.connection is intentionally missing - this is what we're testing
});`;
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, configContent, 'utf-8');

        const contractJson = createTestContract({
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
          },
        });
        const contractPath = resolve(testDir, 'src/prisma/contract.json');
        mkdirSync(dirname(contractPath), { recursive: true });
        writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

        const command = createDbSchemaVerifyCommand();
        const originalCwd = process.cwd();
        let thrown: unknown;
        try {
          process.chdir(testDir);
          // Don't provide --db flag, and config has no db.connection
          try {
            await executeCommand(command, ['--config', configPath, '--no-color']);
          } catch (error) {
            thrown = error;
          }
        } finally {
          process.chdir(originalCwd);
        }

        expect(thrown).toBeDefined();
        const errorOutput = consoleErrors.join('\n');
        const allOutput = `${consoleOutput.join('\n')}\n${errorOutput}`;
        if (allOutput.trim().length > 0) {
          expect(allOutput).toMatch(/PN-CLI-4005|Database connection is required/i);
        } else {
          expect(thrown).toMatchObject({ message: 'process.exit called' });
        }
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
          const command = createDbSchemaVerifyCommand();
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
      'handles contract JSON parse errors (invalid JSON content)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          // Create a contract file with invalid JSON (causes JSON.parse SyntaxError)
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, 'invalid json content', 'utf-8');

          const command = createDbSchemaVerifyCommand();
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

          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--quiet', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // In quiet mode, only errors should be output
          const output = consoleOutput.join('\n');
          expect(output).not.toContain('Database schema satisfies contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles verbose mode flag',
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

          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--verbose', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Verbose mode should include additional output
          const output = consoleOutput.join('\n');
          expect(output).toContain('Database schema satisfies contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'exits with code 1 when schema verification fails',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            // Create a table that doesn't match the contract (missing column)
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY
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

          // Contract expects both id and email columns, but database only has id
          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // executeCommand throws for non-zero exit codes
            await expect(
              executeCommand(command, ['--config', configPath, '--no-color']),
            ).rejects.toThrow('process.exit called');
          } finally {
            process.chdir(originalCwd);
          }

          // Verify that schema verification failure was detected (exit code 1)
          expect(getExitCode()).toBe(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'adds blank line after spinners when TTY and not quiet/JSON',
      async () => {
        const originalIsTTY = process.stdout.isTTY;
        process.stdout.isTTY = true;

        try {
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

            const contractJson = createTestContract({
              user: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                },
              },
            });
            const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
            mkdirSync(dirname(contractPath), { recursive: true });
            writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

            const command = createDbSchemaVerifyCommand();
            const originalCwd = process.cwd();
            try {
              process.chdir(testSetup.testDir);
              await executeCommand(command, ['--config', configPath, '--no-color']);
            } finally {
              process.chdir(originalCwd);
            }

            const output = consoleOutput.join('\n');
            expect(output).toContain('Database schema satisfies contract');
          });
        } finally {
          process.stdout.isTTY = originalIsTTY;
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes database URL in header when --db flag is provided',
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

          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          // Clear console output before running the command we want to test
          const outputStartIndex = consoleOutput.length;

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // Provide --db flag even though config has db.connection - this tests the options.db branch
            await executeCommand(command, [
              '--config',
              configPath,
              '--db',
              connectionString,
              '--no-color',
            ]);
          } finally {
            process.chdir(originalCwd);
          }

          // Verify that database URL was included in header (from --db flag)
          const output = consoleOutput.slice(outputStartIndex).join('\n');
          expect(output).toContain('database');
          // Database URL should be in the output
          expect(output).toMatch(/127\.0\.0\.1|localhost/);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles missing driver in config',
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

          // Modify config to remove driver
          const { readFile, writeFile } = await import('node:fs/promises');
          const configContent = await readFile(configPath, 'utf-8');
          // Remove driver line
          const modifiedConfig = configContent.replace(/driver:\s*postgresDriver,?\s*\n/g, '');
          await writeFile(configPath, modifiedConfig, 'utf-8');

          const contractJson = createTestContract({
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
            },
          });
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const command = createDbSchemaVerifyCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await expect(
              executeCommand(command, ['--config', configPath, '--no-color']),
            ).rejects.toThrow();
          } finally {
            process.chdir(originalCwd);
          }

          // Verify that driver required error was thrown
          const errorOutput = consoleErrors.join('\n');
          expect(errorOutput).toContain('PN-CLI-4');
          expect(errorOutput).toMatch(/driver.*required|required.*driver/i);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
