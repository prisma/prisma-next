import {
  MongoCollationOptions,
  MongoCollection,
  MongoCollectionOptions,
  MongoIndex,
  MongoStorage,
  MongoValidator,
} from '@prisma-next/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoTargetContractSerializer } from '../src/core/mongo-target-contract-serializer';
import { MongoTargetUnspecifiedDatabase } from '../src/core/mongo-target-database';

function makeValidContractJson() {
  return {
    targetFamily: 'mongo',
    roots: { items: 'Item' },
    storage: { collections: { items: {} } },
    models: {
      Item: {
        fields: { _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false } },
        storage: { collection: 'items' },
      },
    },
  };
}

describe('MongoTargetContractSerializer', () => {
  it('deserializes a valid contract into the MongoTarget class hierarchy', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    expect(contract.targetFamily).toBe('mongo');
    expect(contract.storage).toBeInstanceOf(MongoStorage);
  });

  it('default storage carries the __unspecified__ singleton namespace', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    expect(contract.storage.namespaces['__unspecified__']).toBe(
      MongoTargetUnspecifiedDatabase.instance,
    );
  });

  it('hydrates collections into MongoCollection IR-class instances', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    const items = contract.storage.collections['items'];
    expect(items).toBeInstanceOf(MongoCollection);
    expect(items?.kind).toBe('mongo-collection');
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new MongoTargetContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'sql' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract strips runtime-only storage.namespaces from the on-disk envelope', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    const json = serializer.serializeContract(contract) as {
      storage: Record<string, unknown>;
    };
    expect(json.storage).not.toHaveProperty('namespaces');
    expect(json.storage).toHaveProperty('collections');
  });

  describe('JSON round-trip fidelity', () => {
    function makeFullyPopulatedJson() {
      return {
        targetFamily: 'mongo',
        roots: { items: 'Item' },
        storage: {
          collections: {
            items: {
              indexes: [
                {
                  keys: [{ field: 'email', direction: 1 as const }],
                  unique: true,
                  collation: { locale: 'en', strength: 2 },
                },
              ],
              validator: {
                jsonSchema: { type: 'object' },
                validationLevel: 'strict' as const,
                validationAction: 'error' as const,
              },
              options: {
                collation: { locale: 'en', strength: 2 },
                changeStreamPreAndPostImages: { enabled: true },
              },
            },
          },
        },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
          },
        },
      };
    }

    it('deserialised collection carries instanceof for each IR class kind', () => {
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(makeFullyPopulatedJson());

      const items = contract.storage.collections['items'];
      expect(items).toBeInstanceOf(MongoCollection);
      expect(items?.indexes?.[0]).toBeInstanceOf(MongoIndex);
      expect(items?.validator).toBeInstanceOf(MongoValidator);
      expect(items?.options).toBeInstanceOf(MongoCollectionOptions);
      expect(items?.options?.collation).toBeInstanceOf(MongoCollationOptions);
    });

    it('serialise(deserialise(json)) produces canonically equivalent JSON', () => {
      const json = makeFullyPopulatedJson();
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(json);
      const out = serializer.serializeContract(contract);

      const reparsed = JSON.parse(JSON.stringify(out));
      const collections = reparsed.storage.collections;
      // IR-class kind discriminators are now present in the serialised
      // JSON envelope; that's the on-disk shape going forward.
      expect(collections.items.kind).toBe('mongo-collection');
      expect(collections.items.indexes[0].kind).toBe('mongo-index');
      expect(collections.items.validator.kind).toBe('mongo-validator');
      expect(collections.items.options.kind).toBe('mongo-collection-options');
      expect(collections.items.options.collation.kind).toBe('mongo-collation-options');

      // Re-deserialising the emitted JSON yields the same class identity.
      const roundtripped = serializer.deserializeContract(reparsed);
      expect(roundtripped.storage.collections['items']).toBeInstanceOf(MongoCollection);
    });
  });
});
