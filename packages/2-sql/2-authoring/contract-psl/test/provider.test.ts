import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prismaContract } from '../src/exports/provider';

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

  describe('given namespaced extension attributes in schema', () => {
    it('returns diagnostics when extension namespace is unrecognized', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
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
            code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
            sourceId: './schema.prisma',
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });

    it('interprets namespaced extension attributes when extension is composed', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', {
        composedExtensionPacks: ['pgvector'],
      });
      const result = await contract.source();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const types = (result.value.storage as Record<string, unknown>)['types'];
      expect(types).toMatchObject({
        Embedding1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector(1536)',
          typeParams: { length: 1536 },
        },
      });
    });
  });

  describe('given supported default functions in schema', () => {
    it('maps function defaults to execution or storage defaults', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  uuidV7 String @default(uuid(7))
  nanoid16 String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma');
      const result = await contract.source();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.execution).toMatchObject({
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'nanoid16' },
              onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
            },
            {
              ref: { table: 'user', column: 'uuidV7' },
              onCreate: { kind: 'generator', id: 'uuidv7' },
            },
          ],
        },
      });
      expect(result.value.storage.tables.user.columns.dbExpr.default).toEqual({
        kind: 'function',
        expression: 'gen_random_uuid()',
      });
    });
  });

  describe('given unsupported default functions', () => {
    it('returns actionable default function diagnostics with spans', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  cuidValue String @default(cuid())
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
            code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
            sourceId: './schema.prisma',
            message: expect.stringContaining('uuid()'),
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
