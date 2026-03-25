import { describe, expect, it } from 'vitest';
import type { SqlContract, SqlStorage } from '../src/types';
import { validateContract } from '../src/validate';

const baseContract = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:test',
  storageHash: 'sha256:test-storage',
  models: {
    User: {
      storage: { table: 'User' },
      fields: {
        id: { column: 'id' },
        email: { column: 'email' },
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

  it('validates and computes mappings', () => {
    const result = validateContract<SqlContract<SqlStorage>>(baseContract);

    expect(result.mappings).toMatchObject({
      modelToTable: { User: 'User' },
      tableToModel: { User: 'User' },
      fieldToColumn: { User: { id: 'id' } },
      columnToField: { User: { email: 'email' } },
    });
  });

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
    normalized.relations = undefined as unknown as SqlContract<SqlStorage>['relations'];
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
    expect(result.relations).toEqual({});
    expect(result.extensionPacks).toEqual({});
    expect(result.capabilities).toEqual({});
    expect(result.meta).toEqual({});
    expect(result.sources).toEqual({});
  });

  it('keeps precomputed mappings when provided', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'CustomUser' },
      tableToModel: { CustomUser: 'User' },
      fieldToColumn: { User: { id: 'identifier', email: 'mail' } },
      columnToField: { CustomUser: { identifier: 'id', mail: 'email' } },
    };

    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.mappings).toMatchObject({
      modelToTable: { User: 'CustomUser' },
      tableToModel: { CustomUser: 'User' },
      fieldToColumn: { User: { id: 'identifier' } },
      columnToField: { CustomUser: { identifier: 'id' } },
    });
    expect(result.mappings).not.toHaveProperty('codecTypes');
    expect(result.mappings).not.toHaveProperty('operationTypes');
  });

  it('throws when only one side of model/table override is provided', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'CustomUser' },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /modelToTable and tableToModel must be provided together/,
    );
  });

  it('throws when model/table overrides are not inverse', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'CustomUser' },
      tableToModel: { WrongTable: 'User' },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /Mappings override mismatch/,
    );
  });

  it('throws when only one side of field/column override is provided', () => {
    const contract = makeContract();
    contract.mappings = {
      fieldToColumn: { User: { id: 'identifier' } },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /fieldToColumn and columnToField must be provided together/,
    );
  });

  it('throws when field/column overrides are not inverse', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'CustomUser' },
      tableToModel: { CustomUser: 'User' },
      fieldToColumn: { User: { id: 'identifier' } },
      columnToField: { CustomUser: { wrong: 'id' } },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /Mappings override mismatch/,
    );
  });

  it('throws when tableToModel contains an unmapped reverse entry', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'CustomUser' },
      tableToModel: { CustomUser: 'User', User: 'User' },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /tableToModel\..*is not mirrored in modelToTable/,
    );
  });

  it('throws when fieldToColumn references unknown model', () => {
    const contract = makeContract();
    contract.mappings = {
      fieldToColumn: { MissingModel: { id: 'id' } },
      columnToField: { User: { id: 'id' } },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /fieldToColumn references unknown model "MissingModel"/,
    );
  });

  it('throws when columnToField missing table for mapped model', () => {
    const contract = makeContract();
    contract.mappings = {
      fieldToColumn: { User: { id: 'id' } },
      columnToField: {},
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /columnToField is missing table "User" for model "User"/,
    );
  });

  it('throws when columnToField references unknown table', () => {
    const contract = makeContract();
    contract.mappings = {
      fieldToColumn: { User: { id: 'id' } },
      columnToField: {
        User: { id: 'id' },
        Ghost: { id: 'id' },
      },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /columnToField references unknown table "Ghost"/,
    );
  });

  it('throws when fieldToColumn missing model for known table', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'CustomUser' },
      tableToModel: { CustomUser: 'User' },
      fieldToColumn: {},
      columnToField: {
        CustomUser: { id: 'id' },
      },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /fieldToColumn is missing model "User" for table "CustomUser"/,
    );
  });

  it('throws when columnToField has entry not mirrored in fieldToColumn', () => {
    const contract = makeContract();
    contract.mappings = {
      fieldToColumn: { User: { id: 'id' } },
      columnToField: {
        User: {
          id: 'id',
          email: 'missingField',
        },
      },
    };

    expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
      /columnToField\..*is not mirrored in fieldToColumn/,
    );
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
      storage: { table: 'Post' },
      fields: {
        id: { column: 'id' },
        userId: { column: 'userId' },
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

  it('accepts null mapping buckets by treating them as empty overrides', () => {
    const contract = makeContract();
    contract.mappings = {
      modelToTable: { User: 'User' },
      tableToModel: { User: 'User' },
      fieldToColumn: null as unknown as Record<string, Record<string, string>>,
      columnToField: null as unknown as Record<string, Record<string, string>>,
    };

    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.mappings.fieldToColumn).toEqual({});
    expect(result.mappings.columnToField).toEqual({});
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
});
