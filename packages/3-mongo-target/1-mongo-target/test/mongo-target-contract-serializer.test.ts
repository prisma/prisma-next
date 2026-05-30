import { getStorageNamespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  MongoCollationOptions,
  MongoCollection,
  MongoCollectionOptions,
  MongoIndex,
  type MongoNamespaceShape,
  MongoStorage,
  MongoValidator,
} from '@prisma-next/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoTargetContractSerializer } from '../src/core/mongo-target-contract-serializer';
import { MongoTargetUnboundDatabase } from '../src/core/mongo-target-database';

function makeSingletonUnboundContractJson() {
  return {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    profileHash: 'sha256:test',
    roots: {},
    storage: {
      storageHash: 'sha256:test',
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'mongo-database',
        collections: {},
      },
    },
    models: {},
  };
}

function makeValidContractJson() {
  return {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    profileHash: 'sha256:test',
    roots: { items: { model: 'Item', namespace: UNBOUND_NAMESPACE_ID } },
    storage: {
      storageHash: 'sha256:test',
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'mongo-database',
        collections: {
          items: {},
        },
      },
    },
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

  it('default storage carries the __unbound__ singleton namespace', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeSingletonUnboundContractJson());

    expect(getStorageNamespace(contract.storage, '__unbound__')).toBe(
      MongoTargetUnboundDatabase.instance,
    );
  });

  it('hydrates collections into MongoCollection IR-class instances', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    const items = (
      getStorageNamespace(contract.storage, UNBOUND_NAMESPACE_ID) as MongoNamespaceShape | undefined
    )?.collections['items'];
    expect(items).toBeInstanceOf(MongoCollection);
    expect(items?.kind).toBe('mongo-collection');
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new MongoTargetContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'sql' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract emits flat namespace keys on disk', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    const json = serializer.serializeContract(contract) as {
      storage: Record<string, unknown>;
    };
    expect(json.storage).toHaveProperty(UNBOUND_NAMESPACE_ID);
    expect(json.storage).not.toHaveProperty('namespaces');
    expect(json.storage).not.toHaveProperty('collections');
    const namespace = json.storage[UNBOUND_NAMESPACE_ID] as {
      collections: Record<string, unknown>;
    };
    expect(namespace.collections['items']).toMatchObject({
      kind: 'mongo-collection',
    });
  });

  describe('JSON round-trip fidelity', () => {
    function makeFullyPopulatedJson() {
      return {
        targetFamily: 'mongo' as const,
        target: 'mongo',
        profileHash: 'sha256:test',
        roots: { items: { model: 'Item', namespace: UNBOUND_NAMESPACE_ID } },
        storage: {
          storageHash: 'sha256:test',
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'mongo-database',
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

      const items = (
        getStorageNamespace(contract.storage, UNBOUND_NAMESPACE_ID) as
          | MongoNamespaceShape
          | undefined
      )?.collections['items'];
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
      const items = (
        getStorageNamespace(reparsed.storage, UNBOUND_NAMESPACE_ID) as MongoNamespaceShape
      ).collections['items'];
      expect(items).toBeDefined();
      expect(items!.kind).toBe('mongo-collection');
      expect(items!.indexes![0]!.kind).toBe('mongo-index');
      expect(items!.validator!.kind).toBe('mongo-validator');
      expect(items!.options!.kind).toBe('mongo-collection-options');
      expect(items!.options!.collation!.kind).toBe('mongo-collation-options');

      const roundtripped = serializer.deserializeContract(reparsed);
      expect(
        (
          getStorageNamespace(roundtripped.storage, UNBOUND_NAMESPACE_ID) as
            | MongoNamespaceShape
            | undefined
        )?.collections['items'],
      ).toBeInstanceOf(MongoCollection);
    });
  });
});
