import type {
  ModelDefinition,
  SqlContract,
  SqlMappings,
  SqlStorage,
} from '@prisma-next/sql-contract-types';
import { describe, expect, it } from 'vitest';
import { computeMappings, normalizeContract, validateContract } from '../src/contract';

describe('validateContract normalization', () => {
  it('normalizes missing nullable in columns', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1' },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.storage.tables.User.columns.id.nullable).toBe(false);
  });

  it('normalizes missing uniques array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.storage.tables.User.uniques).toEqual([]);
  });

  it('normalizes missing indexes array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.storage.tables.User.indexes).toEqual([]);
  });

  it('normalizes missing foreignKeys array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.storage.tables.User.foreignKeys).toEqual([]);
  });

  it('normalizes missing columns in table', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.storage.tables.User).toBeDefined();
  });

  it('normalizes table without columns property', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    // This will fail validation because columns are required, but normalization should handle it
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes table with null columns', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: null,
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    // This will fail validation because columns are required, but normalization should handle it
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes table with empty columns object', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {},
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    // This will fail validation because columns are required, but normalization should handle it
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes multiple tables where some have columns and some do not', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            // No columns property - should hit else branch
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    // This will fail validation because Post table is missing columns, but normalization should handle it
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizeContract handles table without columns property', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            // No columns property - should hit else branch at line 403-404
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    const normalized = normalizeContract(contractInput);
    // Normalization should complete even though validation would fail
    expect(normalized.storage.tables.User).toBeDefined();
    expect(normalized.storage.tables.User).not.toHaveProperty('columns');
  });

  it('normalizeContract handles table with undefined columns', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: undefined,
            // No columns property - should hit else branch at line 403-404
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    const normalized = normalizeContract(contractInput);
    // Normalization should complete even though validation would fail
    expect(normalized.storage.tables.User).toBeDefined();
  });

  it('normalizeContract handles models with existing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              to: 'Post',
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    const normalized = normalizeContract(contractInput);
    // Normalization should preserve existing relations (lines 420-425)
    expect(normalized.models.User.relations).toEqual({
      posts: {
        to: 'Post',
        on: { parentCols: ['id'], childCols: ['userId'] },
        cardinality: '1:N',
      },
    });
  });

  it('normalizes missing relations in models', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.models.User.relations).toEqual({});
  });

  it('normalizes missing top-level relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.relations).toEqual({});
  });

  it('normalizes missing extensions', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.extensions).toEqual({});
  });

  it('normalizes missing capabilities', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.capabilities).toEqual({});
  });

  it('normalizes missing meta', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.meta).toEqual({});
  });

  it('normalizes missing sources', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.sources).toEqual({});
  });

  it('normalizes models with multiple entries', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.models.User.relations).toEqual({});
    expect(contract.models.Post.relations).toEqual({});
  });

  it('normalizes models with existing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              to: 'Post',
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
        Post: {
          storage: { table: 'Post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
          },
          relations: {
            user: {
              to: 'User',
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: 'N:1',
            },
          },
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
              userId: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.models.User.relations).toEqual({
      posts: {
        to: 'Post',
        on: { parentCols: ['id'], childCols: ['userId'] },
        cardinality: '1:N',
      },
    });
    expect(contract.models.Post.relations).toEqual({
      user: {
        to: 'User',
        on: { parentCols: ['id'], childCols: ['userId'] },
        cardinality: 'N:1',
      },
    });
  });

  it('normalizes models with mix of existing and missing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              to: 'Post',
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
        Post: {
          storage: { table: 'Post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
          },
          // Missing relations - should be normalized to {}
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
              userId: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
    const contract = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(contract.models.User.relations).toEqual({
      posts: {
        to: 'Post',
        on: { parentCols: ['id'], childCols: ['userId'] },
        cardinality: '1:N',
      },
    });
    expect(contract.models.Post.relations).toEqual({});
  });
});

describe('computeMappings', () => {
  it('computes mappings from models and storage', () => {
    const models: Record<string, ModelDefinition> = {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
        relations: {},
      },
    };
    const storage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };
    const mappings = computeMappings(models, storage);
    expect(mappings.modelToTable.User).toBe('user');
    expect(mappings.tableToModel.user).toBe('User');
    expect(mappings.fieldToColumn.User.id).toBe('id');
    expect(mappings.fieldToColumn.User.email).toBe('email');
    expect(mappings.columnToField.user.id).toBe('id');
    expect(mappings.columnToField.user.email).toBe('email');
  });

  it('preserves existing mappings when provided', () => {
    const models: Record<string, ModelDefinition> = {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
        },
        relations: {},
      },
    };
    const storage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };
    const existingMappings: Partial<SqlMappings> = {
      modelToTable: { User: 'custom_table' },
      codecTypes: { 'pg/int4@1': { output: 0 } },
      operationTypes: { custom: {} },
    };
    const mappings = computeMappings(models, storage, existingMappings);
    expect(mappings.modelToTable.User).toBe('custom_table');
    expect(mappings.codecTypes).toEqual(existingMappings.codecTypes);
    expect(mappings.operationTypes).toEqual(existingMappings.operationTypes);
  });

  it('computes mappings for multiple models', () => {
    const models: Record<string, ModelDefinition> = {
      User: {
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
        },
        relations: {},
      },
      Post: {
        storage: { table: 'post' },
        fields: {
          id: { column: 'id' },
          userId: { column: 'user_id' },
        },
        relations: {},
      },
    };
    const storage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            user_id: { type: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };
    const mappings = computeMappings(models, storage);
    expect(mappings.modelToTable.User).toBe('user');
    expect(mappings.modelToTable.Post).toBe('post');
    expect(mappings.tableToModel.user).toBe('User');
    expect(mappings.tableToModel.post).toBe('Post');
    expect(mappings.fieldToColumn.Post.userId).toBe('user_id');
    expect(mappings.columnToField.post.user_id).toBe('userId');
  });
});
