import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';

describe('validateContract parameterized type fields', () => {
  const baseContractInput = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {},
    storage: {
      tables: {
        User: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  };

  describe('column typeParams', () => {
    it('accepts column with typeParams object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          tables: {
            Embedding: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                vector: {
                  nativeType: 'vector(1536)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: { length: 1536 },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(input);
      const vectorCol = result.storage.tables.Embedding.columns.vector;
      expect(vectorCol.typeParams).toEqual({ length: 1536 });
    });

    it('accepts column with empty typeParams object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          tables: {
            User: {
              columns: {
                id: {
                  nativeType: 'int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeParams: {},
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(input);
      expect(result.storage.tables.User.columns.id.typeParams).toEqual({});
    });

    it('accepts column without typeParams (optional field)', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContractInput);
      expect(result.storage.tables.User.columns.id.typeParams).toBeUndefined();
    });

    it('rejects non-object typeParams', () => {
      const input = {
        ...baseContractInput,
        storage: {
          tables: {
            User: {
              columns: {
                id: {
                  nativeType: 'int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeParams: 'invalid',
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      expect(() => validateContract<SqlContract<SqlStorage>>(input)).toThrow(/typeParams/);
    });

    it('accepts array typeParams (arrays are objects in JS)', () => {
      // Note: Arktype Record<string, unknown> accepts arrays since they're objects
      // in JavaScript. This is technically valid, though semantically unusual.
      const input = {
        ...baseContractInput,
        storage: {
          tables: {
            User: {
              columns: {
                id: {
                  nativeType: 'int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeParams: [1, 2, 3],
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      // Arrays pass Record<string, unknown> validation
      const result = validateContract<SqlContract<SqlStorage>>(input);
      expect(result.storage.tables.User.columns.id.typeParams).toEqual([1, 2, 3]);
    });
  });

  describe('column typeRef', () => {
    it('accepts column with typeRef string', () => {
      const input = {
        ...baseContractInput,
        storage: {
          tables: {
            Embedding: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                vector: {
                  nativeType: 'vector(1536)',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeRef: 'Vector1536',
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            Vector1536: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(1536)',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(input);
      const vectorCol = result.storage.tables.Embedding.columns.vector;
      expect(vectorCol.typeRef).toBe('Vector1536');
    });

    it('rejects non-string typeRef', () => {
      const input = {
        ...baseContractInput,
        storage: {
          tables: {
            User: {
              columns: {
                id: {
                  nativeType: 'int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeRef: 123,
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      expect(() => validateContract<SqlContract<SqlStorage>>(input)).toThrow(/typeRef/);
    });
  });

  describe('storage.types (named type instances)', () => {
    it('accepts storage with types object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(1536)',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(input);
      expect(result.storage.types).toEqual({
        Vector1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector(1536)',
          typeParams: { length: 1536 },
        },
      });
    });

    it('accepts storage with multiple type instances', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(1536)',
              typeParams: { length: 1536 },
            },
            Vector768: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(768)',
              typeParams: { length: 768 },
            },
          },
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(input);
      expect(Object.keys(result.storage.types!)).toHaveLength(2);
    });

    it('accepts storage without types (optional field)', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContractInput);
      expect(result.storage.types).toBeUndefined();
    });

    it('rejects type instance missing codecId', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              nativeType: 'vector(1536)',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      expect(() => validateContract<SqlContract<SqlStorage>>(input)).toThrow(/codecId/);
    });

    it('rejects type instance missing nativeType', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              codecId: 'pg/vector@1',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      expect(() => validateContract<SqlContract<SqlStorage>>(input)).toThrow(/nativeType/);
    });

    it('rejects type instance missing typeParams', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              codecId: 'pg/vector@1',
              nativeType: 'vector(1536)',
            },
          },
        },
      };

      expect(() => validateContract<SqlContract<SqlStorage>>(input)).toThrow(/typeParams/);
    });

    it('rejects non-object storage.types', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: 'invalid',
        },
      };

      expect(() => validateContract<SqlContract<SqlStorage>>(input)).toThrow(/types/);
    });
  });
});
