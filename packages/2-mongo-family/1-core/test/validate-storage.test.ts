import { describe, expect, it } from 'vitest';
import type { MongoContract } from '../src/contract-types';
import { validateMongoStorage } from '../src/validate-storage';

function minimalContract(overrides: Partial<MongoContract> = {}): MongoContract {
  return {
    targetFamily: 'mongo',
    roots: { items: 'Item' },
    storage: { collections: { items: {} } },
    models: {
      Item: {
        fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
        storage: { collection: 'items' },
        relations: {},
      },
    },
    ...overrides,
  };
}

describe('validateMongoStorage()', () => {
  it('accepts a valid contract', () => {
    expect(() => validateMongoStorage(minimalContract())).not.toThrow();
  });

  describe('embed relation targets', () => {
    it('rejects embed target with a collection', () => {
      const contract = minimalContract({
        models: {
          Item: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {
              tags: {
                to: 'Tag',
                cardinality: '1:N' as const,
                strategy: 'embed' as const,
                field: 'tags',
              },
            },
          },
          Tag: {
            fields: { name: { codecId: 'mongo/string@1', nullable: false } },
            storage: { collection: 'tags' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(/embed.*Tag.*must not.*collection/i);
    });

    it('accepts embed target with empty storage', () => {
      const contract = minimalContract({
        models: {
          Item: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {
              tags: {
                to: 'Tag',
                cardinality: '1:N' as const,
                strategy: 'embed' as const,
                field: 'tags',
              },
            },
          },
          Tag: {
            fields: { name: { codecId: 'mongo/string@1', nullable: false } },
            storage: {},
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('reference relation field existence', () => {
    it('rejects reference relation with localFields not in source model', () => {
      const contract = minimalContract({
        models: {
          Item: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1' as const,
                strategy: 'reference' as const,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          },
          User: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'users' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /localField.*ownerId.*not.*field.*Item/i,
      );
    });

    it('rejects reference relation with targetFields not in target model', () => {
      const contract = minimalContract({
        models: {
          Item: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              ownerId: { codecId: 'mongo/objectId@1', nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1' as const,
                strategy: 'reference' as const,
                on: { localFields: ['ownerId'], targetFields: ['userId'] },
              },
            },
          },
          User: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'users' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /targetField.*userId.*not.*field.*User/i,
      );
    });

    it('accepts reference relation with valid fields', () => {
      const contract = minimalContract({
        storage: { collections: { items: {}, users: {} } },
        models: {
          Item: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              ownerId: { codecId: 'mongo/objectId@1', nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1' as const,
                strategy: 'reference' as const,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          },
          User: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'users' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('variant collection must match base', () => {
    it('rejects variant with a different collection than its base', () => {
      const contract = minimalContract({
        storage: { collections: { items: {}, other: {} } },
        models: {
          Item: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              type: { codecId: 'mongo/string@1', nullable: false },
            },
            storage: { collection: 'items' },
            relations: {},
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          },
          SpecialItem: {
            fields: { extra: { codecId: 'mongo/string@1', nullable: false } },
            storage: { collection: 'other' },
            relations: {},
            base: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /variant.*SpecialItem.*collection.*other.*base.*Item.*collection.*items.*must match/i,
      );
    });

    it('accepts variant with same collection as its base', () => {
      const contract = minimalContract({
        storage: { collections: { items: {} } },
        models: {
          Item: {
            fields: {
              _id: { codecId: 'mongo/objectId@1', nullable: false },
              type: { codecId: 'mongo/string@1', nullable: false },
            },
            storage: { collection: 'items' },
            relations: {},
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          },
          SpecialItem: {
            fields: { extra: { codecId: 'mongo/string@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {},
            base: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('collection-model consistency', () => {
    it('rejects model referencing a collection not in storage.collections', () => {
      const contract = minimalContract({
        storage: { collections: {} },
        models: {
          Item: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /model.*Item.*collection.*items.*not.*storage/i,
      );
    });
  });
});
