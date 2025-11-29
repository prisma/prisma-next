import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDbSchemaVerifyCommand } from '../src/commands/db-schema-verify';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/test-helpers';

// Fixture subdirectory for db-schema-verify e2e tests
const fixtureSubdir = 'db-schema-verify';

withTempDir(({ createTempDir }) => {
  describe('db schema-verify command (e2e)', () => {
    let consoleOutput: string[] = [];
    let cleanupMocks: () => void;

    beforeEach(() => {
      // Set up console and process.exit mocks
      const mocks = setupCommandMocks();
      consoleOutput = mocks.consoleOutput;
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
          const contractJson = {
            schemaVersion: '1',
            target: 'postgres',
            targetFamily: 'sql',
            coreHash: 'sha256:test',
            storage: {
              tables: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [{ columns: ['email'] }],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
            models: {},
            relations: {},
            mappings: {},
            extensions: {},
            capabilities: {},
            meta: {},
            sources: {},
          };
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
          const contractJson = {
            schemaVersion: '1',
            target: 'postgres',
            targetFamily: 'sql',
            coreHash: 'sha256:test',
            storage: {
              tables: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
            models: {},
            relations: {},
            mappings: {},
            extensions: {},
            capabilities: {},
            meta: {},
            sources: {},
          };
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
          const contractJson = {
            schemaVersion: '1',
            target: 'postgres',
            targetFamily: 'sql',
            coreHash: 'sha256:test',
            storage: {
              tables: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
                post: {
                  columns: {
                    id: { type: 'pg/int4@1', nullable: false },
                    title: { type: 'pg/text@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
            models: {},
            relations: {},
            mappings: {},
            extensions: {},
            capabilities: {},
            meta: {},
            sources: {},
          };
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
          const contractJson = {
            schemaVersion: '1',
            target: 'postgres',
            targetFamily: 'sql',
            coreHash: 'sha256:test',
            storage: {
              tables: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
            models: {},
            relations: {},
            mappings: {},
            extensions: {},
            capabilities: {},
            meta: {},
            sources: {},
          };
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
          const contractJson = {
            schemaVersion: '1',
            target: 'postgres',
            targetFamily: 'sql',
            coreHash: 'sha256:test',
            storage: {
              tables: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                    email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
            models: {},
            relations: {},
            mappings: {},
            extensions: {},
            capabilities: {},
            meta: {},
            sources: {},
          };
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
  });
});
