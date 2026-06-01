import type { MongoContract } from '@prisma-next/mongo-contract';
import type { JsonObject } from '@prisma-next/utils/json';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializerBase } from '../src/core/ir/mongo-contract-serializer-base';
import { mongoContractJson } from './mongo-contract-json-fixture';

function makeValidContractJson() {
  return mongoContractJson({});
}

interface Wrapped {
  readonly contract: MongoContract;
}

class RecordingSerializer extends MongoContractSerializerBase<Wrapped> {
  readonly constructed: unknown[] = [];

  protected constructTargetContract(validated: unknown): Wrapped {
    this.constructed.push(validated);
    return { contract: validated as MongoContract };
  }
}

describe('MongoContractSerializerBase', () => {
  describe('parseMongoContractStructure (family-shared structural + domain validation)', () => {
    it('accepts a structurally-valid contract envelope', () => {
      const serializer = new RecordingSerializer();
      const json = makeValidContractJson();

      const result = serializer.deserializeContract(json);

      expect(result.contract.targetFamily).toBe('mongo');
      expect(result.contract.domain.namespaces.__unbound__!.models['Item']).toBeDefined();
    });

    it('rejects non-Mongo targetFamily', () => {
      const serializer = new RecordingSerializer();
      const json = { ...makeValidContractJson(), targetFamily: 'sql' };

      expect(() => serializer.deserializeContract(json)).toThrow();
    });

    it('rejects when a model references a collection that does not exist in storage', () => {
      const serializer = new RecordingSerializer();
      const json = mongoContractJson({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'missing_collection' },
          },
        },
      });

      expect(() => serializer.deserializeContract(json)).toThrow(/missing_collection/);
    });

    it('rejects when a field references a value object that does not exist', () => {
      const serializer = new RecordingSerializer();
      const json = mongoContractJson({
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              data: { type: { kind: 'valueObject', name: 'Missing' }, nullable: false },
            },
            storage: { collection: 'items' },
          },
        },
      });

      expect(() => serializer.deserializeContract(json)).toThrow();
    });

    it('only invokes constructTargetContract after structural + domain validation passes', () => {
      const serializer = new RecordingSerializer();
      const json = { ...makeValidContractJson(), targetFamily: 'sql' };

      try {
        serializer.deserializeContract(json);
      } catch {
        // expected
      }

      expect(serializer.constructed).toHaveLength(0);
    });
  });

  describe('constructTargetContract hook', () => {
    it('receives the validated contract value', () => {
      const serializer = new RecordingSerializer();

      serializer.deserializeContract(makeValidContractJson());

      expect(serializer.constructed).toHaveLength(1);
      const validated = serializer.constructed[0] as MongoContract;
      expect(validated.targetFamily).toBe('mongo');
    });
  });

  describe('serializeContract (default identity)', () => {
    it('returns the contract value as a JsonObject without copying', () => {
      const serializer = new RecordingSerializer();
      const wrapped: Wrapped = { contract: makeValidContractJson() as unknown as MongoContract };

      const serialized: JsonObject = serializer.serializeContract(wrapped);

      expect(serialized).toBe(wrapped as unknown as JsonObject);
    });
  });
});
