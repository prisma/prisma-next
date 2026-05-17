import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import { describe, expect, it } from 'vitest';

/**
 * Concrete contract type for these tests. Using the generic Contract<SqlStorage>
 * breaks type inference because JSON imports lose literal types. This concrete type
 * provides sufficient structure for SqlContractSerializer to narrow correctly.
 */
type TestContract = Contract<SqlStorage>;

describe('SqlContractSerializer parameterized type fields', () => {
  const baseContractInput = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'sha256:test',
    capabilities: {},
    extensionPacks: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash: 'sha256:test',
      tables: {
        __unbound__: {
          User: {
            namespaceId: '__unbound__',
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
    },
  };

  describe('column typeParams', () => {
    it('accepts column with typeParams object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              Embedding: {
                namespaceId: '__unbound__',
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
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(result.storage.tables).toMatchObject({
        __unbound__: { Embedding: { columns: { vector: { typeParams: { length: 1536 } } } } },
      });
    });

    it('accepts column with empty typeParams object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
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
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(result.storage.tables).toMatchObject({
        __unbound__: { User: { columns: { id: { typeParams: {} } } } },
      });
    });

    it('accepts column without typeParams (optional field)', () => {
      const result = validateSqlContractFully<TestContract>(baseContractInput);
      expect(result.storage.tables).not.toHaveProperty([
        '__unbound__',
        'User',
        'columns',
        'id',
        'typeParams',
      ]);
    });

    it('rejects non-object typeParams', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
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
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/typeParams/);
    });

    it('accepts array typeParams (array-vs-object validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
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
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });

    it('rejects typeParams when typeRef is also present (mutually exclusive)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              Embedding: {
                namespaceId: '__unbound__',
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  vector: {
                    nativeType: 'vector(1536)',
                    codecId: 'pg/vector@1',
                    nullable: false,
                    typeParams: { length: 1536 },
                    typeRef: 'Vector1536',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
                typeParams: { length: 1536 },
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(
        /typeParams.*typeRef|typeRef.*typeParams/,
      );
    });
  });

  describe('column typeRef', () => {
    it('accepts column with typeRef string', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              Embedding: {
                namespaceId: '__unbound__',
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
          },
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
                typeParams: { length: 1536 },
              },
            },
          },
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(result.storage.tables).toMatchObject({
        __unbound__: { Embedding: { columns: { vector: { typeRef: 'Vector1536' } } } },
      });
    });

    it('rejects non-string typeRef', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
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
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/typeRef/);
    });

    it('accepts typeRef pointing to non-existent key (cross-ref validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              Embedding: {
                namespaceId: '__unbound__',
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  vector: {
                    nativeType: 'vector(1536)',
                    codecId: 'pg/vector@1',
                    nullable: false,
                    typeRef: 'NonExistent',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
                typeParams: { length: 1536 },
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });

    it('accepts typeRef when storage.types is missing (cross-ref validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              Embedding: {
                namespaceId: '__unbound__',
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
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });
  });

  describe('storage.types (named type instances)', () => {
    it('accepts storage with types object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
                typeParams: { length: 1536 },
              },
            },
          },
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(result.storage.types).toEqual({
        __unbound__: {
          Vector1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector(1536)',
            typeParams: { length: 1536 },
          },
        },
      });
    });

    it('accepts storage with multiple type instances', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
                typeParams: { length: 1536 },
              },
              Vector768: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(768)',
                typeParams: { length: 768 },
              },
            },
          },
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(Object.keys(result.storage.types!['__unbound__']!)).toHaveLength(2);
    });

    it('accepts storage without types (optional field)', () => {
      const result = validateSqlContractFully<TestContract>(baseContractInput);
      expect(result.storage.types).toBeUndefined();
    });

    it('rejects type instance missing codecId', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                nativeType: 'vector(1536)',
                typeParams: { length: 1536 },
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/codecId/);
    });

    it('rejects type instance missing nativeType', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                typeParams: { length: 1536 },
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/nativeType/);
    });

    it('rejects type instance missing typeParams', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/typeParams/);
    });

    it('rejects non-object storage.types', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: 'invalid',
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/types/);
    });

    it('accepts array typeParams in type instance (array-vs-object validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            __unbound__: {
              Vector1536: {
                kind: 'codec-instance',
                codecId: 'pg/vector@1',
                nativeType: 'vector(1536)',
                typeParams: [1536],
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });
  });

  describe('typeRef consistency validation', () => {
    it('accepts column with typeRef when codecId mismatches (cross-ref validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  role: {
                    nativeType: 'role',
                    codecId: 'pg/int4@1',
                    nullable: false,
                    typeRef: 'Role',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
          types: {
            __unbound__: {
              Role: {
                kind: 'codec-instance',
                codecId: 'pg/enum@1',
                nativeType: 'role',
                typeParams: { values: ['USER'] },
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });

    it('accepts column with typeRef when nativeType mismatches (cross-ref validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  role: {
                    nativeType: 'int4',
                    codecId: 'pg/enum@1',
                    nullable: false,
                    typeRef: 'Role',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
          types: {
            __unbound__: {
              Role: {
                kind: 'codec-instance',
                codecId: 'pg/enum@1',
                nativeType: 'role',
                typeParams: { values: ['USER'] },
              },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });

    it('accepts column with typeRef when codecId and nativeType both match', () => {
      const input = {
        ...baseContractInput,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            __unbound__: {
              User: {
                namespaceId: '__unbound__',
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  role: {
                    nativeType: 'role',
                    codecId: 'pg/enum@1',
                    nullable: false,
                    typeRef: 'Role',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
          types: {
            __unbound__: {
              Role: {
                kind: 'codec-instance',
                codecId: 'pg/enum@1',
                nativeType: 'role',
                typeParams: { values: ['USER'] },
              },
            },
          },
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(result.storage.tables).toMatchObject({
        __unbound__: { User: { columns: { role: { typeRef: 'Role' } } } },
      });
    });
  });
});
