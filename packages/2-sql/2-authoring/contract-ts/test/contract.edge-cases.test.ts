import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { crossRef } from './cross-ref-helpers';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';

describe('SqlContractSerializer edge cases', () => {
  it('handles storage with null tables', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: storageWithNamespacedTables({
        storageHash: 'sha256:test',
        tables: null,
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('accepts storage with only storageHash (defaults to an empty unbound namespace)', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: { storageHash: 'sha256:test' },
      // biome-ignore lint/suspicious/noExplicitAny: testing minimal valid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('rejects models with null relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: null,
        },
      },
      storage: storageWithNamespacedTables({
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
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow(
      /relations/,
    );
  });

  it('handles table without columns in normalization', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: storageWithNamespacedTables({
        storageHash: 'sha256:test',
        tables: {
          User: {
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    // This will fail validation, but normalization should handle it
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('rejects relation targeting non-existent model', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
            },
          },
        },
      },
      storage: storageWithNamespacedTables({
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
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow(
      /targets "Post" which does not exist/,
    );
  });

  it('rejects relation without to property (domain validation)', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            posts: {
              on: { parentCols: ['id'], childCols: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
      },
      storage: storageWithNamespacedTables({
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
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow(
      /relations\.posts\.to must be an object/,
    );
  });

  it('accepts relation with localFields/targetFields on shape', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              on: { localFields: ['id'], targetFields: ['userId'] },
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
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            userId: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
      storage: storageWithNamespacedTables({
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
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });
});
