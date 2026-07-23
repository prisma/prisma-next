import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { collectScalarTypeConstructors } from '@prisma-next/framework-components/authoring';
import { createControlStack } from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

function emit(schema: string) {
  const { document, sourceFile } = parse(schema);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresPackRef,
    scalarColumnDescriptors: collectScalarTypeConstructors(stack.authoringContributions.type),
    authoringContributions: stack.authoringContributions,
    controlMutationDefaults: stack.controlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: stack.codecLookup,
    capabilities: stack.capabilities,
  });
}

interface StorageTypeShape {
  readonly kind: string;
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
}

interface ColumnShape {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
}

function storageOf(value: unknown) {
  return (
    value as {
      readonly storage: {
        readonly types?: Record<string, StorageTypeShape>;
        readonly namespaces: Record<
          string,
          {
            readonly entries: {
              readonly table: Record<string, { columns: Record<string, ColumnShape> }>;
            };
          }
        >;
      };
    }
  ).storage;
}

function schemaFor(bare: string, legacy: string): string {
  return `types {
  Legacy = ${legacy}
  Named = ${bare}
}

model sample {
  id Int @id
  viaNamed Named
  direct ${bare}
}
`;
}

interface ParityCase {
  readonly title: string;
  readonly bare: string;
  readonly legacy: string;
  readonly expected: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams: Record<string, unknown>;
  };
}

const varcharOut = { codecId: 'sql/varchar@1', nativeType: 'character varying' } as const;
const charOut = { codecId: 'sql/char@1', nativeType: 'character' } as const;
const numericOut = { codecId: 'pg/numeric@1', nativeType: 'numeric' } as const;

