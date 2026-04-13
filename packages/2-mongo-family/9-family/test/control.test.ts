import {
  createControlStack,
  hasMigrations,
  hasSchemaView,
} from '@prisma-next/framework-components/control';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
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
    const ir = mongoTargetDescriptor.migrations.contractToSchema(null) as MongoSchemaIR;
    expect(ir.collections).toEqual([]);
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

  it('sign() requires a valid contract', async () => {
    const instance = createMongoFamilyInstance(createMinimalControlStack());
    const fakeDriver = {} as Parameters<typeof instance.sign>[0]['driver'];
    await expect(
      instance.sign({ driver: fakeDriver, contract: {}, contractPath: '/test' }),
    ).rejects.toThrow();
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
    const ir = new MongoSchemaIR([]);

    const view = instance.toSchemaView(ir);

    expect(view.root.kind).toBe('root');
    expect(view.root.id).toBe('mongo-schema');
    expect(view.root.label).toBe('database');
    expect(view.root.children).toBeUndefined();
  });

  it('maps collections to collection nodes', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({ name: 'users' }),
      new MongoSchemaCollection({ name: 'posts' }),
    ]);

    const view = instance.toSchemaView(ir);

    expect(view.root.children).toHaveLength(2);
    const userNode = view.root.children!.find((n) => n.id === 'collection-users');
    expect(userNode).toBeDefined();
    expect(userNode!.kind).toBe('collection');
    expect(userNode!.label).toBe('collection users');
  });

  it('maps ascending indexes omitting direction', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({
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
    ]);

    const view = instance.toSchemaView(ir);

    const usersNode = view.root.children![0]!;
    expect(usersNode.children).toHaveLength(2);

    const emailIdx = usersNode.children![0]!;
    expect(emailIdx.kind).toBe('index');
    expect(emailIdx.label).toBe('unique index (email)');

    const compoundIdx = usersNode.children![1]!;
    expect(compoundIdx.kind).toBe('index');
    expect(compoundIdx.label).toBe('index (lastName, firstName)');
  });

  it('shows descending direction as "desc"', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'events',
        indexes: [
          new MongoSchemaIndex({
            keys: [
              { field: 'userId', direction: 1 },
              { field: 'timestamp', direction: -1 },
            ],
          }),
        ],
      }),
    ]);

    const view = instance.toSchemaView(ir);

    const eventsNode = view.root.children![0]!;
    expect(eventsNode.children![0]!.label).toBe('index (userId, timestamp desc)');
  });

  it('shows special index types as-is', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'products',
        indexes: [
          new MongoSchemaIndex({
            keys: [{ field: 'code', direction: 'hashed' }],
          }),
          new MongoSchemaIndex({
            keys: [
              { field: '_fts', direction: 'text' },
              { field: '_ftsx', direction: 1 },
            ],
          }),
        ],
      }),
    ]);

    const view = instance.toSchemaView(ir);

    const productsNode = view.root.children![0]!;
    expect(productsNode.children![0]!.label).toBe('index (code hashed)');
    expect(productsNode.children![1]!.label).toBe('index (_fts text, _ftsx)');
  });

  it('maps validator with labeled level and action', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'products',
        validator: new MongoSchemaValidator({
          jsonSchema: { bsonType: 'object' },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      }),
    ]);

    const view = instance.toSchemaView(ir);

    const productsNode = view.root.children![0]!;
    const validatorNode = productsNode.children!.find((n) => n.id === 'validator-products');
    expect(validatorNode).toBeDefined();
    expect(validatorNode!.label).toBe('validator (level: strict, action: error)');
  });

  it('expands validator properties as child nodes', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'users',
        validator: new MongoSchemaValidator({
          jsonSchema: {
            bsonType: 'object',
            required: ['_id', 'email'],
            properties: {
              _id: { bsonType: 'objectId' },
              email: { bsonType: 'string' },
              name: { bsonType: 'string' },
              age: { bsonType: 'int' },
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      }),
    ]);

    const view = instance.toSchemaView(ir);

    const usersNode = view.root.children![0]!;
    const validatorNode = usersNode.children!.find((n) => n.id === 'validator-users')!;
    expect(validatorNode.children).toHaveLength(4);

    expect(validatorNode.children![0]!.label).toBe('_id: objectId (required)');
    expect(validatorNode.children![1]!.label).toBe('email: string (required)');
    expect(validatorNode.children![2]!.label).toBe('name: string');
    expect(validatorNode.children![3]!.label).toBe('age: int');
  });

  it('maps collection options to a child node', () => {
    const instance = createInstance();
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'logs',
        options: new MongoSchemaCollectionOptions({
          capped: { size: 1048576, max: 1000 },
        }),
      }),
    ]);

    const view = instance.toSchemaView(ir);

    const logsNode = view.root.children![0]!;
    const optionsNode = logsNode.children!.find((n) => n.id === 'options-logs');
    expect(optionsNode).toBeDefined();
    expect(optionsNode!.label).toContain('capped');
    expect(optionsNode!.meta!['capped']).toEqual({ size: 1048576, max: 1000 });
  });
});
