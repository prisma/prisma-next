import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../../');

function createConfigFileContent(): string {
  // Use absolute paths to dist files to avoid import resolution issues in temp directories
  const adapterPath = resolve(
    workspaceRoot,
    'packages/sql/runtime/adapters/postgres/dist/exports/cli.js',
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
  let testDir: string;
  let contractPath: string;
  let outputDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `prisma-next-emit-config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    contractPath = join(testDir, 'contract.ts');
    outputDir = join(testDir, 'output');
    configPath = join(testDir, 'prisma-next.config.ts');

    // Create a minimal contract file
    writeFileSync(
      contractPath,
      `import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('email', 'text', { nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();
`,
      'utf-8',
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('emits contract with config file', async () => {
    // Create config file with absolute paths
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');

    const command = createEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await command.parseAsync([
        'node',
        'cli.js',
        'emit',
        '--contract',
        contractPath,
        '--out',
        outputDir,
        '--config',
        configPath,
      ]);
    } finally {
      process.chdir(originalCwd);
    }

    expect(existsSync(join(outputDir, 'contract.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'contract.d.ts'))).toBe(true);
  });

  it('emits contract with default config path', async () => {
    // Create config file at default location with absolute paths
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');

    const command = createEmitCommand();
    // Change to testDir so default config path resolves
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await command.parseAsync([
        'node',
        'cli.js',
        'emit',
        '--contract',
        'contract.ts',
        '--out',
        'output',
      ]);
      expect(existsSync(join(testDir, 'output', 'contract.json'))).toBe(true);
      expect(existsSync(join(testDir, 'output', 'contract.d.ts'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('throws error when config file is missing', async () => {
    const command = createEmitCommand();
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await expect(
        command.parseAsync([
          'node',
          'cli.js',
          'emit',
          '--contract',
          contractPath,
          '--out',
          outputDir,
          '--config',
          join(testDir, 'nonexistent.config.ts'),
        ]),
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
