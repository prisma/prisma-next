import mongoAdapter from '@prisma-next/adapter-mongo/control';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import {
  collectScalarTypeConstructors,
  type ScalarTypeConstructorOutput,
} from '@prisma-next/framework-components/authoring';
import { createControlStack } from '@prisma-next/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@prisma-next/mongo-contract-psl';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { mongoTargetDescriptor } from '@prisma-next/target-mongo/control';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

function legacyScalarTypeConstructorOutputs(): ReadonlyMap<string, ScalarTypeConstructorOutput> {
  const result = new Map<string, ScalarTypeConstructorOutput>();
  for (const [name, codecId] of stack.scalarTypeDescriptors) {
    const nativeType = stack.codecLookup.targetTypesFor(codecId)?.[0];
    if (nativeType === undefined) continue;
    result.set(name, { codecId, nativeType });
  }
  return result;
}

function namespaceScalarTypeCodecIds(): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [name, output] of collectScalarTypeConstructors(stack.authoringContributions.type)) {
    result.set(name, output.codecId);
  }
  return result;
}

const REPRESENTATIVE_SCHEMA = `model sample {
  id        ObjectId @id @map("_id")
  name      String
  count     Int
  active    Boolean
  ratio     Float
  createdAt DateTime
  parentRef ObjectId
}
`;

function emit(scalarTypeCodecIds: ReadonlyMap<string, string>) {
  const { document, sourceFile } = parse(REPRESENTATIVE_SCHEMA);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypeCodecIds.keys()],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToMongoContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    scalarTypeCodecIds,
    codecLookup: stack.codecLookup,
    authoringContributions: stack.authoringContributions,
  });
}

describe('mongo scalar-type parity: unified namespace vs legacy map channel', () => {
  it('derives identical {codecId, nativeType} from the namespace and pins every base scalar', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual(
      Object.fromEntries(legacyScalarTypeConstructorOutputs()),
    );
    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'mongo/string@1', nativeType: 'string' },
      Int: { codecId: 'mongo/int32@1', nativeType: 'int' },
      Boolean: { codecId: 'mongo/bool@1', nativeType: 'bool' },
      DateTime: { codecId: 'mongo/date@1', nativeType: 'date' },
      ObjectId: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
      Float: { codecId: 'mongo/double@1', nativeType: 'double' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([...stack.scalarTypeDescriptors.keys()].sort());
  });

  it('emits a byte-identical contract from namespace-derived and legacy-derived scalar maps', () => {
    const fromNamespace = emit(namespaceScalarTypeCodecIds());
    const fromLegacy = emit(stack.scalarTypeDescriptors);

    expect(fromNamespace.ok).toBe(true);
    expect(fromLegacy.ok).toBe(true);
    if (!fromNamespace.ok || !fromLegacy.ok) return;
    expect(fromNamespace.value).toEqual(fromLegacy.value);
    expect(JSON.stringify(fromNamespace.value)).toBe(JSON.stringify(fromLegacy.value));
  });

  it('resolves ObjectId fields (incl. the mandated _id) through the derived map', () => {
    const result = emit(namespaceScalarTypeCodecIds());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              sample: {
                fields: {
                  _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                  parentRef: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                },
              },
            },
          },
        },
      },
    });
  });
});
