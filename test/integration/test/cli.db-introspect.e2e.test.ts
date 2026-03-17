import { existsSync, readFileSync } from 'node:fs';
import { createDbIntrospectCommand } from '@prisma-next/cli/commands/db-introspect';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// Fixture subdirectory for db-introspect e2e tests
const fixtureSubdir = 'db-introspect';

/**
 * Returns only the stdout lines from consoleOutput by filtering out stderr decoration.
 * The test mock pushes stderr writes to both consoleErrors and consoleOutput,
 * so removing consoleErrors entries yields stdout-only content.
 */
function stdoutOnly(consoleOutput: string[], consoleErrors: string[]): string[] {
  const stderrBag = [...consoleErrors];
  return consoleOutput.filter((line) => {
    const idx = stderrBag.indexOf(line);
    if (idx !== -1) {
      stderrBag.splice(idx, 1);
      return false;
    }
    return true;
  });
}

/**
 * Normalizes non-deterministic parts of output for snapshot testing.
 */
function normalizeOutput(stripped: string): string {
  return stripped
    .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:XXXXX')
    .replace(/\(\d+ms\)/g, '(Xms)')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^[◒◐◓◑]/.test(trimmed)) return false;
      if (/^◇/.test(trimmed)) return false;
      if (trimmed === '│') return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

withTempDir(({ createTempDir }) => {
  describe('db introspect command (e2e)', () => {
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
      'default: writes PSL file to schema.prisma',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                name TEXT
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

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Verify the PSL file was written
          const pslPath = join(testSetup.testDir, 'schema.prisma');
          expect(existsSync(pslPath)).toBe(true);

          const pslContent = readFileSync(pslPath, 'utf-8');
          expect(pslContent).toContain('// This file was introspected from the database.');
          expect(pslContent).toContain('model User');
          expect(pslContent).toContain('@id');

          // Verify success message on stderr
          const stderrOutput = consoleErrors.join('\n');
          expect(stripAnsi(stderrOutput)).toContain('Schema written to');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--dry-run: outputs tree structure without writing file',
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
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--dry-run', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Verify no PSL file was written
          const pslPath = join(testSetup.testDir, 'schema.prisma');
          expect(existsSync(pslPath)).toBe(false);

          // Get output and strip ANSI for snapshot
          const output = consoleOutput.join('\n');
          const stripped = stripAnsi(output);
          const normalized = normalizeOutput(stripped);

          // Snapshot test for tree output
          expect(normalized).toMatchSnapshot();
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--output overrides the resolved path',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "item" (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL
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
          const customOutputPath = 'prisma/my-schema.prisma';

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, [
              '--config',
              configPath,
              '--output',
              customOutputPath,
              '--no-color',
            ]);
          } finally {
            process.chdir(originalCwd);
          }

          // Verify PSL file written at custom path
          const pslPath = join(testSetup.testDir, customOutputPath);
          expect(existsSync(pslPath)).toBe(true);

          const pslContent = readFileSync(pslPath, 'utf-8');
          expect(pslContent).toContain('model Item');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--json includes psl.path when file was written',
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

          // Set up test directory with config
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--json', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Get stdout-only output (exclude stderr decoration) and parse JSON
          const output = stdoutOnly(consoleOutput, consoleErrors).join('\n');
          const jsonOutput = JSON.parse(output);

          // Verify psl.path is present in JSON output
          expect(jsonOutput.psl).toBeDefined();
          expect(jsonOutput.psl.path).toBe('schema.prisma');

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
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--json --dry-run outputs raw SqlSchemaIR without writing',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "simple" (
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

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, [
              '--config',
              configPath,
              '--json',
              '--dry-run',
              '--no-color',
            ]);
          } finally {
            process.chdir(originalCwd);
          }

          // Verify no PSL file was written
          const pslPath = join(testSetup.testDir, 'schema.prisma');
          expect(existsSync(pslPath)).toBe(false);

          // Parse JSON output and verify no psl field
          const output = stdoutOnly(consoleOutput, consoleErrors).join('\n');
          const jsonOutput = JSON.parse(output);
          expect(jsonOutput.psl).toBeUndefined();
          expect(jsonOutput.schema).toBeDefined();
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'empty database produces valid header-only PSL file',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Don't create any tables — empty database
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const configPath = testSetup.configPath;

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(command, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          // Verify PSL file was written
          const pslPath = join(testSetup.testDir, 'schema.prisma');
          expect(existsSync(pslPath)).toBe(true);

          const pslContent = readFileSync(pslPath, 'utf-8');
          // Should have header comment but no models
          expect(pslContent).toContain('// This file was introspected from the database.');
          expect(pslContent).not.toContain('model');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'overwrite warning when target file exists',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "item" (
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

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // First write
            await executeCommand(command, ['--config', configPath, '--no-color']);
            // Reset mocks for second run
            consoleOutput.length = 0;
            consoleErrors.length = 0;
            // Second write — should show overwrite warning
            await executeCommand(command, ['--config', configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          const stderrOutput = consoleErrors.map((s) => stripAnsi(s)).join('\n');
          expect(stderrOutput).toContain('Overwriting existing file');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--quiet suppresses overwrite warning',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "item" (
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

          const command = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            // First write
            await executeCommand(command, ['--config', configPath, '--no-color']);
            // Reset mocks for second run
            consoleOutput.length = 0;
            consoleErrors.length = 0;
            // Second write with --quiet
            await executeCommand(command, ['--config', configPath, '--quiet', '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          const stderrOutput = consoleErrors.map((s) => stripAnsi(s)).join('\n');
          expect(stderrOutput).not.toContain('Overwriting existing file');
          expect(stderrOutput).not.toContain('Schema written to');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
