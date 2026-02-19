import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createDbInitCommand } from '@prisma-next/cli/commands/db-init';
import { createDbIntrospectCommand } from '@prisma-next/cli/commands/db-introspect';
import { createDbSchemaVerifyCommand } from '@prisma-next/cli/commands/db-schema-verify';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeCommand,
  getExitCode,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

const fixtureSubdir = 'prisma-schema';

withTempDir(({ createTempDir }) => {
  describe('.prisma schema workflow (e2e)', () => {
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

    it(
      'emits contract artifacts from config.contract.source .prisma path',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          fixtureSubdir,
          'prisma-next.config.ts',
          { '{{DB_URL}}': 'postgresql://postgres:postgres@localhost:5432/postgres' },
        );

        const emitCommand = createContractEmitCommand();
        const originalCwd = process.cwd();
        try {
          process.chdir(testSetup.testDir);
          await executeCommand(emitCommand, [
            '--config',
            testSetup.configPath,
            '--json',
            '--no-color',
          ]);
        } finally {
          process.chdir(originalCwd);
        }

        expect(getExitCode()).toBe(0);
        expect(consoleErrors.join('\n')).toBe('');

        const outputJsonPath = join(testSetup.outputDir, 'contract.json');
        const outputDtsPath = join(testSetup.outputDir, 'contract.d.ts');
        expect(existsSync(outputJsonPath)).toBe(true);
        expect(existsSync(outputDtsPath)).toBe(true);

        const contract = JSON.parse(readFileSync(outputJsonPath, 'utf8')) as {
          readonly meta?: {
            readonly prismaPsl?: {
              readonly provider?: string;
              readonly missingFeatures?: string[];
            };
          };
          readonly storage?: {
            readonly tables?: Record<string, unknown>;
          };
          readonly execution?: {
            readonly mutations?: {
              readonly defaults?: unknown[];
            };
          };
        };

        expect(contract.meta?.prismaPsl?.provider).toBe('postgresql');
        expect(contract.storage?.tables).toMatchObject({
          User: expect.anything(),
          Profile: expect.anything(),
          Post: expect.anything(),
        });
        expect(contract.execution?.mutations?.defaults?.length).toBeGreaterThan(0);
        expect(contract.meta?.prismaPsl?.missingFeatures).toEqual(
          expect.arrayContaining([
            expect.stringContaining('referential actions'),
            expect.stringContaining('Index options'),
          ]),
        );
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'db init applies emitted .prisma contract to an empty database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );

          const emitCommand = createContractEmitCommand();
          const initCommand = createDbInitCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, [
              '--config',
              testSetup.configPath,
              '--json',
              '--no-color',
            ]);
            consoleOutput.length = 0;
            consoleErrors.length = 0;
            try {
              await executeCommand(initCommand, [
                '--config',
                testSetup.configPath,
                '--json',
                '--no-color',
              ]);
            } catch (error) {
              throw new Error(
                `db init failed\nstdout:\n${consoleOutput.join('\n')}\nstderr:\n${consoleErrors.join('\n')}`,
                { cause: error },
              );
            }
          } finally {
            process.chdir(originalCwd);
          }

          expect(getExitCode()).toBe(0);
          const output = consoleOutput.join('\n');
          const parsed = JSON.parse(output) as {
            readonly ok?: boolean;
            readonly mode?: string;
            readonly plan?: { readonly operations?: readonly unknown[] };
            readonly execution?: {
              readonly operationsPlanned?: number;
              readonly operationsExecuted?: number;
            };
          };
          expect(parsed.ok).toBe(true);
          expect(parsed.mode).toBe('apply');
          expect(parsed.plan?.operations?.length).toBeGreaterThan(0);
          expect(parsed.execution?.operationsExecuted).toBeGreaterThan(0);

          await withClient(connectionString, async (client) => {
            const tables = await client.query<{
              readonly table_name: string;
            }>(
              `
                select table_name
                from information_schema.tables
                where table_schema = 'public'
                  and table_name in ('User', 'Profile', 'Post')
                order by table_name
              `,
            );

            expect(tables.rows.map((row) => row.table_name)).toEqual(['Post', 'Profile', 'User']);

            const profileFk = await client.query<{
              readonly conname: string;
            }>(
              `
                select conname
                from pg_constraint
                where contype = 'f'
                  and conrelid = '"Profile"'::regclass
                  and confrelid = '"User"'::regclass
              `,
            );

            expect(profileFk.rows).toHaveLength(1);

            const postFk = await client.query<{
              readonly conname: string;
            }>(
              `
                select conname
                from pg_constraint
                where contype = 'f'
                  and conrelid = '"Post"'::regclass
                  and confrelid = '"User"'::regclass
              `,
            );

            expect(postFk.rows).toHaveLength(1);

            const compositeIndex = await client.query<{
              readonly indexname: string;
              readonly indexdef: string;
            }>(
              `
                select indexname, indexdef
                from pg_indexes
                where schemaname = 'public'
                  and tablename = 'Post'
                  and indexname = 'Post_authorId_createdAt_idx'
              `,
            );

            expect(compositeIndex.rows).toHaveLength(1);
            expect(compositeIndex.rows[0]?.indexdef).toContain('"authorId"');
            expect(compositeIndex.rows[0]?.indexdef).toContain('"createdAt"');

            const enumType = await client.query<{
              readonly typname: string;
            }>(
              `
                select typname
                from pg_type
                where typname = 'UserRole'
              `,
            );
            expect(enumType.rows).toHaveLength(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db schema-verify and db introspect work after db init',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );

          const emitCommand = createContractEmitCommand();
          const initCommand = createDbInitCommand();
          const schemaVerifyCommand = createDbSchemaVerifyCommand();
          const introspectCommand = createDbIntrospectCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            await executeCommand(emitCommand, ['--config', testSetup.configPath, '--no-color']);
            await executeCommand(initCommand, ['--config', testSetup.configPath, '--no-color']);
            consoleOutput.length = 0;
            consoleErrors.length = 0;
            await executeCommand(schemaVerifyCommand, [
              '--config',
              testSetup.configPath,
              '--json',
              '--no-color',
            ]);

            const verifyJson = JSON.parse(consoleOutput.join('\n')) as {
              readonly ok?: boolean;
              readonly summary?: string;
              readonly schema?: { readonly counts?: { readonly fail?: number } };
            };
            expect(verifyJson.ok).toBe(true);
            expect(verifyJson.summary).toContain('satisfies contract');
            expect(verifyJson.schema?.counts?.fail).toBe(0);

            consoleOutput.length = 0;
            consoleErrors.length = 0;
            await executeCommand(introspectCommand, [
              '--config',
              testSetup.configPath,
              '--json',
              '--no-color',
            ]);
          } finally {
            process.chdir(originalCwd);
          }

          expect(getExitCode()).toBe(0);
          expect(consoleErrors.join('\n')).toBe('');
          const introspectJson = JSON.parse(consoleOutput.join('\n')) as {
            readonly ok?: boolean;
            readonly schema?: {
              readonly tables?: Record<
                string,
                {
                  readonly columns?: Record<string, unknown>;
                }
              >;
            };
          };

          expect(introspectJson.ok).toBe(true);
          const tables = introspectJson.schema?.tables ?? {};
          const tableNames = Object.keys(tables).map((name) => name.toLowerCase());
          expect(tableNames).toEqual(expect.arrayContaining(['user', 'profile', 'post']));

          const postTableName = Object.keys(tables).find((name) => name.toLowerCase() === 'post');
          const postColumns = postTableName ? tables[postTableName]?.columns : undefined;
          const postColumnNames = postColumns
            ? Object.keys(postColumns).map((name) => name.toLowerCase())
            : [];
          expect(postColumnNames).toEqual(expect.arrayContaining(['authorid', 'createdat']));
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
