import type { MongoContract, MongoStorageCollection } from '@prisma-next/mongo-contract';
import { describe, expect, it } from 'vitest';
import { contractToMongoSchemaIR } from '../src/core/contract-to-schema';

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

describe('contractToMongoSchemaIR', () => {
  it('returns empty IR for null contract', () => {
    const ir = contractToMongoSchemaIR(null);
    expect(ir.collections).toEqual({});
  });

  it('converts empty collection (no indexes)', () => {
    const ir = contractToMongoSchemaIR(makeContract({ users: {} }));
    expect(ir.collections['users']).toBeDefined();
    expect(ir.collections['users']!.name).toBe('users');
    expect(ir.collections['users']!.indexes).toEqual([]);
  });

  it('converts collection with one ascending index', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ fields: { email: 1 } }],
        },
      }),
    );
    const coll = ir.collections['users']!;
    expect(coll.indexes).toHaveLength(1);
    expect(coll.indexes[0]!.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(coll.indexes[0]!.unique).toBe(false);
  });

  it('converts collection with unique index', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ fields: { email: 1 }, options: { unique: true } }],
        },
      }),
    );
    const idx = ir.collections['users']!.indexes[0]!;
    expect(idx.unique).toBe(true);
  });

  it('converts multiple collections', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: { indexes: [{ fields: { email: 1 } }] },
        posts: { indexes: [{ fields: { title: 1 } }] },
      }),
    );
    expect(Object.keys(ir.collections)).toHaveLength(2);
    expect(ir.collections['users']).toBeDefined();
    expect(ir.collections['posts']).toBeDefined();
  });

  it('preserves sparse option', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ fields: { nickname: 1 }, options: { sparse: true } }],
        },
      }),
    );
    expect(ir.collections['users']!.indexes[0]!.sparse).toBe(true);
  });

  it('preserves TTL option', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ fields: { createdAt: 1 }, options: { expireAfterSeconds: 3600 } }],
        },
      }),
    );
    expect(ir.collections['users']!.indexes[0]!.expireAfterSeconds).toBe(3600);
  });

  it('preserves partialFilterExpression', () => {
    const pfe = { active: { $eq: true } };
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ fields: { status: 1 }, options: { partialFilterExpression: pfe } }],
        },
      }),
    );
    expect(ir.collections['users']!.indexes[0]!.partialFilterExpression).toEqual(pfe);
  });

  it('converts compound index', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            {
              fields: { email: 1, tenantId: 1 },
              options: { unique: true },
            },
          ],
        },
      }),
    );
    const idx = ir.collections['users']!.indexes[0]!;
    expect(idx.keys).toHaveLength(2);
    expect(idx.keys[0]!.field).toBe('email');
    expect(idx.keys[1]!.field).toBe('tenantId');
    expect(idx.unique).toBe(true);
  });

  it('preserves M2 index options (weights, default_language, language_override, collation, wildcardProjection)', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            {
              keys: [{ field: 'bio', direction: 'text' as const }],
              weights: { bio: 10 },
              default_language: 'english',
              language_override: 'lang',
              collation: { locale: 'en', strength: 2 },
            },
            {
              keys: [{ field: '$**', direction: 1 as const }],
              wildcardProjection: { name: 1 as const, email: 1 as const },
            },
          ],
        },
      }),
    );
    const textIdx = ir.collections['users']!.indexes[0]!;
    expect(textIdx.weights).toEqual({ bio: 10 });
    expect(textIdx.default_language).toBe('english');
    expect(textIdx.language_override).toBe('lang');
    expect(textIdx.collation).toEqual({ locale: 'en', strength: 2 });

    const wildcardIdx = ir.collections['users']!.indexes[1]!;
    expect(wildcardIdx.wildcardProjection).toEqual({ name: 1, email: 1 });
  });

  it('converts collection with validator', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      }),
    );
    const coll = ir.collections['users']!;
    expect(coll.validator).toBeDefined();
    expect(coll.validator!.jsonSchema).toEqual({
      bsonType: 'object',
      properties: { name: { bsonType: 'string' } },
    });
    expect(coll.validator!.validationLevel).toBe('strict');
    expect(coll.validator!.validationAction).toBe('error');
  });

  it('converts collection with options', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        events: {
          options: {
            capped: { size: 1048576, max: 1000 },
            collation: { locale: 'en' },
            changeStreamPreAndPostImages: { enabled: true },
            clusteredIndex: { name: 'myCluster' },
          },
        },
      }),
    );
    const coll = ir.collections['events']!;
    expect(coll.options).toBeDefined();
    expect(coll.options!.capped).toEqual({ size: 1048576, max: 1000 });
    expect(coll.options!.collation).toEqual({ locale: 'en' });
    expect(coll.options!.changeStreamPreAndPostImages).toEqual({ enabled: true });
    expect(coll.options!.clusteredIndex).toEqual({ name: 'myCluster' });
  });

  it('converts collection with timeseries options', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        metrics: {
          options: {
            timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'hours' },
          },
        },
      }),
    );
    const coll = ir.collections['metrics']!;
    expect(coll.options!.timeseries).toEqual({
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'hours',
    });
  });

  it('collection without validator or options has undefined for both', () => {
    const ir = contractToMongoSchemaIR(makeContract({ users: {} }));
    expect(ir.collections['users']!.validator).toBeUndefined();
    expect(ir.collections['users']!.options).toBeUndefined();
  });
});
