import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract.ts';

describe('validateContract logic validation', () => {
  const validContractInput = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {},
    storage: {
      tables: {
        User: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            name: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['name'] }],
          foreignKeys: [],
        },
        Post: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [
            {
              columns: ['userId'],
              references: { table: 'User', columns: ['id'] },
            },
          ],
        },
      },
    },
  };

  it('accepts valid contract logic', () => {
    expect(() => validateContract<SqlContract<SqlStorage>>(validContractInput)).not.toThrow();
  });

  it('throws when primaryKey references non-existent column', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            primaryKey: { columns: ['nonExistent'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /primaryKey references non-existent column/,
    );
  });

  it('throws when unique constraint references non-existent column', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            uniques: [{ columns: ['nonExistent'] }],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /unique constraint references non-existent column/,
    );
  });

  it('throws when index references non-existent column', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            indexes: [{ columns: ['nonExistent'] }],
            uniques: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /index references non-existent column/,
    );
  });

  it('throws when foreignKey references non-existent table', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'NonExistent', columns: ['id'] },
              },
            ],
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey references non-existent table/,
    );
  });

  it('throws when foreignKey references non-existent column in referencing table', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['nonExistent'],
                references: { table: 'User', columns: ['id'] },
              },
            ],
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistent/,
    );
  });

  it('throws when foreignKey references non-existent column in referenced table', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['nonExistent'] },
              },
            ],
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistent.*User/,
    );
  });

  it('throws when foreignKey column count mismatch', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            ...validContractInput.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['id', 'email'] },
              },
            ],
            uniques: [],
            indexes: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /column count.*does not match/,
    );
  });

  it('throws when foreignKey references non-existent column in referenced table after validating table exists', () => {
    const invalid = {
      ...validContractInput,
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
                references: { table: 'User', columns: ['nonExistentColumn'] },
              },
            ],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistentColumn.*User/,
    );
  });

  it('throws when foreignKey column count mismatch after validating all columns exist', () => {
    const invalid = {
      ...validContractInput,
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
                references: { table: 'User', columns: ['id', 'email'] },
              },
            ],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /column count.*does not match/,
    );
  });

  it('throws when composite foreignKey column count mismatch with all columns existing', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              tenantId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id', 'tenantId'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              tenantId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId', 'tenantId'],
                references: { table: 'User', columns: ['id', 'tenantId', 'id'] },
              },
            ],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /column count.*does not match/,
    );
  });

  it('validates composite primary keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: {
        tables: {
          UserRole: {
            columns: {
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              roleId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['userId', 'roleId'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('validates composite foreign keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              tenantId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id', 'tenantId'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              tenantId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId', 'tenantId'],
                references: { table: 'User', columns: ['id', 'tenantId'] },
              },
            ],
          },
        },
      },
    };
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).not.toThrow();
  });

  describe('model validation', () => {
    const createModelContract = () =>
      ({
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        models: {
          User: {
            storage: { table: 'User' },
            fields: {
              id: { column: 'id' },
            },
            relations: {},
          },
        },
        storage: {
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
      }) as Record<string, unknown>;

    const addPostModel = (contract: Record<string, unknown>) => {
      (contract['models'] as Record<string, Record<string, unknown>>)['Post'] = {
        storage: { table: 'Post' },
        fields: {
          id: { column: 'id' },
          userId: { column: 'userId' },
        },
        relations: {},
      };
      (
        (contract['storage'] as Record<string, Record<string, unknown>>)?.['tables'] as Record<
          string,
          Record<string, unknown>
        >
      )['Post'] = {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      return contract;
    };

    it('throws when a model references a missing table', () => {
      const contract = createModelContract();
      const userModel = (contract['models'] as Record<string, Record<string, unknown>>)[
        'User'
      ] as Record<string, unknown>;
      userModel['storage'] = { table: 'MissingTable' };
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
        /references non-existent table "MissingTable"/,
      );
    });

    it('throws when the model table lacks a primary key', () => {
      const contract = createModelContract();
      delete (
        (contract['storage'] as Record<string, Record<string, unknown>>)?.['tables'] as Record<
          string,
          Record<string, unknown>
        >
      )?.['User']?.['primaryKey'];
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
        /table "User" is missing a primary key/,
      );
    });

    it('throws when a model field references a missing column', () => {
      const contract = createModelContract();
      const userModel = (contract['models'] as Record<string, Record<string, unknown>>)[
        'User'
      ] as Record<string, unknown>;
      userModel['fields'] = { id: { column: 'missing' } };
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
        /references non-existent column "missing"/,
      );
    });

    it('skips foreign key validation for 1:N relations', () => {
      const contract = addPostModel(createModelContract());
      (
        (contract['models'] as Record<string, Record<string, unknown>>)?.['User'] as Record<
          string,
          unknown
        >
      )['relations'] = {
        posts: {
          to: 'Post',
          on: { parentCols: ['id'], childCols: ['userId'] },
          cardinality: '1:N',
        },
      };
      (
        (
          (contract['storage'] as Record<string, Record<string, unknown>>)?.['tables'] as Record<
            string,
            Record<string, unknown>
          >
        )?.['Post'] as Record<string, unknown>
      )['foreignKeys'] = [
        {
          columns: ['userId'],
          references: { table: 'User', columns: ['id'] },
        },
      ];
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).not.toThrow();
    });

    it('throws when an N:1 relation lacks a matching foreign key', () => {
      const contract = addPostModel(createModelContract());
      (
        (contract['models'] as Record<string, Record<string, unknown>>)?.['Post'] as Record<
          string,
          unknown
        >
      )['relations'] = {
        user: {
          to: 'User',
          on: { parentCols: ['id'], childCols: ['userId'] },
          cardinality: 'N:1',
        },
      };
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow(
        /relation "user" does not have a corresponding foreign key/,
      );
    });

    it('accepts N:1 relations with matching foreign keys', () => {
      const contract = addPostModel(createModelContract());
      (
        (contract['models'] as Record<string, Record<string, unknown>>)?.['Post'] as Record<
          string,
          unknown
        >
      )['relations'] = {
        user: {
          to: 'User',
          on: { parentCols: ['id'], childCols: ['userId'] },
          cardinality: 'N:1',
        },
      };
      (
        (
          (contract['storage'] as Record<string, Record<string, unknown>>)?.['tables'] as Record<
            string,
            Record<string, unknown>
          >
        )?.['Post'] as Record<string, unknown>
      )['foreignKeys'] = [
        {
          columns: ['userId'],
          references: { table: 'User', columns: ['id'] },
        },
      ];
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).not.toThrow();
    });
  });
});
