import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { prismaContract } from '../src/exports/provider';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const emptyContext: ContractSourceContext = { composedExtensionPacks: [] };

describe('prismaContract provider helper', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];
  const baseOptions = {
    target: postgresTarget,
    scalarTypeDescriptors: postgresScalarTypeDescriptors,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  } as const;

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
      const contract = prismaContract('./schema.prisma', {
        ...baseOptions,
        output: 'output/contract.json',
      });

      expect(contract.output).toBe('output/contract.json');
      const result = await contract.source(emptyContext);
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

    it('interprets relation backrelation lists and emits relation metadata', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source(emptyContext);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.relations).toMatchObject({
        user: {
          posts: {
            cardinality: '1:N',
            on: {
              parentCols: ['id'],
              childCols: ['userId'],
            },
          },
        },
        post: {
          user: {
            cardinality: 'N:1',
            on: {
              parentCols: ['userId'],
              childCols: ['id'],
            },
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
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source(emptyContext);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_LIST',
            sourceId: './schema.prisma',
            message: expect.stringContaining('scalar/storage list type'),
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });

    it('returns diagnostics when navigation list fields declare unsupported attributes', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  posts Post[] @unique
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source(emptyContext);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
            sourceId: './schema.prisma',
            message: expect.stringContaining('User.posts'),
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
      const contract = prismaContract('./schema.prisma', baseOptions);
      const result = await contract.source(emptyContext);

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
        ...baseOptions,
        composedExtensionPacks: ['pgvector'],
      });
      const result = await contract.source({ composedExtensionPacks: [] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = result.value.storage as unknown as {
        readonly tables: Record<string, { readonly columns: Record<string, unknown> }>;
        readonly types?: Record<string, unknown>;
      };

      expect(storage.types).toMatchObject({
        Embedding1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      });
      expect(storage.tables).toMatchObject({
        document: {
          columns: {
            embedding: {
              codecId: 'pg/vector@1',
              nativeType: 'vector',
              typeParams: { length: 1536 },
            },
          },
        },
      });
      expect(storage.tables['document']!.columns['embedding']).not.toHaveProperty('typeRef');
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
  cuid2 String @default(cuid(2))
  uuidV7 String @default(uuid(7))
  nanoid16 String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', {
        ...baseOptions,
      });
      const result = await contract.source(emptyContext);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.execution).toMatchObject({
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'cuid2' },
              onCreate: { kind: 'generator', id: 'cuid2' },
            },
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
      expect(result.value.storage).toMatchObject({
        tables: {
          user: {
            columns: {
              dbExpr: {
                default: {
                  kind: 'function',
                  expression: 'gen_random_uuid()',
                },
              },
            },
          },
        },
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
      const contract = prismaContract('./schema.prisma', {
        ...baseOptions,
      });
      const result = await contract.source(emptyContext);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
            sourceId: './schema.prisma',
            message: expect.stringContaining('cuid(2)'),
            span: expect.objectContaining({
              start: expect.objectContaining({ line: 3 }),
            }),
          }),
        ]),
      );
    });
  });

  describe('given provider inputs without assembled mutation defaults', () => {
    it('does not assemble mutation default handlers internally', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-'));
      tempDirs.push(tempDir);
      const schemaPath = join(tempDir, 'schema.prisma');
      await writeFile(
        schemaPath,
        `model User {
  id Int @id
  externalId String @default(uuid())
}
`,
        'utf-8',
      );

      process.chdir(tempDir);
      const contract = prismaContract('./schema.prisma', {
        target: postgresTarget,
        scalarTypeDescriptors: postgresScalarTypeDescriptors,
      });
      const result = await contract.source();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
            message: expect.stringContaining('uuid'),
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
      const contract = prismaContract('./missing.prisma', baseOptions);
      const result = await contract.source(emptyContext);

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