const parityCases: readonly ParityCase[] = [
  {
    title: 'VarChar(191)',
    bare: 'VarChar(191)',
    legacy: 'String @db.VarChar(191)',
    expected: { ...varcharOut, typeParams: { length: 191 } },
  },
  {
    title: 'VarChar() — arg omitted',
    bare: 'VarChar()',
    legacy: 'String @db.VarChar',
    expected: { ...varcharOut, typeParams: {} },
  },
  {
    title: 'VarChar — bare',
    bare: 'VarChar',
    legacy: 'String @db.VarChar',
    expected: { ...varcharOut, typeParams: {} },
  },
  {
    title: 'Char(12)',
    bare: 'Char(12)',
    legacy: 'String @db.Char(12)',
    expected: { ...charOut, typeParams: { length: 12 } },
  },
  {
    title: 'Char — bare',
    bare: 'Char',
    legacy: 'String @db.Char',
    expected: { ...charOut, typeParams: {} },
  },
  {
    title: 'Numeric(10, 2)',
    bare: 'Numeric(10, 2)',
    legacy: 'Decimal @db.Numeric(10, 2)',
    expected: { ...numericOut, typeParams: { precision: 10, scale: 2 } },
  },
  {
    title: 'Numeric(10) — one arg',
    bare: 'Numeric(10)',
    legacy: 'Decimal @db.Numeric(10)',
    expected: { ...numericOut, typeParams: { precision: 10 } },
  },
  {
    title: 'Numeric — bare',
    bare: 'Numeric',
    legacy: 'Decimal @db.Numeric',
    expected: { ...numericOut, typeParams: {} },
  },
  {
    title: 'Timestamp(3)',
    bare: 'Timestamp(3)',
    legacy: 'DateTime @db.Timestamp(3)',
    expected: { codecId: 'pg/timestamp@1', nativeType: 'timestamp', typeParams: { precision: 3 } },
  },
  {
    title: 'Timestamp — bare',
    bare: 'Timestamp',
    legacy: 'DateTime @db.Timestamp',
    expected: { codecId: 'pg/timestamp@1', nativeType: 'timestamp', typeParams: {} },
  },
  {
    title: 'Timestamptz(6)',
    bare: 'Timestamptz(6)',
    legacy: 'DateTime @db.Timestamptz(6)',
    expected: {
      codecId: 'pg/timestamptz@1',
      nativeType: 'timestamptz',
      typeParams: { precision: 6 },
    },
  },
  {
    title: 'Timestamptz — bare',
    bare: 'Timestamptz',
    legacy: 'DateTime @db.Timestamptz',
    expected: { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz', typeParams: {} },
  },
  {
    title: 'Time(3)',
    bare: 'Time(3)',
    legacy: 'DateTime @db.Time(3)',
    expected: { codecId: 'pg/time@1', nativeType: 'time', typeParams: { precision: 3 } },
  },
  {
    title: 'Time — bare',
    bare: 'Time',
    legacy: 'DateTime @db.Time',
    expected: { codecId: 'pg/time@1', nativeType: 'time', typeParams: {} },
  },
  {
    title: 'Timetz(2)',
    bare: 'Timetz(2)',
    legacy: 'DateTime @db.Timetz(2)',
    expected: { codecId: 'pg/timetz@1', nativeType: 'timetz', typeParams: { precision: 2 } },
  },
  {
    title: 'Timetz — bare',
    bare: 'Timetz',
    legacy: 'DateTime @db.Timetz',
    expected: { codecId: 'pg/timetz@1', nativeType: 'timetz', typeParams: {} },
  },
  {
    title: 'Uuid() — called',
    bare: 'Uuid()',
    legacy: 'String @db.Uuid',
    expected: { codecId: 'pg/uuid@1', nativeType: 'uuid', typeParams: {} },
  },
  {
    title: 'Uuid — bare',
    bare: 'Uuid',
    legacy: 'String @db.Uuid',
    expected: { codecId: 'pg/uuid@1', nativeType: 'uuid', typeParams: {} },
  },
  {
    title: 'SmallInt — bare',
    bare: 'SmallInt',
    legacy: 'Int @db.SmallInt',
    expected: { codecId: 'pg/int2@1', nativeType: 'int2', typeParams: {} },
  },
  {
    title: 'Real — bare',
    bare: 'Real',
    legacy: 'Float @db.Real',
    expected: { codecId: 'pg/float4@1', nativeType: 'float4', typeParams: {} },
  },
  {
    title: 'Date — bare',
    bare: 'Date',
    legacy: 'DateTime @db.Date',
    expected: { codecId: 'pg/date@1', nativeType: 'date', typeParams: {} },
  },
];

// Each case emits one document carrying both paths, so the comparison is
// live-vs-live in the same run: the pinned literal guards the oracle side
// (a drifting @db.* path fails assertion 1), and the deep-equals guard the
// bare-type side (a drifting contribution fails assertions 2/3).
describe('native types as bare scalar types — parity with the live @db.* path', () => {
  it.each(parityCases)('$title', ({ bare, legacy, expected }) => {
    const result = emit(schemaFor(bare, legacy));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = storageOf(result.value);
    const legacyType = storage.types?.['Legacy'];
    const namedType = storage.types?.['Named'];

    expect(legacyType).toEqual({ kind: 'codec-instance', ...expected });
    expect(namedType).toEqual(legacyType);

    const columns = storage.namespaces['public']?.entries.table['sample']?.columns;
    const direct = columns?.['direct'];
    expect(direct).toBeDefined();
    if (!direct || !legacyType) return;
    expect({
      codecId: direct.codecId,
      nativeType: direct.nativeType,
      typeParams: direct.typeParams ?? {},
    }).toEqual({
      codecId: legacyType.codecId,
      nativeType: legacyType.nativeType,
      typeParams: legacyType.typeParams,
    });

    expect(columns?.['viaNamed']).toMatchObject({
      codecId: expected.codecId,
      nativeType: expected.nativeType,
      typeRef: 'Named',
    });
  });

  it('rejects VarChar(0) in field position via the declarative minimum', () => {
    const result = emit(`model sample {
  id Int @id
  name VarChar(0)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be >= 1'),
        }),
      ]),
    );
  });

  it('rejects VarChar(0) in named-type position via the declarative minimum', () => {
    const result = emit(`types {
  Bad = VarChar(0)
}

model sample {
  id Int @id
  name Bad
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be >= 1'),
        }),
      ]),
    );
  });

  it('rejects Numeric(0) in field position, matching @db.Numeric\u2019s positive-precision rule', () => {
    const result = emit(`model sample {
  id Int @id
  amount Numeric(0)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be >= 1'),
        }),
      ]),
    );
  });

  it('rejects Numeric(0) in named-type position, matching @db.Numeric\u2019s positive-precision rule', () => {
    const result = emit(`types {
  Bad = Numeric(0)
}

model sample {
  id Int @id
  amount Bad
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be >= 1'),
        }),
      ]),
    );
  });

  it('rejects a non-integer precision via the declarative integer constraint', () => {
    const result = emit(`model sample {
  id Int @id
  at Timestamp(1.5)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be an integer'),
        }),
      ]),
    );
  });

  it('rejects arguments on a no-arg native type', () => {
    const result = emit(`model sample {
  id Int @id
  ref Uuid(1)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('at most 0 argument(s)'),
        }),
      ]),
    );
  });
});
