import { createControlStack } from '@prisma-next/framework-components/control';
import { defineContract, field, model } from '@prisma-next/mongo-contract-ts/contract-builder';
import mongoTargetPack from '@prisma-next/target-mongo/pack';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { createMongoFamilyInstance } from '../src/core/control-instance';
import { mongoTargetDescriptor } from '../src/core/mongo-target-descriptor';
import mongoFamilyPack from '../src/exports/pack';

function createMinimalControlStack() {
  return createControlStack({ family: mongoFamilyDescriptor, target: mongoTargetDescriptor });
}

describe('mongoFamilyDescriptor', () => {
  it('returns a valid instance from ControlStack', () => {
    const stack = createControlStack({
      family: mongoFamilyDescriptor,
      target: mongoTargetDescriptor,
    });

    const instance = mongoFamilyDescriptor.create(stack);

    expect(instance.familyId).toBe('mongo');
    expect(typeof instance.validateContract).toBe('function');
  });

  it('has expected descriptor shape', () => {
    expect(mongoFamilyDescriptor.kind).toBe('family');
    expect(mongoFamilyDescriptor.id).toBe('mongo');
    expect(mongoFamilyDescriptor.familyId).toBe('mongo');
    expect(mongoFamilyDescriptor.version).toBe('0.0.1');
    expect(mongoFamilyDescriptor.emission).toBeDefined();
  });
});

describe('mongoTargetDescriptor', () => {
  it('has expected shape', () => {
    expect(mongoTargetDescriptor.kind).toBe('target');
    expect(mongoTargetDescriptor.id).toBe('mongo');
    expect(mongoTargetDescriptor.familyId).toBe('mongo');
    expect(mongoTargetDescriptor.targetId).toBe('mongo');
  });
});

describe('mongoFamilyPack', () => {
  it('has expected shape', () => {
    expect(mongoFamilyPack).toEqual({
      kind: 'family',
      id: 'mongo',
      familyId: 'mongo',
      version: '0.0.1',
    });
  });

  it('composes with mongo-contract-ts authoring', () => {
    const User = model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        email: field.string(),
      },
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User },
    });

    expect(contract.targetFamily).toBe('mongo');
    expect(contract.target).toBe('mongo');
    expect(contract.roots).toEqual({
      users: 'User',
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
