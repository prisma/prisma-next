import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
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
        __unbound__: {
          User: {
            namespaceId: '__unbound__',
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
    },
    ...overrides,
  };
}

describe('SqlContractSerializer structural validation', () => {
  it('accepts a valid contract with explicit nullable', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validContractInput());
    expect(contract.storage.tables).toMatchObject({
      __unbound__: { User: { columns: { id: { nullable: false } } } },
    });
  });

  it('rejects missing uniques array', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('rejects missing indexes array', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('rejects missing foreignKeys array', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('accepts table with columns present', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validContractInput());
    expect(contract.storage.tables['__unbound__']).toHaveProperty('User');
  });

  it('rejects table without columns property', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('rejects table with null columns', () => {
    const input = {
      ...validContractInput(),
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: null,
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('accepts table with empty columns object', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: {},
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).not.toThrow();
  });

  it('rejects table missing columns in multi-table contract', () => {
    const input = {
      ...validContractInput(),
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            Post: {
              namespaceId: '__unbound__',
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
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
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).not.toThrow();
  });

  it('accepts contract with extensionPacks', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validContractInput());
    expect(contract.extensionPacks).toEqual({});
  });

  it('accepts contract with capabilities', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validContractInput());
    expect(contract.capabilities).toEqual({});
  });

  it('accepts contract with meta', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validContractInput());
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
          __unbound__: {
            user: {
              namespaceId: '__unbound__',
              columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              namespaceId: '__unbound__',
              columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).not.toThrow();
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
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            Post: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [
                {
                  source: { columns: ['userId'] },
                  target: { namespaceId: '__unbound__', table: 'User', columns: ['id'] },
                  constraint: true,
                  index: true,
                },
              ],
            },
          },
        },
      },
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
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
          __unbound__: {
            User: {
              namespaceId: '__unbound__',
              columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            Post: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [
                {
                  source: { columns: ['userId'] },
                  target: { namespaceId: '__unbound__', table: 'User', columns: ['id'] },
                  constraint: true,
                  index: true,
                },
              ],
            },
          },
        },
      },
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
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
          __unbound__: {
            user: {
              namespaceId: '__unbound__',
              columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [
                {
                  source: { columns: ['userId'] },
                  target: { namespaceId: '__unbound__', table: 'user', columns: ['id'] },
                  constraint: true,
                  index: true,
                },
              ],
            },
          },
        },
      },
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
    expect(contract.storage.tables).toMatchObject({
      __unbound__: { post: { foreignKeys: [{ constraint: true, index: true }] } },
    });
  });

  it('preserves explicit per-FK constraint/index fields', () => {
    const input = validContractInput({
      storage: {
        storageHash: 'sha256:test',
        tables: {
          __unbound__: {
            user: {
              namespaceId: '__unbound__',
              columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              namespaceId: '__unbound__',
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [
                {
                  source: { columns: ['userId'] },
                  target: { namespaceId: '__unbound__', table: 'user', columns: ['id'] },
                  constraint: false,
                  index: true,
                },
              ],
            },
          },
        },
      },
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
    expect(contract.storage.tables).toMatchObject({
      __unbound__: { post: { foreignKeys: [{ constraint: false, index: true }] } },
    });
  });
});
