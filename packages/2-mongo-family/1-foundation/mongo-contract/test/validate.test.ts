import { describe, expect, it } from 'vitest';
import { validateMongoContract } from '../src/validate-mongo-contract';
import ormContractJson from './fixtures/orm-contract.json';

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

describe('validateMongoContract()', () => {
  describe('structural validation', () => {
    it('rejects non-object input', () => {
      expect(() => validateMongoContract('not an object')).toThrow(/structural/i);
    });

    it('rejects missing targetFamily', () => {
      const json = makeValidContractJson();
      delete (json as Record<string, unknown>)['targetFamily'];
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects wrong targetFamily', () => {
      const json = { ...makeValidContractJson(), targetFamily: 'sql' };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects model with invalid field shape', () => {
      const json = {
        ...makeValidContractJson(),
        models: {
          Item: {
            fields: { _id: { type: { kind: 'scalar', codecId: 123 } } },
            storage: { collection: 'items' },
          },
        },
      };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects relation with unexpected property', () => {
      const json = {
        ...makeValidContractJson(),
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: { collection: 'items' },
            relations: {
              bad: { to: 'Other', cardinality: '1:1', extra: true },
            },
          },
        },
      };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects unexpected top-level properties', () => {
      const json = { ...makeValidContractJson(), extra: true };
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('accepts collection indexes', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              indexes: [
                {
                  keys: [{ field: '_id', direction: 1 }],
                  unique: true,
                },
                { keys: [{ field: 'name', direction: 'text' }] },
              ],
            },
          },
        },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'items' },
          },
        },
      };

      const result = validateMongoContract(json);

      expect(result.contract.storage.collections['items']).toEqual({
        indexes: [
          {
            keys: [{ field: '_id', direction: 1 }],
            unique: true,
          },
          { keys: [{ field: 'name', direction: 'text' }] },
        ],
      });
    });

    it('rejects empty index keys array', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              indexes: [{ keys: [] }],
            },
          },
        },
      };

      expect(() => validateMongoContract(json)).toThrow();
    });

    it('accepts collection options', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              options: {
                capped: { size: 4096, max: 100 },
                collation: { locale: 'en', strength: 2 },
                changeStreamPreAndPostImages: { enabled: true },
                timeseries: {
                  timeField: 'createdAt',
                  granularity: 'hours',
                },
                clusteredIndex: {
                  name: '_id_',
                },
              },
            },
          },
        },
      };

      const result = validateMongoContract(json);

      expect(result.contract.storage.collections['items']).toEqual({
        options: {
          capped: { size: 4096, max: 100 },
          collation: { locale: 'en', strength: 2 },
          changeStreamPreAndPostImages: { enabled: true },
          timeseries: {
            timeField: 'createdAt',
            granularity: 'hours',
          },
          clusteredIndex: {
            name: '_id_',
          },
        },
      });
    });

    it('accepts record-shaped index partialFilterExpression', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              indexes: [
                {
                  keys: [{ field: 'name', direction: 'text' }],
                  partialFilterExpression: {
                    archived: false,
                    $or: [{ status: 'active' }, { tags: ['priority', 'searchable'] }],
                  },
                },
              ],
            },
          },
        },
        models: {
          Item: {
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'items' },
          },
        },
      };

      const result = validateMongoContract(json);

      expect(result.contract.storage.collections['items']).toEqual({
        indexes: [
          {
            keys: [{ field: 'name', direction: 'text' }],
            partialFilterExpression: {
              archived: false,
              $or: [{ status: 'active' }, { tags: ['priority', 'searchable'] }],
            },
          },
        ],
      });
    });

    it('rejects unknown collection option properties', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              options: {
                unsupported: true,
              },
            },
          },
        },
      };

      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects unknown index option keys', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              indexes: [{ keys: [{ field: '_id', direction: 1 }], unsupported: true }],
            },
          },
        },
      };

      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects invalid collection option values', () => {
      const json = {
        ...makeValidContractJson(),
        storage: {
          collections: {
            items: {
              options: {
                timeseries: {
                  timeField: 'createdAt',
                  granularity: 'days',
                },
              },
            },
          },
        },
      };

      expect(() => validateMongoContract(json)).toThrow();
    });
  });

  describe('domain validation passthrough', () => {
    it('rejects dangling root reference', () => {
      const json = {
        ...makeValidContractJson(),
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
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            storage: {
              collection: 'items',
              relations: { tags: { field: 'tags' } },
            },
            relations: {
              tags: { to: 'Tag', cardinality: '1:N' },
            },
          },
          Tag: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            storage: { collection: 'tags' },
            owner: 'Item',
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

  describe('storage index validation', () => {
    it('accepts collection with no indexes', () => {
      const result = validateMongoContract(makeValidContractJson());
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with valid indexes', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [
          { keys: [{ field: 'name', direction: 1 }] },
          { keys: [{ field: 'email', direction: 1 }], unique: true },
          {
            keys: [{ field: 'createdAt', direction: -1 }],
            sparse: true,
            expireAfterSeconds: 3600,
          },
          {
            keys: [
              { field: 'a', direction: 1 },
              { field: 'b', direction: -1 },
            ],
          },
          { keys: [{ field: 'description', direction: 'text' }] },
          { keys: [{ field: 'location', direction: '2dsphere' }] },
          { keys: [{ field: 'coords', direction: '2d' }] },
          { keys: [{ field: 'hash', direction: 'hashed' }] },
        ],
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts index with partialFilterExpression', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [
          {
            keys: [{ field: 'status', direction: 1 }],
            partialFilterExpression: { status: { $eq: 'active' } },
          },
        ],
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('rejects index with empty keys array', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [] }],
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects index key with invalid direction', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [{ field: 'name', direction: 'invalid' }] }],
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects index key missing field', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [{ direction: 1 }] }],
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects index with extra properties', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [{ field: 'name', direction: 1 }], extra: true }],
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects collection with extra properties', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [{ field: 'name', direction: 1 }] }],
        extra: true,
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('accepts index with wildcardProjection', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [
          {
            keys: [{ field: '$**', direction: 1 }],
            wildcardProjection: { name: 1, email: 1 },
          },
        ],
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts index with collation', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [
          {
            keys: [{ field: 'name', direction: 1 }],
            collation: { locale: 'en', strength: 2 },
          },
        ],
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts index with text options (weights, default_language, language_override)', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [
          {
            keys: [{ field: 'bio', direction: 'text' }],
            weights: { bio: 10 },
            default_language: 'english',
            language_override: 'lang',
          },
        ],
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });
  });

  describe('storage validator validation', () => {
    it('accepts collection with valid validator', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        validator: {
          jsonSchema: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
          validationLevel: 'strict',
          validationAction: 'error',
        },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with validator and indexes', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [{ field: 'name', direction: 1 }] }],
        validator: {
          jsonSchema: { bsonType: 'object' },
          validationLevel: 'moderate',
          validationAction: 'warn',
        },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('rejects validator with invalid validationLevel', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        validator: {
          jsonSchema: {},
          validationLevel: 'invalid',
          validationAction: 'error',
        },
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects validator with invalid validationAction', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        validator: {
          jsonSchema: {},
          validationLevel: 'strict',
          validationAction: 'invalid',
        },
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects validator missing jsonSchema', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        validator: {
          validationLevel: 'strict',
          validationAction: 'error',
        },
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects validator missing validationLevel', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        validator: {
          jsonSchema: { bsonType: 'object' },
          validationAction: 'error',
        },
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects validator missing validationAction', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        validator: {
          jsonSchema: { bsonType: 'object' },
          validationLevel: 'strict',
        },
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });
  });

  describe('storage collection options validation', () => {
    it('accepts collection with capped option', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: { capped: { size: 1048576 } },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with capped option including max', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: { capped: { size: 1048576, max: 1000 } },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with timeseries option', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: {
          timeseries: { timeField: 'timestamp', metaField: 'meta', granularity: 'hours' },
        },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with collation option', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: { collation: { locale: 'en', strength: 2 } },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with changeStreamPreAndPostImages', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: { changeStreamPreAndPostImages: { enabled: true } },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with clusteredIndex', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: { clusteredIndex: { name: 'myCluster' } },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('rejects capped option without required size', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        options: { capped: { max: 100 } },
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('rejects invalid wildcardProjection values', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [
          {
            keys: [{ field: '$**', direction: 1 }],
            wildcardProjection: { name: 2 },
          },
        ],
      } as typeof json.storage.collections.items;
      expect(() => validateMongoContract(json)).toThrow();
    });

    it('accepts collection with no validator or options (backward compat)', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {};
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });

    it('accepts collection with all options combined', () => {
      const json = makeValidContractJson();
      json.storage.collections.items = {
        indexes: [{ keys: [{ field: 'name', direction: 1 }] }],
        validator: {
          jsonSchema: { bsonType: 'object' },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        options: {
          changeStreamPreAndPostImages: { enabled: true },
          collation: { locale: 'en' },
        },
      } as typeof json.storage.collections.items;
      const result = validateMongoContract(json);
      expect(result.contract).toBeDefined();
    });
  });

  describe('happy path', () => {
    it('validates the ORM test contract', () => {
      const result = validateMongoContract(ormContractJson);
      expect(result.contract).toBeDefined();
      expect(result.indices.variantToBase).toBeDefined();
      expect(result.indices.modelToVariants).toBeDefined();
    });

    it('returns typed contract', () => {
      const result = validateMongoContract(makeValidContractJson());
      expect(result.contract.targetFamily).toBe('mongo');
      expect(result.contract.roots).toEqual({ items: 'Item' });
    });
  });

  // T4.10 — regression: validateMongoContract must remain synchronous
  // (consumes only build-time codec methods). If this signature ever drifts
  // to a Promise, the type-level assertion below fails and `await` becomes
  // required at every call site.
  describe('synchronous return (regression)', () => {
    it('returns a non-Promise value at runtime', () => {
      const result = validateMongoContract(makeValidContractJson());
      expect(result).toBeDefined();
      const thenable = result as unknown as { then?: unknown };
      expect(typeof thenable.then).toBe('undefined');
    });

    it('binds to a synchronous type at the call site', () => {
      // Type-level regression: this must compile without `await`. If
      // validateMongoContract becomes Promise-returning, this assignment
      // fails to compile.
      const result = validateMongoContract(makeValidContractJson());
      expect(result.contract).toBeDefined();
    });
  });
});
