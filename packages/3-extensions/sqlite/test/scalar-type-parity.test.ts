import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sql from '@prisma-next/family-sql/control';
import {
  collectScalarTypeConstructors,
  type ScalarTypeConstructorOutput,
} from '@prisma-next/framework-components/authoring';
import { createControlStack } from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import sqlite, { sqliteCreateNamespace } from '@prisma-next/target-sqlite/control';
import sqlitePackRef from '@prisma-next/target-sqlite/pack';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sql,
  target: sqlite,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});

const REPRESENTATIVE_SCHEMA = `model sample {
  id        Int      @id
  name      String
  big       BigInt
  ratio     Float
  price     Decimal
  createdAt DateTime
  payload   Json
  raw       Bytes
}
`;

function emit(scalarColumnDescriptors: ReadonlyMap<string, ScalarTypeConstructorOutput>) {
  const { document, sourceFile } = parse(REPRESENTATIVE_SCHEMA);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: sqlitePackRef,
    scalarColumnDescriptors,
    authoringContributions: stack.authoringContributions,
    controlMutationDefaults: stack.controlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace: sqliteCreateNamespace,
    codecLookup: stack.codecLookup,
    capabilities: stack.capabilities,
  });
}

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned literals
// below carry the parity claim forward — they are the exact
// {codecId, nativeType} pairs the retired map + codecLookup derivation produced.
describe('sqlite scalar types derived from the unified namespace', () => {
  it('pins every base scalar to its {codecId, nativeType}', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    // Base scalars carry the baseScalar provenance marker (their storage is
    // the adapter's default choice, overridable by generator defaults).
    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'sqlite/text@1', nativeType: 'text', baseScalar: true },
      Int: { codecId: 'sqlite/integer@1', nativeType: 'integer', baseScalar: true },
      BigInt: { codecId: 'sqlite/bigint@1', nativeType: 'integer', baseScalar: true },
      Float: { codecId: 'sqlite/real@1', nativeType: 'real', baseScalar: true },
      Decimal: { codecId: 'sqlite/text@1', nativeType: 'text', baseScalar: true },
      DateTime: { codecId: 'sqlite/datetime@1', nativeType: 'text', baseScalar: true },
      Json: { codecId: 'sqlite/json@1', nativeType: 'text', baseScalar: true },
      Bytes: { codecId: 'sqlite/blob@1', nativeType: 'blob', baseScalar: true },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'BigInt',
      'Bytes',
      'DateTime',
      'Decimal',
      'Float',
      'Int',
      'Json',
      'String',
    ]);
  });

  it('emits a contract whose columns pin the namespace-derived {codecId, nativeType}', () => {
    const result = emit(collectScalarTypeConstructors(stack.authoringContributions.type));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      storage: {
        namespaces: {
          __unbound__: {
            entries: {
              table: {
                sample: {
                  columns: {
                    id: { codecId: 'sqlite/integer@1', nativeType: 'integer' },
                    name: { codecId: 'sqlite/text@1', nativeType: 'text' },
                    big: { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
                    ratio: { codecId: 'sqlite/real@1', nativeType: 'real' },
                    price: { codecId: 'sqlite/text@1', nativeType: 'text' },
                    createdAt: { codecId: 'sqlite/datetime@1', nativeType: 'text' },
                    payload: { codecId: 'sqlite/json@1', nativeType: 'text' },
                    raw: { codecId: 'sqlite/blob@1', nativeType: 'blob' },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
