import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readFile, existsSync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadContractFromTs } from '@prisma-next/cli';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { targetFamilyRegistry } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);

beforeAll(() => {
  if (!targetFamilyRegistry.has('sql')) {
    targetFamilyRegistry.register(sqlTargetFamilyHook);
  }
});

describe('CLI emit command', () => {
  let testDir: string;
  let contractPath: string;
  let outputDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `prisma-next-cli-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    contractPath = join(testDir, 'contract.ts');
    outputDir = join(testDir, 'output');

    const contractContent = `import { defineContract } from '@prisma-next/sql-query/contract-builder';
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
`;

    await writeFile(contractPath, contractContent, 'utf-8');
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('executes CLI to emit contract and verifies artifacts', async () => {
    const cliPath = resolve('packages/cli/dist/cli.js');
    const adapterPath = resolve('packages/adapter-postgres');

    try {
      await execFileAsync('node', [
        cliPath,
        'emit',
        '--contract',
        contractPath,
        '--out',
        outputDir,
        '--adapter',
        adapterPath,
      ]);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'stderr' in error) {
        console.error('CLI stderr:', error.stderr);
      }
      if (error && typeof error === 'object' && 'stdout' in error) {
        console.log('CLI stdout:', error.stdout);
      }
      throw error;
    }

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractDtsPath = join(outputDir, 'contract.d.ts');

    expect(existsSync(contractJsonPath)).toBe(true);
    expect(existsSync(contractDtsPath)).toBe(true);

    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractDtsContent = await readFile(contractDtsPath, 'utf-8');

    const contractJson = JSON.parse(contractJsonContent);
    expect(contractJson.targetFamily).toBe('sql');
    expect(contractJson.target).toBe('postgres');
    expect(contractJson.storage.tables.user).toBeDefined();

    expect(contractDtsContent).toContain('export type Contract');
    expect(contractDtsContent).toContain('CodecTypes');

    const validatedContract = validateContract<SqlContract<SqlStorage>>(contractJson);
    expect(validatedContract.targetFamily).toBe('sql');
    expect(validatedContract.target).toBe('postgres');
  });

  it('round-trip test: TS contract → CLI emit → parse JSON → compare with loaded TS contract', async () => {
    const adapterPath = resolve('packages/adapter-postgres');

    const originalContract = await loadContractFromTs(contractPath);

    const cliPath = resolve('packages/cli/dist/cli.js');

    try {
      await execFileAsync('node', [
        cliPath,
        'emit',
        '--contract',
        contractPath,
        '--out',
        outputDir,
        '--adapter',
        adapterPath,
      ]);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'stderr' in error) {
        console.error('CLI stderr:', error.stderr);
      }
      throw error;
    }

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);

    const validatedContract = validateContract<SqlContract<SqlStorage>>(contractJson);

    expect(validatedContract.targetFamily).toBe(originalContract.targetFamily);
    expect(validatedContract.target).toBe(originalContract.target);
    expect(validatedContract.storage.tables.user.columns.id.type).toBe(
      originalContract.storage?.tables?.user?.columns?.id?.type,
    );
    expect(validatedContract.storage.tables.user.columns.email.type).toBe(
      originalContract.storage?.tables?.user?.columns?.email?.type,
    );
  });
});

