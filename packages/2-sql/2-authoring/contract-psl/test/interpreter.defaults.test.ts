import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContractIR } from '../src/interpreter';

describe('interpretPslDocumentToSqlContractIR default lowering', () => {
  it('lowers supported default functions into execution and storage contract shapes', () => {
    const document = parsePslDocument({
      schema: `model Defaults {
  id Int @id
  idCuid2 String @default(cuid(2))
  idUuidV4 String @default(uuid())
  idUuidV7 String @default(uuid(7))
  idUlid String @default(ulid())
  idNanoidDefault String @default(nanoid())
  idNanoidSized String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
  createdAt DateTime @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { table: 'defaults', column: 'idCuid2' },
            onCreate: { kind: 'generator', id: 'cuid2' },
          },
          {
            ref: { table: 'defaults', column: 'idNanoidDefault' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { table: 'defaults', column: 'idNanoidSized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
          {
            ref: { table: 'defaults', column: 'idUlid' },
            onCreate: { kind: 'generator', id: 'ulid' },
          },
          {
            ref: { table: 'defaults', column: 'idUuidV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { table: 'defaults', column: 'idUuidV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ],
      },
    });
    expect(result.value.storage).toMatchObject({
      tables: {
        defaults: {
          columns: {
            idNanoidDefault: {
              codecId: 'sql/char@1',
              nativeType: 'character',
              typeParams: { length: 21 },
            },
            idNanoidSized: {
              codecId: 'sql/char@1',
              nativeType: 'character',
              typeParams: { length: 16 },
            },
            dbExpr: {
              default: {
                kind: 'function',
                expression: 'gen_random_uuid()',
              },
            },
            createdAt: {
              default: {
                kind: 'function',
                expression: 'now()',
              },
            },
          },
        },
      },
    });
  });

  it('returns diagnostics for unsupported default functions and invalid arguments', () => {
    const document = parsePslDocument({
      schema: `model InvalidDefaults {
  id Int @id
  cuidValue String @default(cuid())
  badUuid String @default(uuid(5))
  badNanoid String @default(nanoid(1))
  emptyDbExpr String @default(dbgenerated(""))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('cuid(2)'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('uuid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('nanoid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('dbgenerated'),
        }),
      ]),
    );
  });

  it('returns diagnostics for optional fields with execution defaults', () => {
    const document = parsePslDocument({
      schema: `model OptionalDefaults {
  id Int @id
  token String? @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining(
            'cannot be optional when using execution default "nanoid"',
          ),
        }),
      ]),
    );
  });
});
