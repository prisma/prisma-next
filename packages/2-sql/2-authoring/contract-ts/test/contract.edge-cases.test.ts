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
      models: {},
      storage: {
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
      models: {},
      storage: {},
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('handles models with null relations', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: null,
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
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    const contract = validateContract<Contract<SqlStorage>>(contractInput);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({});
  });

  it('handles table without columns in normalization', () => {
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
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    // This will fail validation, but normalization should handle it
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('handles relation without on property', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
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
    // Relations without 'on' property should be skipped in validation
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('handles relation without to property', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
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
    // Relations without 'to' property should be skipped in validation
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('rejects relation using old parentCols/childCols format', () => {
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
      'unsupported relation format (expected localFields/targetFields)',
    );
  });
});
