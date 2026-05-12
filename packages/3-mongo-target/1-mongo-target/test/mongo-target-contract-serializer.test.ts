import { describe, expect, it } from 'vitest';
import { MongoTargetContractSerializer } from '../src/core/mongo-target-contract-serializer';
import { MongoTargetUnspecifiedDatabase } from '../src/core/mongo-target-database';
import { MongoTargetStorage } from '../src/core/mongo-target-storage';

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
    expect(contract.storage).toBeInstanceOf(MongoTargetStorage);
  });

  it('default storage carries the __unspecified__ singleton namespace', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    expect(contract.storage.namespaces['__unspecified__']).toBe(
      MongoTargetUnspecifiedDatabase.instance,
    );
  });

  it('preserves the original (flat-data) collections shape until M2 R2', () => {
    const json = makeValidContractJson();
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(json);

    expect(contract.storage.collections).toEqual(json.storage.collections);
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new MongoTargetContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'sql' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract is identity over the contract envelope', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    expect(serializer.serializeContract(contract)).toBe(contract);
  });
});
