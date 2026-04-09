import type { MongoContract } from '@prisma-next/mongo-contract';
import { describe, expect, it } from 'vitest';
import { contractToMongoSchemaIR } from '../src/core/contract-to-schema';

function makeContract(
  collections: Record<string, { indexes?: ReadonlyArray<Record<string, unknown>> }>,
): MongoContract {
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
          indexes: [{ keys: [{ field: 'email', direction: 1 }] }],
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
          indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
        },
      }),
    );
    const idx = ir.collections['users']!.indexes[0]!;
    expect(idx.unique).toBe(true);
  });

  it('converts multiple collections', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
        posts: { indexes: [{ keys: [{ field: 'title', direction: 1 }] }] },
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
          indexes: [{ keys: [{ field: 'nickname', direction: 1 }], sparse: true }],
        },
      }),
    );
    expect(ir.collections['users']!.indexes[0]!.sparse).toBe(true);
  });

  it('preserves TTL option', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ keys: [{ field: 'createdAt', direction: 1 }], expireAfterSeconds: 3600 }],
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
          indexes: [{ keys: [{ field: 'status', direction: 1 }], partialFilterExpression: pfe }],
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
              keys: [
                { field: 'email', direction: 1 },
                { field: 'tenantId', direction: 1 },
              ],
              unique: true,
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
});
