import { createControlStack, hasMigrations } from '@prisma-next/framework-components/control';
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

  it('exposes migrations capability', () => {
    expect(hasMigrations(mongoTargetDescriptor)).toBe(true);
  });

  it('migrations.createPlanner() returns a functional planner', () => {
    if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations');
    const family = createMongoFamilyInstance(createMinimalControlStack());
    const planner = mongoTargetDescriptor.migrations.createPlanner(family);
    expect(typeof planner.plan).toBe('function');
  });

  it('migrations.createRunner() returns a functional runner', () => {
    if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations');
    const family = createMongoFamilyInstance(createMinimalControlStack());
    const runner = mongoTargetDescriptor.migrations.createRunner(family);
    expect(typeof runner.execute).toBe('function');
  });

  it('migrations.contractToSchema(null) returns empty IR', () => {
    if (!hasMigrations(mongoTargetDescriptor)) throw new Error('expected migrations');
    const ir = mongoTargetDescriptor.migrations.contractToSchema(null) as {
      collections: Record<string, unknown>;
    };
    expect(ir.collections).toEqual({});
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
});

describe('createMongoFamilyInstance', () => {
  it('returns an instance with familyId "mongo"', () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    expect(instance.familyId).toBe('mongo');
  });

  it('verify() throws "not implemented"', async () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    const fakeDriver = {} as Parameters<typeof instance.verify>[0]['driver'];
    await expect(
      instance.verify({
        driver: fakeDriver,
        contract: {},
        expectedTargetId: 'mongo',
        contractPath: '/test',
      }),
    ).rejects.toThrow('not implemented');
  });

  it('schemaVerify() throws "not implemented"', async () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    const fakeDriver = {} as Parameters<typeof instance.schemaVerify>[0]['driver'];
    await expect(
      instance.schemaVerify({
        driver: fakeDriver,
        contract: {},
        strict: false,
        contractPath: '/test',
        frameworkComponents: [],
      }),
    ).rejects.toThrow('not implemented');
  });

  it('sign() throws "not implemented"', async () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    const fakeDriver = {} as Parameters<typeof instance.sign>[0]['driver'];
    await expect(
      instance.sign({ driver: fakeDriver, contract: {}, contractPath: '/test' }),
    ).rejects.toThrow('not implemented');
  });

  it('introspect() delegates to introspectSchema', async () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    const fakeDriver = {} as Parameters<typeof instance.introspect>[0]['driver'];
    await expect(instance.introspect({ driver: fakeDriver })).rejects.toThrow(
      'does not expose a db property',
    );
  });
});
