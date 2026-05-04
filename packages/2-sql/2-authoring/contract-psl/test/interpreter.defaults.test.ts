import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarTypeDescriptors,
  sqliteTarget,
} from './fixtures';

describe('interpretPslDocumentToSqlContract default lowering', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<InterpretPslDocumentToSqlContractInput, 'target' | 'scalarTypeDescriptors'>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      ...input,
    });
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

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

  it('preserves raw dbgenerated defaults for timestamp and json columns', () => {
    const document = parsePslDocument({
      schema: `model Defaults {
  id Int @id
  touchedAt DateTime @default(dbgenerated("clock_timestamp()"))
  payload Json @default(dbgenerated("'{}'::jsonb"))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      tables: {
        defaults: {
          columns: {
            touchedAt: {
              default: {
                kind: 'function',
                expression: 'clock_timestamp()',
              },
            },
            payload: {
              default: {
                kind: 'function',
                expression: "'{}'::jsonb",
              },
            },
          },
        },
      },
    });
  });

  it('lowers @updatedAt to create and update execution defaults', () => {
    const document = parsePslDocument({
      schema: `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    expect(storage.tables['timestamped']?.columns['createdAt']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'timestamped', column: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('returns diagnostics for invalid @updatedAt usage', () => {
    const document = parsePslDocument({
      schema: `model InvalidUpdatedAt {
  id Int @id
  withArg DateTime @updatedAt(foo)
  onText String @updatedAt
  optional DateTime? @updatedAt
  list DateTime[] @updatedAt
  withDefault DateTime @updatedAt @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('does not accept arguments'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('timestamp-compatible'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('cannot be optional'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('cannot be a list'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('cannot be combined with @default'),
        }),
      ]),
    );
  });

  it('lowers SQLite @updatedAt to SQLite timestamp codecs', () => {
    const document = parsePslDocument({
      schema: `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      document,
      target: sqliteTarget,
      scalarTypeDescriptors: sqliteScalarTypeDescriptors,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = result.value.storage as SqlStorage;
    expect(storage.tables['timestamped']?.columns['updatedAt']).toMatchObject({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'timestamped', column: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });
});
