import type { MongoContract, MongoStorageCollection } from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { verifyMongoSchema } from '../src/core/schema-verify/verify-mongo-schema';

function buildContract(
  collections: Record<string, MongoStorageCollection>,
  overrides?: Partial<MongoContract>,
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    models: {},
    storage: {
      storageHash: 'sha256:test',
      collections,
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: 'sha256:profile',
    meta: {},
    ...overrides,
  };
}

function ir(collections: MongoSchemaCollection[]): MongoSchemaIR {
  return new MongoSchemaIR(collections);
}

function coll(
  name: string,
  opts?: {
    indexes?: MongoSchemaIndex[];
    validator?: MongoSchemaValidator;
    options?: MongoSchemaCollectionOptions;
  },
): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: opts?.indexes ?? [],
    ...(opts?.validator ? { validator: opts.validator } : {}),
    ...(opts?.options ? { options: opts.options } : {}),
  });
}

function idx(
  keys: Array<{ field: string; direction: 1 | -1 }>,
  opts?: { unique?: boolean },
): MongoSchemaIndex {
  return new MongoSchemaIndex({ keys, ...opts });
}

describe('verifyMongoSchema', () => {
  describe('happy path', () => {
    it('passes for an empty contract against an empty live schema', () => {
      const result = verifyMongoSchema({
        contract: buildContract({}),
        schema: ir([]),
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.code).toBeUndefined();
      expect(result.schema.issues).toEqual([]);
      expect(result.schema.counts.fail).toBe(0);
      expect(result.contract.storageHash).toBe('sha256:test');
      expect(result.contract.profileHash).toBe('sha256:profile');
      expect(result.target.expected).toBe('mongo');
      expect(result.meta?.strict).toBe(true);
      expect(typeof result.timings.total).toBe('number');
    });

    it('passes when live schema mirrors the contract', () => {
      const contract = buildContract({
        users: {
          indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
        },
      });
      const liveSchema = ir([
        coll('users', {
          indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })],
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toEqual([]);
      expect(result.schema.counts.fail).toBe(0);
    });
  });

  describe('drift detection', () => {
    it('fails when a contract collection is missing from the live schema', () => {
      const result = verifyMongoSchema({
        contract: buildContract({ users: { indexes: [] } }),
        schema: ir([]),
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('PN-RUN-3010');
      expect(result.schema.counts.fail).toBeGreaterThan(0);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'missing_table', table: 'users' }),
      );
    });

    it('fails when a contract index is missing from a live collection', () => {
      const contract = buildContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const liveSchema = ir([coll('users')]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('PN-RUN-3010');
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'index_mismatch', table: 'users' }),
      );
    });

    it('fails on an extra live index in strict mode', () => {
      const contract = buildContract({ users: { indexes: [] } });
      const liveSchema = ir([
        coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.counts.fail).toBeGreaterThan(0);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'extra_index', table: 'users' }),
      );
    });

    it('warns (without failing) on an extra live index in non-strict mode', () => {
      const contract = buildContract({ users: { indexes: [] } });
      const liveSchema = ir([
        coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: false,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.code).toBeUndefined();
      expect(result.schema.counts.fail).toBe(0);
      expect(result.schema.counts.warn).toBeGreaterThan(0);
      expect(result.meta?.strict).toBe(false);
    });

    it('fails when the contract requires a validator that the live schema does not have', () => {
      const contract = buildContract({
        users: {
          indexes: [],
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const liveSchema = ir([coll('users')]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'type_missing', table: 'users' }),
      );
    });

    it('fails on an extra live validator in strict mode', () => {
      const contract = buildContract({ users: { indexes: [] } });
      const liveSchema = ir([
        coll('users', {
          validator: new MongoSchemaValidator({
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'extra_validator', table: 'users' }),
      );
    });

    it('fails when the validator differs between contract and live schema', () => {
      const contract = buildContract({
        users: {
          indexes: [],
          validator: {
            jsonSchema: { bsonType: 'object', required: ['email'] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const liveSchema = ir([
        coll('users', {
          validator: new MongoSchemaValidator({
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'type_mismatch', table: 'users' }),
      );
    });

    it('fails on collection-options mismatches', () => {
      const contract = buildContract({
        events: {
          indexes: [],
          options: { capped: { size: 1024 } },
        },
      });
      const liveSchema = ir([
        coll('events', {
          options: new MongoSchemaCollectionOptions({ capped: { size: 2048 } }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'type_mismatch', table: 'events' }),
      );
    });
  });

  describe('envelope', () => {
    it('threads context.contractPath and context.configPath into meta', () => {
      const result = verifyMongoSchema({
        contract: buildContract({}),
        schema: ir([]),
        strict: true,
        frameworkComponents: [],
        context: { contractPath: '/tmp/contract.json', configPath: '/tmp/cfg.ts' },
      });

      expect(result.meta?.contractPath).toBe('/tmp/contract.json');
      expect(result.meta?.configPath).toBe('/tmp/cfg.ts');
      expect(result.meta?.strict).toBe(true);
    });

    it('omits profileHash when the contract has no profileHash', () => {
      const contract = buildContract({}, { profileHash: '' });
      const result = verifyMongoSchema({
        contract,
        schema: ir([]),
        strict: false,
        frameworkComponents: [],
      });

      expect(result.contract.profileHash).toBeUndefined();
    });
  });
});
