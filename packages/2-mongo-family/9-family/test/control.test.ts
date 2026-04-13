import {
  createControlStack,
  hasMigrations,
  hasSchemaView,
} from '@prisma-next/framework-components/control';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  type MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
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

  it('verify() requires a valid contract', async () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    const fakeDriver = {} as Parameters<typeof instance.verify>[0]['driver'];
    await expect(
      instance.verify({
        driver: fakeDriver,
        contract: {},
        expectedTargetId: 'mongo',
        contractPath: '/test',
      }),
    ).rejects.toThrow();
  });

  it('schemaVerify() requires a valid contract', async () => {
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
    ).rejects.toThrow();
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

  it('implements SchemaViewCapable', () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    expect(hasSchemaView(instance)).toBe(true);
  });
});

describe('toSchemaView', () => {
  function createInstance() {
    return createMongoFamilyInstance(createMinimalControlStack());
  }

  it('returns an empty root for an empty schema', () => {
    const instance = createInstance();
    const ir: MongoSchemaIR = { collections: {} };

    const view = instance.toSchemaView(ir);

    expect(view.root.kind).toBe('root');
    expect(view.root.id).toBe('mongo-schema');
    expect(view.root.label).toBe('contract');
    expect(view.root.children).toBeUndefined();
  });

  it('maps collections to collection nodes', () => {
    const instance = createInstance();
    const ir: MongoSchemaIR = {
      collections: {
        users: new MongoSchemaCollection({ name: 'users' }),
        posts: new MongoSchemaCollection({ name: 'posts' }),
      },
    };

    const view = instance.toSchemaView(ir);

    expect(view.root.children).toHaveLength(2);
    const userNode = view.root.children!.find((n) => n.id === 'collection-users');
    expect(userNode).toBeDefined();
    expect(userNode!.kind).toBe('collection');
    expect(userNode!.label).toBe('collection users');
  });

  it('maps indexes to child nodes', () => {
    const instance = createInstance();
    const ir: MongoSchemaIR = {
      collections: {
        users: new MongoSchemaCollection({
          name: 'users',
          indexes: [
            new MongoSchemaIndex({
              keys: [{ field: 'email', direction: 1 }],
              unique: true,
            }),
            new MongoSchemaIndex({
              keys: [
                { field: 'lastName', direction: 1 },
                { field: 'firstName', direction: 1 },
              ],
            }),
          ],
        }),
      },
    };

    const view = instance.toSchemaView(ir);

    const usersNode = view.root.children![0]!;
    expect(usersNode.children).toHaveLength(2);

    const emailIdx = usersNode.children![0]!;
    expect(emailIdx.kind).toBe('index');
    expect(emailIdx.label).toContain('unique index');
    expect(emailIdx.label).toContain('email');

    const compoundIdx = usersNode.children![1]!;
    expect(compoundIdx.kind).toBe('index');
    expect(compoundIdx.label).not.toContain('unique');
    expect(compoundIdx.label).toContain('lastName');
    expect(compoundIdx.label).toContain('firstName');
  });

  it('maps validator to a child node', () => {
    const instance = createInstance();
    const ir: MongoSchemaIR = {
      collections: {
        products: new MongoSchemaCollection({
          name: 'products',
          validator: new MongoSchemaValidator({
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
      },
    };

    const view = instance.toSchemaView(ir);

    const productsNode = view.root.children![0]!;
    const validatorNode = productsNode.children!.find((n) => n.id === 'validator-products');
    expect(validatorNode).toBeDefined();
    expect(validatorNode!.label).toContain('strict');
    expect(validatorNode!.label).toContain('error');
  });

  it('maps collection options to a child node', () => {
    const instance = createInstance();
    const ir: MongoSchemaIR = {
      collections: {
        logs: new MongoSchemaCollection({
          name: 'logs',
          options: new MongoSchemaCollectionOptions({
            capped: { size: 1048576, max: 1000 },
          }),
        }),
      },
    };

    const view = instance.toSchemaView(ir);

    const logsNode = view.root.children![0]!;
    const optionsNode = logsNode.children!.find((n) => n.id === 'options-logs');
    expect(optionsNode).toBeDefined();
    expect(optionsNode!.label).toContain('capped');
    expect(optionsNode!.meta!['capped']).toEqual({ size: 1048576, max: 1000 });
  });
});
