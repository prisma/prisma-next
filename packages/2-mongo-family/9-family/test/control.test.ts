import type { ControlStack } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { createMongoFamilyInstance } from '../src/core/control-instance';
import { mongoTargetDescriptor } from '../src/core/mongo-target-descriptor';

function createMinimalControlStack(): ControlStack {
  return {
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    extensionPacks: [],
    codecTypeImports: [],
    operationTypeImports: [],
    queryOperationTypeImports: [],
    extensionIds: ['mongo', 'mongo'],
    parameterizedRenderers: new Map(),
    parameterizedTypeImports: [],
    authoringContributions: { type: {}, field: {} },
  };
}

describe('mongoFamilyDescriptor', () => {
  it('returns a valid instance from ControlStack', () => {
    const stack = createControlStack({
      family: mongoFamilyDescriptor,
      target: mongoTargetDescriptor,
    });

    const instance = mongoFamilyDescriptor.create(stack);

    expect(instance.familyId).toBe('mongo');
    expect(typeof instance.validateContractIR).toBe('function');
    expect(typeof instance.emitContract).toBe('function');
  });

  it('has expected descriptor shape', () => {
    expect(mongoFamilyDescriptor.kind).toBe('family');
    expect(mongoFamilyDescriptor.id).toBe('mongo');
    expect(mongoFamilyDescriptor.familyId).toBe('mongo');
    expect(mongoFamilyDescriptor.version).toBe('0.0.1');
    expect(mongoFamilyDescriptor.hook).toBeDefined();
  });
});

describe('mongoTargetDescriptor', () => {
  it('has expected shape', () => {
    expect(mongoTargetDescriptor.kind).toBe('target');
    expect(mongoTargetDescriptor.id).toBe('mongo');
    expect(mongoTargetDescriptor.familyId).toBe('mongo');
    expect(mongoTargetDescriptor.targetId).toBe('mongo');
    expect(mongoTargetDescriptor.types.codecTypes.import).toEqual({
      package: '@prisma-next/mongo-core/codec-types',
      named: 'CodecTypes',
      alias: 'MongoCodecTypes',
    });
  });
});

describe('createMongoFamilyInstance', () => {
  it('returns an instance with familyId "mongo"', () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    expect(instance.familyId).toBe('mongo');
  });

  const stubMethods = ['verify', 'schemaVerify', 'sign', 'readMarker', 'introspect'] as const;

  for (const method of stubMethods) {
    it(`${method}() throws "not implemented"`, async () => {
      const instance = createMongoFamilyInstance(createMinimalControlStack());
      await expect(instance[method]()).rejects.toThrow('not implemented');
    });
  }
});
