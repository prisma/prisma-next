import { describe, expect, it } from 'vitest';
import ormContractJson from '../../5-runtime/test/fixtures/orm-contract.json';
import { validateMongoContract } from '../src/validate';

function validContractJson() {
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
  };
}

describe('validateMongoContract()', () => {
  describe('structural validation', () => {
    it('rejects non-object input', () => {
      expect(() => validateMongoContract('not an object')).toThrow(/structural/i);
    });

    it('rejects missing targetFamily', () => {
      const json = validContractJson();
      // biome-ignore lint/performance/noDelete: test needs to remove a property
      delete (json as Record<string, unknown>).targetFamily;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects wrong targetFamily', () => {
      const json = { ...validContractJson(), targetFamily: 'sql' };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects model with invalid field shape', () => {
      const json = {
        ...validContractJson(),
        models: {
          Item: {
            fields: { _id: { codecId: 123 } },
            storage: { collection: 'items' },
            relations: {},
          },
        },
      };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects relation with invalid strategy', () => {
      const json = {
        ...validContractJson(),
        models: {
          Item: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {
              bad: { to: 'Other', cardinality: '1:1', strategy: 'magic' },
            },
          },
        },
      };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects unexpected top-level properties', () => {
      const json = { ...validContractJson(), extra: true };
      expect(() => validateMongoContract(json)).toThrow();
    });
  });

  describe('domain validation passthrough', () => {
    it('rejects dangling root reference', () => {
      const json = {
        ...validContractJson(),
        roots: { items: 'Item', ghosts: 'Ghost' },
      };
      expect(() => validateMongoContract(json)).toThrow(/Ghost.*not exist/i);
    });
  });

  describe('storage validation passthrough', () => {
    it('rejects embed target with collection', () => {
      const json = {
        targetFamily: 'mongo',
        roots: { items: 'Item' },
        storage: { collections: { items: {}, tags: {} } },
        models: {
          Item: {
            fields: { _id: { codecId: 'mongo/objectId@1', nullable: false } },
            storage: { collection: 'items' },
            relations: {
              tags: { to: 'Tag', cardinality: '1:N', strategy: 'embed', field: 'tags' },
            },
          },
          Tag: {
            fields: { name: { codecId: 'mongo/string@1', nullable: false } },
            storage: { collection: 'tags' },
            relations: {},
          },
        },
      };
      expect(() => validateMongoContract(json)).toThrow(/embed.*Tag.*collection/i);
    });
  });

  describe('computed indices', () => {
    it('builds variantToBase map', () => {
      const result = validateMongoContract(ormContractJson);
      expect(result.indices.variantToBase).toEqual({
        Bug: 'Task',
        Feature: 'Task',
      });
    });

    it('builds modelToVariants map', () => {
      const result = validateMongoContract(ormContractJson);
      expect(result.indices.modelToVariants).toEqual({
        Task: ['Bug', 'Feature'],
      });
    });
  });

  describe('happy path', () => {
    it('validates the ORM test contract', () => {
      const result = validateMongoContract(ormContractJson);
      expect(result.contract).toBeDefined();
      expect(result.warnings).toHaveLength(0);
      expect(result.indices.variantToBase).toBeDefined();
      expect(result.indices.modelToVariants).toBeDefined();
    });

    it('returns typed contract', () => {
      const result = validateMongoContract(validContractJson());
      expect(result.contract.targetFamily).toBe('mongo');
      expect(result.contract.roots).toEqual({ items: 'Item' });
    });
  });
});
