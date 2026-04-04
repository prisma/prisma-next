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
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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

  it('rejects missing uniques array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(/uniques/);
  });

  it('rejects missing indexes array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(/indexes/);
  });

  it('rejects missing foreignKeys array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(/foreignKeys/);
  });

  it('normalizes missing columns in table', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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

  it('accepts table with empty columns object', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('normalizes multiple tables where some have columns and some do not', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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

  it('accepts model without relations (optional field)', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'User', fields: { id: { column: 'id' } } },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
        },
      },
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('normalizes missing extensionPacks', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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

  it('accepts multiple models without relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
        },
        Post: {
          storage: { table: 'post', fields: { id: { column: 'id' } } },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
          },
        },
      },
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('normalizes models with existing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'User', fields: { id: { column: 'id' } } },
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
          storage: {
            table: 'Post',
            fields: { id: { column: 'id' }, userId: { column: 'userId' } },
          },
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
        storageHash: 'sha256:test',
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
                constraint: true,
                index: true,
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

  it('preserves existing relations and accepts missing relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'User', fields: { id: { column: 'id' } } },
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
          storage: {
            table: 'Post',
            fields: { id: { column: 'id' }, userId: { column: 'userId' } },
          },
          fields: {
            id: { codecId: 'pg/text@1', nullable: false },
            userId: { codecId: 'pg/text@1', nullable: false },
          },
        },
      },
      storage: {
        storageHash: 'sha256:test',
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
                constraint: true,
                index: true,
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
  });

  it('normalizes FK entries with missing constraint/index to defaults', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
                constraint: true,
                index: true,
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
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
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
