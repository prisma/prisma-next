import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prismaContract } from '../src/provider';

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

  describe('given a valid schema', () => {
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

      expect(result.value).toMatchObject({
        targetFamily: 'sql',
        target: 'postgres',
        storage: {
          tables: {
            user: expect.any(Object),
          },
        },
      });
    });
  });

  describe('given unsupported constructs in schema', () => {
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
  });

  describe('given a missing schema file', () => {
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
});
