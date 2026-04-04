import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';

describe('validateContract edge cases', () => {
  it('handles storage with null tables', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
        tables: null,
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('handles storage without tables property', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: { storageHash: 'sha256:test' },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('rejects models with null relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { column: 'id' },
          },
          relations: null,
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
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(/relations/);
  });

  it('handles table without columns in normalization', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
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
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    // This will fail validation, but normalization should handle it
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('rejects relation targeting non-existent model', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              to: 'Post',
              cardinality: '1:N',
            },
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
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(
      /targets "Post" which does not exist/,
    );
  });

  it('rejects relation without to property (domain validation)', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: '1:N',
            },
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
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(
      /does not exist in models/,
    );
  });

  it('accepts relation using old parentCols/childCols format (format validated by emitter)', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
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
          relations: {
            posts: {
              to: 'Post',
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
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
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });
});
