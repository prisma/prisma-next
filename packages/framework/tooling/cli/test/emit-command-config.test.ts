import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../../../');
const testWorkingDir = join(__dirname, 'emit-config-test-app');

function createConfigFileContent(): string {
  // Use absolute paths to dist files to avoid import resolution issues in temp directories
  const adapterPath = resolve(
    workspaceRoot,
    'packages/targets/postgres-adapter/dist/exports/cli.js',
  );
  const targetPath = resolve(workspaceRoot, 'packages/targets/sql/postgres/dist/exports/cli.js');
  const familyPath = resolve(workspaceRoot, 'packages/sql/tooling/cli/dist/exports/cli.js');
  const configTypesPath = resolve(
    workspaceRoot,
    'packages/framework/tooling/cli/dist/exports/config-types.js',
  );

  return `import { defineConfig } from '${configTypesPath}';
import postgresAdapter from '${adapterPath}';
import postgres from '${targetPath}';
import sql from '${familyPath}';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
});
`;
}

describe('emit command with config', () => {
  const contractPath = join(testWorkingDir, 'contract.ts');
  const outputDir = join(testWorkingDir, 'output');
  const configPath = join(testWorkingDir, 'prisma-next.config.ts');

  // Set up working directory with contract.ts before tests run
  beforeAll(() => {
    mkdirSync(testWorkingDir, { recursive: true });

    // Create contract.ts file
    writeFileSync(
      contractPath,
      `import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';

const contractObj = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();

export const contract = {
  ...contractObj,
  extensions: {
    postgres: {
      version: '15.0.0',
    },
    pg: {},
  },
};
`,
      'utf-8',
    );
  });

  afterEach(() => {
    // Clean up output directory and config file after each test
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
    }
  });

  afterAll(() => {
    // Clean up test working directory after all tests
    if (existsSync(testWorkingDir)) {
      rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  it(
    'emits contract with config file',
    async () => {
      // Create config file with absolute paths
      writeFileSync(configPath, createConfigFileContent(), 'utf-8');

      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testWorkingDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          'contract.ts',
          '--out',
          'output',
          '--config',
          'prisma-next.config.ts',
        ]);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {
          // Ignore if directory was cleaned up
        }
      }

      expect(existsSync(join(outputDir, 'contract.json'))).toBe(true);
      expect(existsSync(join(outputDir, 'contract.d.ts'))).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits contract with default config path',
    async () => {
      // Create config file at default location with absolute paths
      writeFileSync(configPath, createConfigFileContent(), 'utf-8');

      const command = createEmitCommand();
      const originalCwd = process.cwd();
      try {
        process.chdir(testWorkingDir);
        await command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          'contract.ts',
          '--out',
          'output',
        ]);
        expect(existsSync(join(testWorkingDir, 'output', 'contract.json'))).toBe(true);
        expect(existsSync(join(testWorkingDir, 'output', 'contract.d.ts'))).toBe(true);
      } finally {
        try {
          process.chdir(originalCwd);
        } catch {
          // Ignore if directory was cleaned up
        }
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('throws error when config file is missing', async () => {
    const command = createEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testWorkingDir);
      await expect(
        command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          'contract.ts',
          '--out',
          'output',
          '--config',
          'nonexistent.config.ts',
        ]),
      ).rejects.toThrow();
    } finally {
      try {
        process.chdir(originalCwd);
      } catch {
        // Ignore if directory was cleaned up
      }
    }
  });
});
