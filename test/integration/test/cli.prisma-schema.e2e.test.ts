import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { createDbPullCommand } from '@prisma-next/cli/commands/db-pull';
import { createDbPushCommand } from '@prisma-next/cli/commands/db-push';
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
      'db push creates the same core relational structure expected by the Prisma schema',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );

          const pushCommand = createDbPushCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            try {
              await executeCommand(pushCommand, [
                '--config',
                testSetup.configPath,
                '--json',
                '--no-color',
              ]);
            } catch (error) {
              throw new Error(
                `db push failed\nstdout:\n${consoleOutput.join('\n')}\nstderr:\n${consoleErrors.join('\n')}`,
                { cause: error },
              );
            }
          } finally {
            process.chdir(originalCwd);
          }

          expect(getExitCode()).toBe(0);
          const output = consoleOutput.join('\n');
          const parsed = JSON.parse(output) as { readonly summary?: string };
          expect(parsed.summary).toContain('Database schema synchronized');

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
              readonly confdeltype: string;
            }>(
              `
                select confdeltype
                from pg_constraint
                where contype = 'f'
                  and conrelid = '"Profile"'::regclass
                  and confrelid = '"User"'::regclass
              `,
            );

            expect(profileFk.rows).toHaveLength(1);
            expect(profileFk.rows[0]?.confdeltype).toBe('c');

            const postFk = await client.query<{
              readonly confdeltype: string;
              readonly confupdtype: string;
            }>(
              `
                select confdeltype, confupdtype
                from pg_constraint
                where contype = 'f'
                  and conrelid = '"Post"'::regclass
                  and confrelid = '"User"'::regclass
              `,
            );

            expect(postFk.rows).toHaveLength(1);
            expect(postFk.rows[0]?.confdeltype).toBe('c');
            expect(postFk.rows[0]?.confupdtype).toBe('r');

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
            expect(compositeIndex.rows[0]?.indexdef).toContain('"createdAt" DESC');
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db pull prints Prisma-formatted schema after push',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma-next.config.ts',
            { '{{DB_URL}}': connectionString },
          );

          const pushCommand = createDbPushCommand();
          const pullCommand = createDbPullCommand();
          const originalCwd = process.cwd();
          try {
            process.chdir(testSetup.testDir);
            try {
              await executeCommand(pushCommand, ['--config', testSetup.configPath, '--no-color']);
            } catch (error) {
              throw new Error(
                `db push before pull failed\nstdout:\n${consoleOutput.join('\n')}\nstderr:\n${consoleErrors.join('\n')}`,
                { cause: error },
              );
            }
            consoleOutput.length = 0;
            consoleErrors.length = 0;
            await executeCommand(pullCommand, ['--config', testSetup.configPath, '--no-color']);
          } finally {
            process.chdir(originalCwd);
          }

          expect(getExitCode()).toBe(0);
          expect(consoleErrors.join('\n')).toBe('');
          const pulledSchema = consoleOutput.join('\n');

          expect(pulledSchema).toContain('datasource db {');
          expect(pulledSchema).toContain('model User {');
          expect(pulledSchema).toContain('model Profile {');
          expect(pulledSchema).toContain('model Post {');
          expect(pulledSchema).toContain('enum UserRole {');
          expect(pulledSchema).toContain('@@index([authorId, createdAt(sort: Desc)])');
          expect(pulledSchema).toContain(
            '@relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
          );
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
