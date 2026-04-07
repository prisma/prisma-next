import type { Contract } from '@prisma-next/contract/types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { describe, expect, it } from 'vitest';

function validContractInput(overrides?: Record<string, unknown>) {
  return {
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
    ...overrides,
  };
}

describe('validateContract validation', () => {
  it('accepts a valid contract with explicit nullable', () => {
    const contract = validateContract<Contract<SqlStorage>>(validContractInput(), emptyCodecLookup);
    expect(contract.storage.tables['User']?.columns['id']?.nullable).toBe(false);
  });

  it('rejects missing uniques array', () => {
    const input = validContractInput({
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
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).toThrow();
  });

  it('rejects missing indexes array', () => {
    const input = validContractInput({
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
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).toThrow();
  });

  it('rejects missing foreignKeys array', () => {
    const input = validContractInput({
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
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).toThrow();
  });

  it('accepts table with columns present', () => {
    const contract = validateContract<Contract<SqlStorage>>(validContractInput(), emptyCodecLookup);
    expect(contract.storage.tables['User']).toBeDefined();
  });

  it('rejects table without columns property', () => {
    const input = validContractInput({
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
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).toThrow();
  });

  it('rejects table with null columns', () => {
    const input = {
      ...validContractInput(),
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
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).toThrow();
  });

  it('accepts table with empty columns object', () => {
    const input = validContractInput({
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
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).not.toThrow();
  });

  it('rejects table missing columns in multi-table contract', () => {
    const input = {
      ...validContractInput(),
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
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).toThrow();
  });

  it('accepts model without relations (optional field)', () => {
    const input = validContractInput({
      models: {
        User: {
          storage: { table: 'User', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).not.toThrow();
  });

  it('accepts contract with extensionPacks', () => {
    const contract = validateContract<Contract<SqlStorage>>(validContractInput(), emptyCodecLookup);
    expect(contract.extensionPacks).toEqual({});
  });

  it('accepts contract with capabilities', () => {
    const contract = validateContract<Contract<SqlStorage>>(validContractInput(), emptyCodecLookup);
    expect(contract.capabilities).toEqual({});
  });

  it('accepts contract with meta', () => {
    const contract = validateContract<Contract<SqlStorage>>(validContractInput(), emptyCodecLookup);
    expect(contract.meta).toEqual({});
  });

  it('accepts multiple models without relations', () => {
    const input = validContractInput({
      models: {
        User: {
          storage: { table: 'user', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
        },
        Post: {
          storage: { table: 'post', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
        },
      },
      storage: {
        storageHash: 'sha256:test',
        tables: {
          user: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
    expect(() => validateContract<Contract<SqlStorage>>(input, emptyCodecLookup)).not.toThrow();
  });

  it('validates models with relations', () => {
    const input = validContractInput({
      models: {
        User: {
          storage: { table: 'User', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
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
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            userId: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
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
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
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
    });
    const contract = validateContract<Contract<SqlStorage>>(input, emptyCodecLookup);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({
      posts: {
        to: 'Post',
        on: { localFields: ['id'], targetFields: ['userId'] },
        cardinality: '1:N',
      },
    });
  });

  it('preserves existing relations and accepts missing relations', () => {
    const input = validContractInput({
      models: {
        User: {
          storage: { table: 'User', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
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
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            userId: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
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
    });
    const contract = validateContract<Contract<SqlStorage>>(input, emptyCodecLookup);
    expect((contract.models['User'] as { relations?: unknown })['relations']).toEqual({
      posts: {
        to: 'Post',
        on: { localFields: ['id'], targetFields: ['userId'] },
        cardinality: '1:N',
      },
    });
  });

  it('validates FK entries with explicit constraint/index', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          user: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
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
    });
    const contract = validateContract<Contract<SqlStorage>>(input, emptyCodecLookup);
    const fk = contract.storage.tables['post']?.foreignKeys[0];
    expect(fk?.constraint).toBe(true);
    expect(fk?.index).toBe(true);
  });

  it('preserves explicit per-FK constraint/index fields', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          user: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
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
    });
    const contract = validateContract<Contract<SqlStorage>>(input, emptyCodecLookup);
    const fk = contract.storage.tables['post']?.foreignKeys[0];
    expect(fk?.constraint).toBe(false);
    expect(fk?.index).toBe(true);
  });
});
