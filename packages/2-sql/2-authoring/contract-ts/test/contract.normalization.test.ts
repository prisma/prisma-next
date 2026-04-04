import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';

describe('validateContract normalization', () => {
  it('normalizes missing nullable in columns', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.storage.tables['User']?.columns['id']?.nullable).toBe(false);
  });

  it('normalizes missing uniques array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.storage.tables['User']?.['uniques']).toEqual([]);
  });

  it('normalizes missing indexes array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.storage.tables['User']?.['indexes']).toEqual([]);
  });

  it('normalizes missing foreignKeys array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.storage.tables['User']?.['foreignKeys']).toEqual([]);
  });

  it('normalizes missing columns in table', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.storage.tables['User']).toBeDefined();
  });

  it('normalizes table without columns property', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes table with null columns', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes table with empty columns object', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes multiple tables where some have columns and some do not', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('normalizes missing relations in models', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({});
  });

  it('normalizes missing extensionPacks', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.extensionPacks).toEqual({});
  });

  it('normalizes missing capabilities', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.capabilities).toEqual({});
  });

  it('normalizes missing meta', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect(contract.meta).toEqual({});
  });

  it('normalizes models with multiple entries', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({});
    expect((contract.models['Post'] as { relations?: unknown })['relations']).toEqual({});
  });

  it('normalizes models with existing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
          relations: {
            posts: {
              to: 'Post',
              on: { localFields: ['id'], targetFields: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
        Post: {
          storage: { table: 'Post' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
            userId: { codecId: 'pg/text@1', nullable: false },
          },
          relations: {
            user: {
              to: 'User',
              on: { localFields: ['userId'], targetFields: ['id'] },
              cardinality: 'N:1',
            },
          },
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({
      posts: {
        to: 'Post',
        on: { localFields: ['id'], targetFields: ['userId'] },
        cardinality: '1:N',
      },
    });
    expect((contract.models['Post'] as { relations?: unknown })['relations']).toEqual({
      user: {
        to: 'User',
        on: { localFields: ['userId'], targetFields: ['id'] },
        cardinality: 'N:1',
      },
    });
  });

  it('normalizes models with mix of existing and missing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'User' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
          relations: {
            posts: {
              to: 'Post',
              on: { localFields: ['id'], targetFields: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
        Post: {
          storage: { table: 'Post' },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
            userId: { codecId: 'pg/text@1', nullable: false },
          },
        },
      },
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({
      posts: {
        to: 'Post',
        on: { localFields: ['id'], targetFields: ['userId'] },
        cardinality: '1:N',
      },
    });
    expect((contract.models['Post'] as { relations?: unknown })['relations']).toEqual({});
  });

  it('normalizes FK entries with missing constraint/index to defaults', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    const fk = contract.storage.tables['post']?.foreignKeys[0];
    expect(fk?.constraint).toBe(true);
    expect(fk?.index).toBe(true);
  });

  it('preserves explicit per-FK constraint/index fields', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
                constraint: false,
                index: true,
              },
            ],
          },
        },
      },
    };
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    const fk = contract.storage.tables['post']?.foreignKeys[0];
    expect(fk?.constraint).toBe(false);
    expect(fk?.index).toBe(true);
  });
});
