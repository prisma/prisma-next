import type { Contract } from '@prisma-next/contract/types';
import { ContractValidationError } from '@prisma-next/contract/validate-contract';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { SqlStorage } from '../src/types';
import { validateContract } from '../src/validate';

const baseContract = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:test',
  roots: { User: 'User' },
  capabilities: {},
  extensionPacks: {},
  meta: {},
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
    storageHash: 'sha256:test-storage',
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
    const clone = structuredClone(baseContract) as Mutable<Contract<SqlStorage>>;
    if (tables) {
      (clone as Record<string, unknown>).storage = { storageHash: 'sha256:test-storage', tables };
      (clone as Record<string, unknown>).models = {};
      (clone as Record<string, unknown>).roots = {};
    }
    return clone;
  }

  it('accepts custom execution default generator ids', () => {
    const contract = {
      ...baseContract,
      execution: {
        executionHash: 'sha256:abc123',
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

    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
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
        executionHash: 'sha256:abc123',
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

    expect(() => validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws ContractValidationError with storage phase when primary key references missing column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.primaryKey = { columns: ['missing'] };

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      ContractValidationError,
    );
    try {
      validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup);
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).phase).toBe('storage');
      expect((e as ContractValidationError).code).toBe('CONTRACT.VALIDATION_FAILED');
    }
  });

  it('throws when unique references missing column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.uniques = [{ columns: ['missing'] }];

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /unique constraint references non-existent column/,
    );
  });

  it('throws when index references missing column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.indexes = [{ columns: ['missing'] }];

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /index references non-existent column/,
    );
  });

  it('throws when foreign key references missing local column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.foreignKeys = [
      {
        columns: ['missing'],
        references: { table: 'User', columns: ['id'] },
        constraint: true,
        index: true,
      },
    ];

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /foreignKey references non-existent column "missing"/,
    );
  });

  it('throws when foreign key references missing remote column', () => {
    const invalid = makeContract();
    invalid.storage.tables.User.foreignKeys = [
      {
        columns: ['id'],
        references: { table: 'User', columns: ['missing'] },
        constraint: true,
        index: true,
      },
    ];

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
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
        constraint: true,
        index: true,
      },
    ];

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /foreignKey column count \(2\) does not match referenced column count \(1\)/,
    );
  });

  it('throws for invalid foreign key table reference', () => {
    const invalid = makeContract();
    invalid.storage.tables.Post = {
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
          references: { table: 'Missing', columns: ['id'] },
          constraint: true,
          index: true,
        },
      ],
    };

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /foreignKey references non-existent table/,
    );
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
    expect(() => validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup)).toThrow(
      /NOT NULL but has a literal null default/,
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
          constraint: true,
          index: true,
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

    const result = validateContract<Contract<SqlStorage>>(valid, emptyCodecLookup);
    expect(result.storage.tables.Post.foreignKeys).toHaveLength(1);
    expect(result.storage.tables.User.indexes).toHaveLength(1);
  });

  it('accepts valid unique/index columns without triggering validation errors', () => {
    const valid = makeContract();
    valid.storage.tables.User.uniques = [{ columns: ['email'] }];
    valid.storage.tables.User.indexes = [{ columns: ['id'] }];

    const result = validateContract<Contract<SqlStorage>>(valid, emptyCodecLookup);
    expect(result.storage.tables.User.primaryKey).toEqual({ columns: ['id'] });
    expect(result.storage.tables.User.uniques).toHaveLength(1);
    expect(result.storage.tables.User.indexes).toHaveLength(1);
  });

  it('throws ContractValidationError with structural phase for non-object values', () => {
    expect(() => validateContract<Contract<SqlStorage>>(null, emptyCodecLookup)).toThrow(
      ContractValidationError,
    );
    try {
      validateContract<Contract<SqlStorage>>(null, emptyCodecLookup);
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).phase).toBe('structural');
    }
  });

  it('throws structural error when storage is non-object', () => {
    const invalid = {
      ...makeContract(),
      storage: 'invalid',
    } as unknown as Contract<SqlStorage>;

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /Invalid contract structure/,
    );
  });

  it('throws structural error when models is non-object', () => {
    const invalid = {
      ...makeContract(),
      models: 'invalid',
    } as unknown as Contract<SqlStorage>;

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /Invalid contract structure/,
    );
  });

  it('throws structural error when table columns are missing', () => {
    const invalid = makeContract();
    invalid.storage.tables.User = {
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    } as unknown as Mutable<Contract<SqlStorage>['storage']['tables']['User']>;

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('throws structural error when storage exists without tables', () => {
    const invalid = {
      ...makeContract(),
      storage: {},
    } as unknown as Contract<SqlStorage>;

    expect(() => validateContract<Contract<SqlStorage>>(invalid, emptyCodecLookup)).toThrow(
      /Contract structural validation failed/,
    );
  });

  it('keeps number default unchanged when codec lookup is empty', () => {
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          count: {
            codecId: 'pg/int8@1',
            nativeType: 'bigint',
            nullable: false,
            default: { kind: 'literal', value: 42 },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
    const col = result.storage.tables.User.columns.count;
    expect(col.default).toEqual({ kind: 'literal', value: 42 });
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
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
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
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
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
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
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
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
    const col = result.storage.tables.User.columns.status;
    expect(col.default).toEqual({ kind: 'literal', value: 'draft' });
  });

  it('keeps JSON object default unchanged when codec lookup is empty', () => {
    const jsonDefault = { key: 'value', nested: { count: 42 } } as const;
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          config: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            nullable: false,
            default: { kind: 'literal', value: jsonDefault },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
    expect(result.storage.tables.User.columns.config.default).toEqual({
      kind: 'literal',
      value: jsonDefault,
    });
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
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
    expect(result.storage.tables.User.columns.created_at.default).toEqual({
      kind: 'literal',
      value: 'not-a-date',
    });
  });

  it('keeps array default unchanged when codec lookup is empty', () => {
    const arrayDefault = ['alpha', 'beta'] as const;
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          tags: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            nullable: false,
            default: { kind: 'literal', value: arrayDefault },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
    expect(result.storage.tables.User.columns.tags.default).toEqual({
      kind: 'literal',
      value: arrayDefault,
    });
  });

  it('keeps nested JSON object default unchanged when codec lookup is empty', () => {
    const nestedDefault = { type: 'custom', data: [1, 2, 3] } as const;
    const contract = makeContract({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          meta: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            nullable: false,
            default: { kind: 'literal', value: nestedDefault },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup);
    expect(result.storage.tables.User.columns.meta.default).toEqual({
      kind: 'literal',
      value: nestedDefault,
    });
  });

  describe('storage semantic validation', () => {
    it('rejects setNull referential action on NOT NULL FK column', () => {
      const contract = {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: 'sha256:test',
        roots: { User: 'User', Post: 'Post' },
        capabilities: {},
        extensionPacks: {},
        meta: {},
        models: {
          User: {
            storage: { table: 'user', fields: { id: { column: 'id' } } },
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            },
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
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              userId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
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
          storageHash: 'sha256:test',
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
      expect(() => validateContract<Contract<SqlStorage>>(contract, emptyCodecLookup)).toThrow(
        /semantic.*setNull.*user_id.*NOT NULL/i,
      );
    });
  });

  describe('codec default decoding', () => {
    it('decodes literal defaults via codecLookup', () => {
      const contract = makeContract({
        event: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            starts_at: {
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
      const codecLookup = {
        get: (id: string) =>
          id === 'pg/timestamptz@1'
            ? {
                id: 'pg/timestamptz@1',
                targetTypes: ['timestamptz'] as const,
                decode: (w: unknown) => w,
                encodeJson: (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string)),
                decodeJson: (json: unknown) => new Date(json as string),
              }
            : undefined,
      };
      const result = validateContract(contract, codecLookup);
      const col = result.storage.tables.event.columns.starts_at;
      expect(col.default).toEqual({
        kind: 'literal',
        value: new Date('2025-01-01T00:00:00.000Z'),
      });
    });

    it('wraps non-ContractValidationError from codec.decodeJson', () => {
      const contract = makeContract({
        t: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            v: {
              codecId: 'bad/codec@1',
              nativeType: 'custom',
              nullable: false,
              default: { kind: 'literal', value: 'boom' },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      });
      const codecLookup = {
        get: (id: string) =>
          id === 'bad/codec@1'
            ? {
                id: 'bad/codec@1',
                targetTypes: ['custom'] as const,
                decode: () => null,
                encodeJson: () => '',
                decodeJson: () => {
                  throw new Error('decode exploded');
                },
              }
            : undefined,
      };
      expect(() => validateContract(contract, codecLookup)).toThrow(ContractValidationError);
      expect(() => validateContract(contract, codecLookup)).toThrow('decode exploded');
    });
  });

  describe('model-to-storage cross-validation', () => {
    it('rejects model whose storage.table does not exist in storage.tables with storage phase', () => {
      const contract = structuredClone(baseContract);
      (contract as Record<string, unknown>).models = {
        User: {
          storage: { table: 'nonexistent', fields: { id: { column: 'id' } } },
          fields: { id: {} },
          relations: {},
        },
      };
      expect(() => validateContract(contract, emptyCodecLookup)).toThrow(ContractValidationError);
      try {
        validateContract(contract, emptyCodecLookup);
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('storage');
        expect((e as ContractValidationError).message).toContain(
          'Model "User" references non-existent table "nonexistent"',
        );
      }
    });

    it('rejects model whose storage.fields reference a non-existent column', () => {
      const contract = structuredClone(baseContract);
      (contract as Record<string, unknown>).models = {
        User: {
          storage: {
            table: 'User',
            fields: { id: { column: 'id' }, email: { column: 'no_such_column' } },
          },
          fields: { id: {}, email: {} },
          relations: {},
        },
      };
      expect(() => validateContract(contract, emptyCodecLookup)).toThrow(
        'Model "User" field "email" references non-existent column "no_such_column" in table "User"',
      );
    });

    it('accepts a valid model-to-storage mapping', () => {
      expect(() => validateContract(structuredClone(baseContract), emptyCodecLookup)).not.toThrow();
    });
  });
});
