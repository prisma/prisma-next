import { describe, expect, it } from 'vitest';
import type { SqlContract, SqlStorage } from '../src/types';
import { normalizeContract, validateContract } from '../src/validate';

const baseContract = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:test',
  storageHash: 'sha256:test-storage',
  models: {
    User: {
      storage: {
        table: 'User',
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
      fields: {
        id: {},
        email: {},
      },
      relations: {},
    },
  },
  storage: {
    tables: {
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
} as const;

describe('validateContract', () => {
  type Mutable<T> =
    T extends ReadonlyArray<infer U>
      ? Array<Mutable<U>>
      : T extends object
        ? { -readonly [K in keyof T]: Mutable<T[K]> }
        : T;

  function makeContract(tables?: Record<string, unknown>) {
    const clone = structuredClone(baseContract) as Mutable<SqlContract<SqlStorage>>;
    if (tables) {
      (clone as Record<string, unknown>).storage = { tables };
      (clone as Record<string, unknown>).models = {};
    }
    return clone;
  }

  it('accepts custom execution default generator ids', () => {
    const contract = {
      ...baseContract,
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'User', column: 'id' },
              onCreate: { kind: 'generator', id: 'slugid' },
            },
          ],
        },
      },
    } as const;

    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'User', column: 'id' },
        onCreate: { kind: 'generator', id: 'slugid' },
      },
    ]);
  });

  it('rejects non-flat execution default generator ids', () => {
    const contract = {
      ...baseContract,
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'User', column: 'id' },
              onCreate: { kind: 'generator', id: 'pack/slugid' },
            },
          ],
        },
      },
    } as const;

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws for invalid foreign key references', () => {
    const invalid = {
      ...baseContract,
      storage: {
        tables: {
          ...baseContract.storage.tables,
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              { columns: ['userId'], references: { table: 'Missing', columns: ['id'] } },
            ],
          },
        },
      },
    } as const;

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey references non-existent table/,
    );
  });

  it('fills default arrays and nullable fields during normalization', () => {
    const normalized = makeContract();
    normalized.storage.tables.User.columns.email = {
      codecId: 'pg/text@1',
      nativeType: 'text',
    } as SqlContract<SqlStorage>['storage']['tables']['User']['columns']['email'];
    normalized.storage.tables.User.uniques = undefined as unknown as readonly [];
    normalized.storage.tables.User.indexes = undefined as unknown as readonly [];
    normalized.storage.tables.User.foreignKeys = undefined as unknown as readonly [];
    normalized.models.User.relations = undefined as unknown as Record<string, unknown>;
    normalized.extensionPacks = undefined as unknown as SqlContract<SqlStorage>['extensionPacks'];
    normalized.capabilities = undefined as unknown as SqlContract<SqlStorage>['capabilities'];
    normalized.meta = undefined as unknown as SqlContract<SqlStorage>['meta'];
    normalized.sources = undefined as unknown as SqlContract<SqlStorage>['sources'];

    const result = validateContract<SqlContract<SqlStorage>>(normalized);
    expect(result.storage.tables.User.columns.email.nullable).toBe(false);
    expect(result.storage.tables.User.uniques).toEqual([]);
    expect(result.storage.tables.User.indexes).toEqual([]);
    expect(result.storage.tables.User.foreignKeys).toEqual([]);
    expect(result.models.User.relations).toEqual({});
    expect(result.extensionPacks).toEqual({});
    expect(result.capabilities).toEqual({});
    expect(result.meta).toEqual({});
    expect(result.sources).toEqual({});
  });

  it('throws when primary key references missing column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.primaryKey = { columns: ['missing'] };

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /primaryKey references non-existent column/,
    );
  });

  it('throws when unique references missing column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.uniques = [{ columns: ['missing'] }];

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /unique constraint references non-existent column/,
    );
  });

  it('throws when index references missing column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.indexes = [{ columns: ['missing'] }];

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /index references non-existent column/,
    );
  });

  it('throws when foreign key references missing local column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.foreignKeys = [
      {
        columns: ['missing'],
        references: { table: 'User', columns: ['id'] },
      },
    ];

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey references non-existent column "missing"/,
    );
  });

  it('throws when foreign key references missing remote column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.foreignKeys = [
      {
        columns: ['id'],
        references: { table: 'User', columns: ['missing'] },
      },
    ];

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /references non-existent column "missing" in table "User"/,
    );
  });

  it('throws when foreign key column counts differ', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.columns.otherId = {
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
    };
    invalid.storage.tables.User.foreignKeys = [
      {
        columns: ['id', 'otherId'],
        references: { table: 'User', columns: ['id'] },
      },
    ];

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey column count \(2\) does not match referenced column count \(1\)/,
    );
  });

  it('accepts valid index and foreign key references', () => {
    const valid = makeContract();
    valid.storage.tables.User.indexes = [{ columns: ['email'] }];
    valid.storage.tables.Post = {
      columns: {
        id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [{ columns: ['userId'] }],
      foreignKeys: [
        {
          columns: ['userId'],
          references: { table: 'User', columns: ['id'] },
        },
      ],
    };
    valid.models.Post = {
      storage: {
        table: 'Post',
        fields: {
          id: { column: 'id' },
          userId: { column: 'userId' },
        },
      },
      fields: {
        id: {},
        userId: {},
      },
      relations: {},
    };

    const result = validateContract<SqlContract<SqlStorage>>(valid);
    expect(result.storage.tables.Post.foreignKeys).toHaveLength(1);
    expect(result.storage.tables.User.indexes).toHaveLength(1);
  });

  it('accepts valid unique/index columns without triggering validation errors', () => {
    const valid = makeContract();
    valid.storage.tables.User.uniques = [{ columns: ['email'] }];
    valid.storage.tables.User.indexes = [{ columns: ['id'] }];

    const result = validateContract<SqlContract<SqlStorage>>(valid);
    expect(result.storage.tables.User.primaryKey).toEqual({ columns: ['id'] });
    expect(result.storage.tables.User.uniques).toHaveLength(1);
    expect(result.storage.tables.User.indexes).toHaveLength(1);
  });

  it('throws structural error for non-object values', () => {
    expect(() => validateContract<SqlContract<SqlStorage>>(null)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws structural error when storage is non-object', () => {
    const invalid = {
      ...makeContract(),
      storage: 'invalid',
    } as unknown as SqlContract<SqlStorage>;

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws structural error when models is non-object', () => {
    const invalid = {
      ...makeContract(),
      models: 'invalid',
    } as unknown as SqlContract<SqlStorage>;

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws structural error when table columns are missing', () => {
    const invalid = makeContract();
    invalid.storage.tables.User = {
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    } as unknown as Mutable<SqlContract<SqlStorage>['storage']['tables']['User']>;

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws structural error when storage exists without tables', () => {
    const invalid = {
      ...makeContract(),
      storage: {},
    } as unknown as SqlContract<SqlStorage>;

    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('decodes tagged bigint default to native BigInt', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          count: {
            codecId: 'pg/int8@1',
            nativeType: 'bigint',
            nullable: false,
            default: { kind: 'literal', value: { $type: 'bigint', value: '9007199254740993' } },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    const col = result.storage.tables.User.columns.count;
    expect(col.default).toEqual({ kind: 'literal', value: 9007199254740993n });
  });

  it('keeps ISO date string defaults unchanged on temporal column', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          created_at: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            nullable: false,
            default: { kind: 'literal', value: '2025-01-01T00:00:00.000Z' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    const col = result.storage.tables.User.columns.created_at;
    expect(col.default).toEqual({ kind: 'literal', value: '2025-01-01T00:00:00.000Z' });
  });

  it('keeps ISO date string defaults unchanged on temporal-like codec ids', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          created_at: {
            codecId: 'pg/timestamp@1',
            nativeType: 'custom_temporal',
            nullable: false,
            default: { kind: 'literal', value: '2025-02-03T10:20:30.000Z' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    const col = result.storage.tables.User.columns.created_at;
    expect(col.default).toEqual({ kind: 'literal', value: '2025-02-03T10:20:30.000Z' });
  });

  it('keeps Date literal defaults unchanged', () => {
    const dateValue = new Date('2025-03-04T12:00:00.000Z');
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          created_at: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            nullable: false,
            default: { kind: 'literal', value: dateValue },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    const col = result.storage.tables.User.columns.created_at;
    expect(col.default).toEqual({ kind: 'literal', value: dateValue });
    expect(col.default?.kind).toBe('literal');
    if (col.default?.kind === 'literal') {
      expect(col.default.value).toBe(dateValue);
    }
  });

  it('keeps non-temporal string defaults unchanged', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          status: {
            codecId: 'pg/text@1',
            nativeType: 'text',
            nullable: false,
            default: { kind: 'literal', value: 'draft' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    const col = result.storage.tables.User.columns.status;
    expect(col.default).toEqual({ kind: 'literal', value: 'draft' });
  });

  it('throws on invalid tagged bigint value', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          count: {
            codecId: 'pg/int8@1',
            nativeType: 'bigint',
            nullable: false,
            default: { kind: 'literal', value: { $type: 'bigint', value: 'not-a-number' } },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /Invalid tagged bigint/,
    );
  });

  it('keeps invalid temporal-like strings unchanged', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          created_at: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            nullable: false,
            default: { kind: 'literal', value: 'not-a-date' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.storage.tables.User.columns.created_at.default).toEqual({
      kind: 'literal',
      value: 'not-a-date',
    });
  });

  it('keeps tagged bigint literals unchanged for non-bigint columns', () => {
    const tagged = { $type: 'bigint', value: '42' } as const;
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          payload: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            nullable: false,
            default: { kind: 'literal', value: tagged },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.storage.tables.User.columns.payload.default).toEqual({
      kind: 'literal',
      value: tagged,
    });
  });

  it('unwraps raw-tagged default to plain JSON value', () => {
    const rawWrapped = { $type: 'raw', value: { $type: 'bigint', value: '42' } } as const;
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          payload: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            nullable: false,
            default: { kind: 'literal', value: rawWrapped },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.storage.tables.User.columns.payload.default).toEqual({
      kind: 'literal',
      value: { $type: 'bigint', value: '42' },
    });
  });

  it('unwraps raw-tagged default with nested $type key', () => {
    const rawWrapped = { $type: 'raw', value: { $type: 'custom', data: [1, 2, 3] } } as const;
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          meta: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            nullable: false,
            default: { kind: 'literal', value: rawWrapped },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.storage.tables.User.columns.meta.default).toEqual({
      kind: 'literal',
      value: { $type: 'custom', data: [1, 2, 3] },
    });
  });

  it('throws on NOT NULL column with literal null default', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          name: {
            codecId: 'pg/text@1',
            nativeType: 'text',
            nullable: false,
            default: { kind: 'literal', value: null },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /NOT NULL but has a literal null default/,
    );
  });

  describe('storage semantic validation', () => {
    it('rejects setNull referential action on NOT NULL FK column', () => {
      const contract = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'sha256:test',
        roots: { User: 'User', Post: 'Post' },
        models: {
          User: {
            storage: { table: 'user', fields: { id: { column: 'id' } } },
            fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
            relations: {
              posts: {
                to: 'Post',
                cardinality: '1:N',
                on: { localFields: ['id'], targetFields: ['userId'] },
              },
            },
          },
          Post: {
            storage: {
              table: 'post',
              fields: { id: { column: 'id' }, userId: { column: 'user_id' } },
            },
            fields: {
              id: { nullable: false, codecId: 'pg/int4@1' },
              userId: { nullable: false, codecId: 'pg/int4@1' },
            },
            relations: {
              author: {
                to: 'User',
                cardinality: 'N:1',
                on: { localFields: ['userId'], targetFields: ['id'] },
              },
            },
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [
                {
                  columns: ['user_id'],
                  references: { table: 'user', columns: ['id'] },
                  onDelete: 'setNull',
                  constraint: true,
                  index: true,
                },
              ],
            },
          },
        },
      };
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
        /semantic.*setNull.*user_id.*NOT NULL/i,
      );
    });
  });

  describe('normalizeContract edge cases', () => {
    it('passes through contract with no models field', () => {
      const contract = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        storage: { tables: {} },
      };

      const result = normalizeContract(contract) as Record<string, unknown>;
      expect(result['models']).toEqual({});
      expect(result['roots']).toEqual({});
    });

    it('handles new-format contract without explicit roots', () => {
      const contract = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'sha256:test',
        models: {
          User: {
            storage: { table: 'user', fields: { id: { column: 'id' } } },
            fields: { id: { nullable: false, codecId: 'pg/int4@1' } },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(contract);
      expect(result.roots).toEqual({});
    });
  });

  describe('normalizeStorage edge cases (via normalizeContract)', () => {
    it('handles table without columns property', () => {
      const contract = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        models: {
          User: {
            storage: { table: 'user', fields: { id: { column: 'id' } } },
            fields: { id: {} },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: { primaryKey: { columns: ['id'] } },
          },
        },
      };

      const result = normalizeContract(contract) as Record<string, unknown>;
      const storage = result['storage'] as Record<string, unknown>;
      const tables = storage['tables'] as Record<string, Record<string, unknown>>;
      expect(tables['user']).toBeDefined();
    });
  });
});
