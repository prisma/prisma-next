import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import {
  collectScalarTypeConstructors,
  type ScalarTypeConstructorOutput,
} from '@prisma-next/framework-components/authoring';
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
  active    Boolean
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
    target: postgresPackRef,
    scalarColumnDescriptors,
    authoringContributions: stack.authoringContributions,
    controlMutationDefaults: stack.controlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: stack.codecLookup,
    capabilities: stack.capabilities,
  });
}

describe('postgres scalar-type parity: unified namespace vs legacy map channel', () => {
  it('derives identical {codecId, nativeType} from the namespace and pins every base scalar', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual(
      Object.fromEntries(legacyScalarColumnDescriptors()),
    );
    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'pg/text@1', nativeType: 'text' },
      Boolean: { codecId: 'pg/bool@1', nativeType: 'bool' },
      Int: { codecId: 'pg/int4@1', nativeType: 'int4' },
      BigInt: { codecId: 'pg/int8@1', nativeType: 'int8' },
      Float: { codecId: 'pg/float8@1', nativeType: 'float8' },
      Decimal: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
      DateTime: { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' },
      Json: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
      Bytes: { codecId: 'pg/bytea@1', nativeType: 'bytea' },
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
