import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as interpreter from '../src/interpreter';
import { prismaContract } from '../src/provider';

vi.mock('../src/interpreter', async () => {
  const actual = await vi.importActual<typeof import('../src/interpreter')>('../src/interpreter');
  return {
    ...actual,
    interpretPslDocumentToSqlContractIR: vi.fn(actual.interpretPslDocumentToSqlContractIR),
  };
});

describe('prismaContract provider helper', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('returns contract config and emits SQL ContractIR from schema path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `model User {
  id Int @id
  email String
}
`,
      'utf-8',
    );

    process.chdir(tempDir);
    const contract = prismaContract('./schema.prisma', { output: 'output/contract.json' });

    expect(contract.output).toBe('output/contract.json');
    const result = await contract.source();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.targetFamily).toBe('sql');
    expect(result.value.target).toBe('postgres');
    expect(result.value.storage).toMatchObject({
      tables: {
        user: expect.any(Object),
      },
    });
  });

  it('returns unsupported construct diagnostics with source span context', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `model User {
  id Int @id
  tags String[]
}
`,
      'utf-8',
    );

    process.chdir(tempDir);
    const contract = prismaContract('./schema.prisma');
    const result = await contract.source();

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_LIST',
          sourceId: './schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
        }),
      ]),
    );
  });

  it('passes explicit target configuration to interpreter', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `model User {
  id Int @id
  email String
}
`,
      'utf-8',
    );
    const target: TargetPackRef<'sql', 'postgres'> = {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres-custom',
      version: '1.0.0-test',
      capabilities: { returning: true },
    };

    process.chdir(tempDir);
    const contract = prismaContract('./schema.prisma', { target });
    vi.mocked(interpreter.interpretPslDocumentToSqlContractIR).mockClear();
    const result = await contract.source();

    expect(contract.output).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(interpreter.interpretPslDocumentToSqlContractIR).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
      }),
    );
  });

  it('returns PSL_SCHEMA_READ_FAILED diagnostics when schema file is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
    tempDirs.push(tempDir);

    process.chdir(tempDir);
    const contract = prismaContract('./missing.prisma');
    const result = await contract.source();

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('Failed to read Prisma schema at "./missing.prisma"');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_SCHEMA_READ_FAILED',
          sourceId: './missing.prisma',
        }),
      ]),
    );
  });
});
