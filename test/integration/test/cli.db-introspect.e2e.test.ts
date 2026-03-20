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

const fixtureSubdir = 'db-introspect';

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
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
      consoleErrors = mocks.consoleErrors;
      cleanupMocks = mocks.cleanup;
    });

    afterEach(() => {
      cleanupMocks();
    });

    describe('default write', () => {
      it(
        'default: writes PSL file to output/schema.prisma',
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

            const pslPath = join(testSetup.testDir, 'output/schema.prisma');
            expect(existsSync(pslPath)).toBe(true);

            const pslContent = readFileSync(pslPath, 'utf-8');
            expect(pslContent).toContain('// This file was introspected from the database.');
            expect(pslContent).toContain('model User');
            expect(pslContent).toContain('@id');

            const stderrOutput = consoleErrors.join('\n');
            expect(stripAnsi(stderrOutput)).toContain('Schema written to');
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

            const pslPath = join(testSetup.testDir, customOutputPath);
            expect(existsSync(pslPath)).toBe(true);

            const pslContent = readFileSync(pslPath, 'utf-8');
            expect(pslContent).toContain('model Item');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'empty database produces valid header-only PSL file',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
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

            const pslPath = join(testSetup.testDir, 'output/schema.prisma');
            expect(existsSync(pslPath)).toBe(true);

            const pslContent = readFileSync(pslPath, 'utf-8');
            expect(pslContent).toContain('// This file was introspected from the database.');
            expect(pslContent).not.toContain('model');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('dry-run', () => {
      it(
        '--dry-run: outputs tree structure without writing file',
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

            const pslPath = join(testSetup.testDir, 'output/schema.prisma');
            expect(existsSync(pslPath)).toBe(false);

            const output = consoleOutput.join('\n');
            const stripped = stripAnsi(output);
            const normalized = normalizeOutput(stripped);
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

            const pslPath = join(testSetup.testDir, 'output/schema.prisma');
            expect(existsSync(pslPath)).toBe(false);

            const output = stdoutOnly(consoleOutput, consoleErrors).join('\n');
            const jsonOutput = JSON.parse(output);
            expect(jsonOutput).toMatchObject({
              schema: expect.any(Object),
            });
            expect(jsonOutput).toEqual(
              expect.not.objectContaining({
                psl: expect.anything(),
              }),
            );
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('json', () => {
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

            const output = stdoutOnly(consoleOutput, consoleErrors).join('\n');
            const jsonOutput = JSON.parse(output);
            expect(jsonOutput).toMatchObject({
              psl: { path: 'output/schema.prisma' },
            });

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
                total: 0,
              },
            };

            expect(normalized).toMatchSnapshot();
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('overwrite', () => {
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
              await executeCommand(command, ['--config', configPath, '--no-color']);
              consoleOutput.length = 0;
              consoleErrors.length = 0;
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
              await executeCommand(command, ['--config', configPath, '--no-color']);
              consoleOutput.length = 0;
              consoleErrors.length = 0;
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
});
