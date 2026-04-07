import { coreHash, profileHash } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import type { MongoContract } from '../src/contract-types';
import { validateMongoStorage } from '../src/validate-storage';

const DUMMY_HASH = coreHash('sha256:test');

function makeMinimalContract(overrides: Partial<MongoContract> = {}): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: { items: 'Item' },
    storage: { storageHash: DUMMY_HASH, collections: { items: {} } },
    models: {
      Item: {
        fields: { _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false } },
        storage: { collection: 'items' },
        relations: {},
      },
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: profileHash('sha256:test'),
    meta: {},
    ...overrides,
  };
}

describe('validateMongoStorage()', () => {
  it('accepts a valid contract', () => {
    expect(() => validateMongoStorage(makeMinimalContract())).not.toThrow();
  });

  describe('embed relation targets', () => {
    it('rejects embed target with a collection', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: {
              collection: 'items',
              relations: { tags: { field: 'tags' } },
            },
            relations: {
              tags: { to: 'Tag', cardinality: '1:N' as const },
            },
          },
          Tag: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'tags' },
            relations: {},
            owner: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(/embed.*Tag.*must not.*collection/i);
    });

    it('rejects embed target owned by a different model', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              tags: { to: 'Tag', cardinality: '1:N' as const },
            },
          },
          Other: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {},
          },
          Tag: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: {},
            relations: {},
            owner: 'Other',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /embed.*tags.*Tag.*owned by.*Other.*not.*Item/i,
      );
    });

    it('accepts embed target with empty storage', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: {
              collection: 'items',
              relations: { tags: { field: 'tags' } },
            },
            relations: {
              tags: { to: 'Tag', cardinality: '1:N' as const },
            },
          },
          Tag: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: {},
            relations: {},
            owner: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('reference relation field existence', () => {
    it('rejects reference relation with localFields not in source model', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1' as const,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          },
          User: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
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
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              ownerId: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1' as const,
                on: { localFields: ['ownerId'], targetFields: ['userId'] },
              },
            },
          },
          User: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
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
      const contract = makeMinimalContract({
        storage: { storageHash: DUMMY_HASH, collections: { items: {}, users: {} } },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              ownerId: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              owner: {
                to: 'User',
                cardinality: 'N:1' as const,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          },
          User: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
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
      const contract = makeMinimalContract({
        storage: { storageHash: DUMMY_HASH, collections: { items: {}, other: {} } },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {},
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          },
          SpecialItem: {
            fields: {
              extra: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'other' },
            relations: {},
            base: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /multi-table inheritance.*variant.*SpecialItem.*must share.*base.*collection/i,
      );
    });

    it('accepts variant with same collection as its base', () => {
      const contract = makeMinimalContract({
        storage: { storageHash: DUMMY_HASH, collections: { items: {} } },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {},
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          },
          SpecialItem: {
            fields: {
              extra: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
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
      const contract = makeMinimalContract({
        storage: { storageHash: DUMMY_HASH, collections: {} },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
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
