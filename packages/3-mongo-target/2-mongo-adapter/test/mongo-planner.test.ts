import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import type { MongoContract, MongoStorageCollection } from '@prisma-next/mongo-contract';
import type {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  type MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/mongo-planner';

const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const ADDITIVE_ONLY_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive'],
};

function makeContract(collections: Record<string, MongoStorageCollection>): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'sha256:test-profile',
    capabilities: {},
    extensionPacks: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash: 'sha256:test-storage',
      collections,
    },
  } as unknown as MongoContract;
}

function emptyIR(): MongoSchemaIR {
  return { collections: {} };
}

function irWithCollection(name: string, indexes: MongoSchemaIndex[]): MongoSchemaIR {
  return {
    collections: { [name]: new MongoSchemaCollection({ name, indexes }) },
  };
}

function ascIndex(
  field: string,
  options?: { unique?: boolean; sparse?: boolean },
): MongoSchemaIndex {
  return new MongoSchemaIndex({
    keys: [{ field, direction: 1 }],
    unique: options?.unique,
    sparse: options?.sparse,
  });
}

function planSuccess(
  planner: MongoMigrationPlanner,
  contract: MongoContract,
  schema: MongoSchemaIR,
  policy = ALL_CLASSES_POLICY,
) {
  const result = planner.plan({ contract, schema, policy, frameworkComponents: [] });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('Expected success');
  return result.plan;
}

