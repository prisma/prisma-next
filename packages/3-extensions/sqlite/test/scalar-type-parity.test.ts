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

function legacyScalarColumnDescriptors(): ReadonlyMap<string, ScalarTypeConstructorOutput> {
  const result = new Map<string, ScalarTypeConstructorOutput>();
  for (const [name, codecId] of stack.scalarTypeDescriptors) {
    const nativeType = stack.codecLookup.targetTypesFor(codecId)?.[0];
    if (nativeType === undefined) continue;
    result.set(name, { codecId, nativeType });
  }
  return result;
}

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
    scalarTypes: [...scalarColumnDescriptors.keys()],
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

describe('sqlite scalar-type parity: unified namespace vs legacy map channel', () => {
  it('derives identical {codecId, nativeType} from the namespace and pins every base scalar', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual(
      Object.fromEntries(legacyScalarColumnDescriptors()),
    );
    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'sqlite/text@1', nativeType: 'text' },
      Int: { codecId: 'sqlite/integer@1', nativeType: 'integer' },
      BigInt: { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
      Float: { codecId: 'sqlite/real@1', nativeType: 'real' },
      Decimal: { codecId: 'sqlite/text@1', nativeType: 'text' },
      DateTime: { codecId: 'sqlite/datetime@1', nativeType: 'text' },
      Json: { codecId: 'sqlite/json@1', nativeType: 'text' },
      Bytes: { codecId: 'sqlite/blob@1', nativeType: 'blob' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([...stack.scalarTypeDescriptors.keys()].sort());
  });

  it('emits a byte-identical contract from namespace-derived and legacy-derived scalar maps', () => {
    const fromNamespace = emit(collectScalarTypeConstructors(stack.authoringContributions.type));
    const fromLegacy = emit(legacyScalarColumnDescriptors());

    expect(fromNamespace.ok).toBe(true);
    expect(fromLegacy.ok).toBe(true);
    if (!fromNamespace.ok || !fromLegacy.ok) return;
    expect(fromNamespace.value).toEqual(fromLegacy.value);
    expect(JSON.stringify(fromNamespace.value)).toBe(JSON.stringify(fromLegacy.value));
  });
});
