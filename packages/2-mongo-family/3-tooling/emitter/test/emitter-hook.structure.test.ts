import { describe, expect, it } from 'vitest';
import { mongoTargetFamilyHook } from '../src/index';
import { createMongoIR } from './fixtures/create-mongo-ir';

describe('mongoTargetFamilyHook.validateStructure', () => {
  it('passes for valid minimal contract', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: {},
          storage: { collection: 'users' },
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).not.toThrow();
  });

  it('throws for wrong targetFamily', () => {
    const ir = createMongoIR({ targetFamily: 'sql' });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'Expected targetFamily "mongo"',
    );
  });

  it('throws for missing storage.collections', () => {
    const ir = createMongoIR({ storage: {} });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'must have storage.collections',
    );
  });

  it('throws when model references non-existent collection', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: {},
          storage: { collection: 'users' },
        },
      },
      storage: { collections: {} },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'references collection "users" which is not in storage.collections',
    );
  });

  it('throws when model is missing fields', () => {
    const ir = createMongoIR({
      models: {
        User: {
          relations: {},
          storage: { collection: 'users' },
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'missing required field "fields"',
    );
  });

  it('throws when model is missing relations', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          storage: { collection: 'users' },
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'missing required field "relations"',
    );
  });

  it('throws when owned model has a collection', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: {},
          storage: { collection: 'users' },
        },
        Address: {
          fields: { street: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: { collection: 'users' },
          owner: 'User',
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'Owned model "Address" must not have storage.collection',
    );
  });

  it('throws when owner model does not exist', () => {
    const ir = createMongoIR({
      models: {
        Address: {
          fields: { street: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: {},
          owner: 'NonExistent',
        },
      },
      storage: { collections: {} },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'declares owner "NonExistent" which does not exist',
    );
  });

  it('passes with valid owner/embedded model', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: { addresses: { to: 'Address', cardinality: '1:N' } },
          storage: {
            collection: 'users',
            relations: { addresses: { field: 'addresses' } },
          },
        },
        Address: {
          fields: { street: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: {},
          owner: 'User',
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).not.toThrow();
  });

  it('passes with polymorphic models sharing collection', () => {
    const ir = createMongoIR({
      models: {
        Task: {
          fields: {
            _id: { codecId: 'mongo/objectId@1', nullable: false },
            type: { codecId: 'mongo/string@1', nullable: false },
          },
          relations: {},
          storage: { collection: 'tasks' },
          discriminator: { field: 'type' },
          variants: { Bug: { value: 'bug' } },
        },
        Bug: {
          fields: { severity: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: { collection: 'tasks' },
          base: 'Task',
        },
      },
      storage: { collections: { tasks: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).not.toThrow();
  });

  it('throws when variant does not share base collection', () => {
    const ir = createMongoIR({
      models: {
        Task: {
          fields: {
            _id: { codecId: 'mongo/objectId@1', nullable: false },
            type: { codecId: 'mongo/string@1', nullable: false },
          },
          relations: {},
          storage: { collection: 'tasks' },
          discriminator: { field: 'type' },
          variants: { Bug: { value: 'bug' } },
        },
        Bug: {
          fields: { severity: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: { collection: 'bugs' },
          base: 'Task',
        },
      },
      storage: { collections: { tasks: {}, bugs: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      "must share its base's collection",
    );
  });

  it('throws when model is missing storage', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: {},
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'missing required field "storage"',
    );
  });

  it('throws when base model does not exist', () => {
    const ir = createMongoIR({
      models: {
        Bug: {
          fields: { severity: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: { collection: 'tasks' },
          base: 'NonExistent',
        },
      },
      storage: { collections: { tasks: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'declares base "NonExistent" which does not exist',
    );
  });

  it('throws when embed relation to owned model is missing storage.relations entry', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: { addresses: { to: 'Address', cardinality: '1:N' } },
          storage: { collection: 'users' },
        },
        Address: {
          fields: { street: { codecId: 'mongo/string@1', nullable: false } },
          relations: {},
          storage: {},
          owner: 'User',
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'embed relation "addresses" to owned model "Address" but no matching storage.relations entry',
    );
  });

  it('throws when storage.relations key has no matching domain-level relation', () => {
    const ir = createMongoIR({
      models: {
        User: {
          fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
          relations: {},
          storage: {
            collection: 'users',
            relations: { addresses: { field: 'addresses' } },
          },
        },
      },
      storage: { collections: { users: {} } },
    });
    expect(() => mongoTargetFamilyHook.validateStructure(ir)).toThrow(
      'storage.relations.addresses but no matching domain-level relation',
    );
  });
});
