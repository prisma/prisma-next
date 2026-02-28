import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContractIR } from '../src/interpreter';

describe('interpretPslDocumentToSqlContractIR', () => {
  it('builds sql contract ir from simple psl schema', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  email String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.targetFamily).toBe('sql');
    expect(result.value.target).toBe('postgres');
    expect(result.value.storage).toMatchObject({
      tables: {
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4' },
            email: { codecId: 'pg/text@1', nativeType: 'text' },
          },
          primaryKey: { columns: ['id'] },
        },
      },
    });
    expect(result.value.models).toMatchObject({
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
    });
  });

  it('returns diagnostics for unsupported list fields', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  tags String[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics[0]?.code).toBe('PSL_UNSUPPORTED_FIELD_LIST');
  });

  it('preserves parser diagnostics with source spans', () => {
    const document = parsePslDocument({
      schema: `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 1, column: 1 }),
            end: expect.objectContaining({ line: 1 }),
          }),
        }),
      ]),
    );
  });
});
