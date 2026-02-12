import { describe, expect, it } from 'vitest';
import type { SqlContract, SqlStorage } from '../src/types';
import { validateContract } from '../src/validate';

const baseContract = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:test',
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

  function makeContract() {
    return structuredClone(baseContract) as Mutable<SqlContract<SqlStorage>>;
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
      codecTypes: { custom: { output: 'x' } as unknown },
      operationTypes: { customOp: { output: 'y' } as unknown },
    };

    const result = validateContract<SqlContract<SqlStorage>>(contract);
    expect(result.mappings).toMatchObject({
      modelToTable: { User: 'CustomUser' },
      tableToModel: { CustomUser: 'User' },
      fieldToColumn: { User: { id: 'identifier' } },
      columnToField: { CustomUser: { identifier: 'id' } },
    });
    expect(result.mappings.codecTypes.custom).toBeDefined();
    expect(result.mappings.operationTypes.customOp).toBeDefined();
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
});
