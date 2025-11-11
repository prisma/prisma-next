import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmitCommand } from '../src/commands/emit';

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
    // Create config file
    writeFileSync(
      configPath,
      `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
});
`,
      'utf-8',
    );

    const command = createEmitCommand();
    const program = new Command();
    program.addCommand(command);

    await program.parseAsync([
      'node',
      'emit',
      '--contract',
      contractPath,
      '--out',
      outputDir,
      '--config',
      configPath,
    ]);

    expect(existsSync(join(outputDir, 'contract.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'contract.d.ts'))).toBe(true);
  });

  it('emits contract with default config path', async () => {
    // Create config file at default location
    writeFileSync(
      configPath,
      `import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
});
`,
      'utf-8',
    );

    const command = createEmitCommand();
    const program = new Command();
    program.addCommand(command);

    // Change to testDir so default config path resolves
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      await program.parseAsync(['node', 'emit', '--contract', 'contract.ts', '--out', 'output']);
      expect(existsSync(join(testDir, 'output', 'contract.json'))).toBe(true);
      expect(existsSync(join(testDir, 'output', 'contract.d.ts'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('throws error when config file is missing', async () => {
    const command = createEmitCommand();
    const program = new Command();
    program.addCommand(command);

    await expect(
      program.parseAsync([
        'node',
        'emit',
        '--contract',
        contractPath,
        '--out',
        outputDir,
        '--config',
        join(testDir, 'nonexistent.config.ts'),
      ]),
    ).rejects.toThrow();
  });
});
