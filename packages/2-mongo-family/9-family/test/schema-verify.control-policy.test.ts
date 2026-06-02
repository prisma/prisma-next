import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { MongoCollection, type MongoContract } from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { verifyMongoSchema } from '../src/core/schema-verify/verify-mongo-schema';

function buildContract(
  collections: Record<string, { control?: 'managed' | 'tolerated' | 'external' | 'observed' }>,
  defaultControl?: 'managed' | 'tolerated' | 'external' | 'observed',
): MongoContract {
  const built: Record<string, MongoCollection> = {};
  for (const [name, data] of Object.entries(collections)) {
    built[name] = new MongoCollection({
      indexes: [],
      ...(data.control !== undefined ? { control: data.control } : {}),
    });
  }
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    models: {},
    storage: {
      storageHash: 'sha256:test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          collections: built,
        },
      },
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: 'sha256:profile',
    meta: {},
    ...(defaultControl !== undefined ? { defaultControl } : {}),
  } as unknown as MongoContract;
}

function idx(keys: Array<{ field: string; direction: 1 | -1 }>): MongoSchemaIndex {
  return new MongoSchemaIndex({ keys });
}

describe('verifyMongoSchema control policy', () => {
  it('fails missing declared collection under tolerated', () => {
    const contract = buildContract({ items: { control: 'tolerated' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR([]),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'missing_table', table: 'items' }),
    );
  });

  it('suppresses extra indexes under external', () => {
    const contract = buildContract({ items: { control: 'external' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'items',
          indexes: [idx([{ field: 'extra', direction: 1 }])],
        }),
      ]),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(true);
    expect(result.schema.issues.some((i) => i.kind === 'extra_index')).toBe(false);
  });

  it('downgrades drift to warn under observed', () => {
    const contract = buildContract({ items: { control: 'observed' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'items',
          indexes: [idx([{ field: 'extra', direction: 1 }])],
        }),
      ]),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(true);
    expect(result.schema.counts.fail).toBe(0);
    expect(result.schema.counts.warn).toBeGreaterThan(0);
  });
});