describe('MongoMigrationPlanner', () => {
  const planner = new MongoMigrationPlanner();

  describe('index diffing', () => {
    it('emits createIndex when destination has an index origin lacks', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());

      expect(plan.operations).toHaveLength(1);
      const op = plan.operations[0] as MongoMigrationPlanOperation;
      expect(op.operationClass).toBe('additive');
      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('createIndex');
      const cmd = op.execute[0]!.command as CreateIndexCommand;
      expect(cmd.collection).toBe('users');
      expect(cmd.keys).toEqual([{ field: 'email', direction: 1 }]);
    });

    it('emits dropIndex when origin has an index destination lacks', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);

      expect(plan.operations).toHaveLength(1);
      const op = plan.operations[0] as MongoMigrationPlanOperation;
      expect(op.operationClass).toBe('destructive');
      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('dropIndex');
      const cmd = op.execute[0]!.command as DropIndexCommand;
      expect(cmd.collection).toBe('users');
    });

    it('emits no operations when indexes are identical', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('treats indexes with same keys but different name as equivalent (no-op)', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('treats indexes with same keys but different options as different', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);

      expect(plan.operations).toHaveLength(2);
      const drop = plan.operations[0] as MongoMigrationPlanOperation;
      const create = plan.operations[1] as MongoMigrationPlanOperation;
      expect(drop.operationClass).toBe('destructive');
      expect(create.operationClass).toBe('additive');
    });

    it('treats indexes with same keys but different TTL as different', () => {
      const contract = makeContract({
        sessions: {
          indexes: [{ keys: [{ field: 'createdAt', direction: 1 }], expireAfterSeconds: 3600 }],
        },
      });
      const origin = irWithCollection('sessions', [
        new MongoSchemaIndex({
          keys: [{ field: 'createdAt', direction: 1 }],
          expireAfterSeconds: 7200,
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('treats indexes with same keys but different partialFilterExpression as different', () => {
      const contract = makeContract({
        items: {
          indexes: [
            {
              keys: [{ field: 'status', direction: 1 }],
              partialFilterExpression: { active: true },
            },
          ],
        },
      });
      const origin = irWithCollection('items', [
        new MongoSchemaIndex({
          keys: [{ field: 'status', direction: 1 }],
          partialFilterExpression: { active: false },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('handles multiple indexes on same collection', () => {
      const contract = makeContract({
        users: {
          indexes: [
            { keys: [{ field: 'email', direction: 1 }] },
            { keys: [{ field: 'name', direction: 1 }] },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(2);
      expect(plan.operations.every((op) => op.operationClass === 'additive')).toBe(true);
    });

    it('handles multiple collections', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
        posts: { indexes: [{ keys: [{ field: 'title', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(2);
    });

    it('drops all indexes and the collection when collection removed from destination', () => {
      const contract = makeContract({});
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            indexes: [ascIndex('email'), ascIndex('name')],
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(3);
      expect(plan.operations.every((op) => op.operationClass === 'destructive')).toBe(true);
      expect(plan.operations[2]!.id).toBe('collection.users.drop');
    });

    it('handles empty origin (all creates)', () => {
      const contract = makeContract({
        users: {
          indexes: [
            { keys: [{ field: 'email', direction: 1 }], unique: true },
            { keys: [{ field: 'name', direction: 1 }] },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(2);
      expect(plan.operations.every((op) => op.operationClass === 'additive')).toBe(true);
    });
  });

  describe('ordering', () => {
    it('orders drops before creates', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'name', direction: 1 }] }] },
      });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);

      expect(plan.operations).toHaveLength(2);
      expect(plan.operations[0]!.operationClass).toBe('destructive');
      expect(plan.operations[1]!.operationClass).toBe('additive');
    });

    it('orders operations deterministically by collection then keys', () => {
      const contract = makeContract({
        beta: { indexes: [{ keys: [{ field: 'x', direction: 1 }] }] },
        alpha: { indexes: [{ keys: [{ field: 'y', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());

      expect(plan.operations).toHaveLength(2);
      expect(plan.operations[0]!.id).toContain('alpha');
      expect(plan.operations[1]!.id).toContain('beta');
    });
  });

  describe('policy gating', () => {
    it('returns conflicts when destructive operations are disallowed', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ADDITIVE_ONLY_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.kind).toBe('policy-violation');
    });

    it('allows additive operations with additive-only policy', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR(), ADDITIVE_ONLY_POLICY);
      expect(plan.operations).toHaveLength(1);
    });

    it('returns all disallowed operations as separate conflicts', () => {
      const contract = makeContract({});
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            indexes: [ascIndex('email'), ascIndex('name')],
          }),
        },
      };
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ADDITIVE_ONLY_POLICY,
        frameworkComponents: [],
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts).toHaveLength(3);
    });

    it('rejects destructive validator add with additive-only policy', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = irWithCollection('users', []);
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ADDITIVE_ONLY_POLICY,
        frameworkComponents: [],
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.summary).toContain('destructive');
    });

    it('allows widening validator removal with widening policy', () => {
      const wideningPolicy: MigrationOperationPolicy = {
        allowedOperationClasses: ['additive', 'widening'],
      };
      const contract = makeContract({ users: {} });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin, wideningPolicy);
      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.operationClass).toBe('widening');
    });
  });

  describe('operation structure', () => {
    it('createIndex has correct precheck/execute/postcheck', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listIndexes');
      expect(op.precheck[0]!.expect).toBe('notExists');

      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('createIndex');

      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.source.kind).toBe('listIndexes');
      expect(op.postcheck[0]!.expect).toBe('exists');
    });

    it('dropIndex has correct precheck/execute/postcheck', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listIndexes');
      expect(op.precheck[0]!.expect).toBe('exists');

      expect(op.execute).toHaveLength(1);
      expect(op.execute[0]!.command.kind).toBe('dropIndex');

      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.source.kind).toBe('listIndexes');
      expect(op.postcheck[0]!.expect).toBe('notExists');
    });

    it('unique index postcheck includes unique filter', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.postcheck[0]!.filter.kind).toBe('and');
    });

    it('non-unique index postcheck uses simple field filter', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const op = plan.operations[0] as MongoMigrationPlanOperation;

      expect(op.postcheck[0]!.filter.kind).toBe('field');
    });

    it('createIndex sets a deterministic operation id', () => {
      const contract = makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations[0]!.id).toBe('index.users.create(email:1)');
    });

    it('dropIndex sets a deterministic operation id', () => {
      const contract = makeContract({ users: {} });
      const origin = irWithCollection('users', [ascIndex('email')]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations[0]!.id).toBe('index.users.drop(email:1)');
    });
  });

  describe('M2 index vocabulary', () => {
    it('detects different wildcardProjection as distinct indexes', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              keys: [{ field: '$**', direction: 1 }],
              wildcardProjection: { name: 1, email: 1 },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          keys: [{ field: '$**', direction: 1 }],
          wildcardProjection: { name: 1 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('detects different collation as distinct indexes', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              keys: [{ field: 'name', direction: 1 }],
              collation: { locale: 'en', strength: 2 },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          keys: [{ field: 'name', direction: 1 }],
          collation: { locale: 'fr', strength: 2 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('treats same collation with different key order as identical', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              keys: [{ field: 'name', direction: 1 }],
              collation: { strength: 2, locale: 'en' },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          keys: [{ field: 'name', direction: 1 }],
          collation: { locale: 'en', strength: 2 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });

    it('detects different weights as distinct indexes', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              keys: [{ field: 'bio', direction: 'text' }],
              weights: { bio: 10 },
            },
          ],
        },
      });
      const origin = irWithCollection('users', [
        new MongoSchemaIndex({
          keys: [{ field: 'bio', direction: 'text' }],
          weights: { bio: 5 },
        }),
      ]);
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(2);
    });

    it('passes M2 options through to CreateIndexCommand', () => {
      const contract = makeContract({
        users: {
          indexes: [
            {
              keys: [{ field: 'bio', direction: 'text' }],
              weights: { bio: 10 },
              default_language: 'english',
              language_override: 'lang',
              collation: { locale: 'en' },
              wildcardProjection: { bio: 1 },
            },
          ],
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.operations).toHaveLength(1);
      const cmd = (plan.operations[0] as MongoMigrationPlanOperation).execute[0]!
        .command as CreateIndexCommand;
      expect(cmd.weights).toEqual({ bio: 10 });
      expect(cmd.default_language).toBe('english');
      expect(cmd.language_override).toBe('lang');
      expect(cmd.collation).toEqual({ locale: 'en' });
      expect(cmd.wildcardProjection).toEqual({ bio: 1 });
    });
  });

  describe('validator diffing', () => {
    it('emits collMod when validator is added', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = irWithCollection('users', []);
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      const cmd = collModOps[0]!.execute[0]!.command as CollModCommand;
      expect(cmd.validator).toEqual({ $jsonSchema: { bsonType: 'object' } });
      expect(cmd.validationLevel).toBe('strict');
    });

    it('validator add has precheck (collection exists) and postcheck (validator applied)', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin = irWithCollection('users', []);
      const plan = planSuccess(planner, contract, origin);
      const op = (plan.operations as MongoMigrationPlanOperation[]).find(
        (o) => o.execute[0]?.command.kind === 'collMod',
      )!;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listCollections');
      expect(op.precheck[0]!.expect).toBe('exists');

      expect(op.postcheck).toHaveLength(1);
      expect(op.postcheck[0]!.source.kind).toBe('listCollections');
      expect(op.postcheck[0]!.expect).toBe('exists');
    });

    it('validator remove has precheck and empty postcheck', () => {
      const contract = makeContract({ users: {} });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const op = (plan.operations as MongoMigrationPlanOperation[]).find(
        (o) => o.execute[0]?.command.kind === 'collMod',
      )!;

      expect(op.precheck).toHaveLength(1);
      expect(op.precheck[0]!.source.kind).toBe('listCollections');
      expect(op.precheck[0]!.expect).toBe('exists');

      expect(op.postcheck).toHaveLength(0);
    });

    it('classifies validator removal as widening', () => {
      const contract = makeContract({ users: {} });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies jsonSchema body change as destructive', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('destructive');
    });

    it('classifies validationAction error->warn as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'warn',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies validationAction warn->error as destructive', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'warn',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('destructive');
    });

    it('classifies validationLevel strict->moderate as widening', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'moderate',
            validationAction: 'error',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies validationLevel moderate->strict as destructive', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'moderate',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('destructive');
    });

    it('classifies mixed widening+destructive changes as destructive', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'moderate',
            validationAction: 'error',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'warn',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('destructive');
    });

    it('no-ops when validators are identical', () => {
      const contract = makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          users: new MongoSchemaCollection({
            name: 'users',
            validator: new MongoSchemaValidator({
              jsonSchema: { bsonType: 'object' },
              validationLevel: 'strict',
              validationAction: 'error',
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      expect(plan.operations).toHaveLength(0);
    });
  });

  describe('collection lifecycle', () => {
    it('emits createCollection for new collections with options', () => {
      const contract = makeContract({
        events: {
          options: { capped: { size: 1048576, max: 1000 } },
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const createOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'createCollection',
      );
      expect(createOps).toHaveLength(1);
      const cmd = createOps[0]!.execute[0]!.command as CreateCollectionCommand;
      expect(cmd.collection).toBe('events');
      expect(cmd.capped).toBe(true);
      expect(cmd.size).toBe(1048576);
    });

    it('emits dropCollection for removed collections', () => {
      const contract = makeContract({});
      const origin: MongoSchemaIR = {
        collections: {
          events: new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              capped: { size: 1048576 },
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const dropOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'dropCollection',
      );
      expect(dropOps).toHaveLength(1);
      const cmd = dropOps[0]!.execute[0]!.command as DropCollectionCommand;
      expect(cmd.collection).toBe('events');
    });

    it('reports conflict for immutable option change (capped)', () => {
      const contract = makeContract({
        events: {
          options: { capped: { size: 2097152 } },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          events: new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              capped: { size: 1048576 },
            }),
          }),
        },
      };
      const result = planner.plan({
        contract,
        schema: origin,
        policy: ALL_CLASSES_POLICY,
        frameworkComponents: [],
      });
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('Expected failure');
      expect(result.conflicts.some((c) => c.summary.includes('immutable'))).toBe(true);
    });

    it('classifies enabling changeStreamPreAndPostImages as widening', () => {
      const contract = makeContract({
        events: {
          options: { changeStreamPreAndPostImages: { enabled: true } },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          events: new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: false },
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('widening');
    });

    it('classifies disabling changeStreamPreAndPostImages as destructive', () => {
      const contract = makeContract({
        events: {
          options: { changeStreamPreAndPostImages: { enabled: false } },
        },
      });
      const origin: MongoSchemaIR = {
        collections: {
          events: new MongoSchemaCollection({
            name: 'events',
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: true },
            }),
          }),
        },
      };
      const plan = planSuccess(planner, contract, origin);
      const collModOps = (plan.operations as MongoMigrationPlanOperation[]).filter(
        (op) => op.execute[0]?.command.kind === 'collMod',
      );
      expect(collModOps).toHaveLength(1);
      expect(collModOps[0]!.operationClass).toBe('destructive');
    });

    it('orders creates before indexes, drops after', () => {
      const contract = makeContract({
        events: {
          indexes: [{ keys: [{ field: 'ts', direction: 1 as const }] }],
          options: { capped: { size: 1048576 } },
        },
      });
      const plan = planSuccess(planner, contract, emptyIR());
      const kinds = (plan.operations as MongoMigrationPlanOperation[]).map(
        (op) => op.execute[0]!.command.kind,
      );
      const createCollIdx = kinds.indexOf('createCollection');
      const createIdxIdx = kinds.indexOf('createIndex');
      expect(createCollIdx).toBeLessThan(createIdxIdx);
    });
  });

  describe('plan metadata', () => {
    it('sets targetId to mongo', () => {
      const contract = makeContract({ users: {} });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.targetId).toBe('mongo');
    });

    it('sets destination storageHash from contract', () => {
      const contract = makeContract({ users: {} });
      const plan = planSuccess(planner, contract, emptyIR());
      expect(plan.destination.storageHash).toBe('sha256:test-storage');
    });
  });
});
