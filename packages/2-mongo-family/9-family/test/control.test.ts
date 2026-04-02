import type { AssembledComponentState } from '@prisma-next/contract/assembly';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { createMongoFamilyInstance } from '../src/core/control-instance';
import { mongoTargetDescriptor } from '../src/core/mongo-target-descriptor';

function createMinimalAssembledState(): AssembledComponentState {
  return {
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
  it('throws when assembledState is missing', () => {
    const stack = { target: mongoTargetDescriptor, extensions: [] };

    expect(() => mongoFamilyDescriptor.create(stack as never)).toThrow(
      'MongoFamilyDescriptor.create() requires assembledState',
    );
  });

  it('returns a valid instance when assembledState is provided', () => {
    const stack = { target: mongoTargetDescriptor, extensions: [] };
    const state = createMinimalAssembledState();

    const instance = mongoFamilyDescriptor.create(stack as never, state);

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
    const instance = createMongoFamilyInstance(createMinimalAssembledState());
    expect(instance.familyId).toBe('mongo');
  });

  const stubMethods = ['verify', 'schemaVerify', 'sign', 'readMarker', 'introspect'] as const;

  for (const method of stubMethods) {
    it(`${method}() throws "not implemented"`, async () => {
      const instance = createMongoFamilyInstance(createMinimalAssembledState());
      await expect(instance[method]()).rejects.toThrow('not implemented');
    });
  }
});
