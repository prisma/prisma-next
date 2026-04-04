import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';

describe('validateContract logic validation', () => {
  const validContractInput = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test',
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
              constraint: true,
              index: true,
            },
          ],
        },
      },
    },
  };

  it('accepts valid contract logic', () => {
    expect(() => validateContract<Contract<SqlStorage>>(validContractInput)).not.toThrow();
  });

  it('rejects invalid execution-default generator ids', () => {
    const invalid = {
      ...validContractInput,
      execution: {
        executionHash: 'sha256:test',
        mutations: {
          defaults: [
            {
              ref: {
                table: 'User',
                column: 'id',
              },
              onCreate: {
                kind: 'generator',
                id: 'invalid generator id',
              },
            },
          ],
        },
      },
    };

    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(/a flat generator id/);
  });

  it('rejects primaryKey referencing non-existent column', () => {
    const contract = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            primaryKey: { columns: ['nonExistent'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow(
      /primaryKey references non-existent column "nonExistent"/,
    );
  });

  it('rejects unique referencing non-existent column', () => {
    const contract = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            uniques: [{ columns: ['nonExistent'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow(
      /unique constraint references non-existent column "nonExistent"/,
    );
  });

  it('rejects index referencing non-existent column', () => {
    const contract = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            indexes: [{ columns: ['nonExistent'] }],
            uniques: [],
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow(
      /index references non-existent column "nonExistent"/,
    );
  });

  it('rejects foreignKey referencing non-existent table', () => {
    const contract = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
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
                constraint: true,
                index: true,
              },
            ],
            uniques: [],
            indexes: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow(
      /foreignKey references non-existent table "NonExistent"/,
    );
  });

  it('validates composite primary keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('validates composite foreign keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
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
                constraint: true,
                index: true,
              },
            ],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  describe('model validation', () => {
    const createModelContract = () =>
      ({
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'sha256:test',
        profileHash: 'sha256:test',
        capabilities: {},
        extensionPacks: {},
        meta: {},
        roots: {},
        models: {
          User: {
            storage: { table: 'User', fields: { id: { column: 'id' } } },
            fields: {
              id: { column: 'id' },
            },
            relations: {},
          },
        },
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
      }) as Record<string, unknown>;

    const addPostModel = (contract: Record<string, unknown>) => {
      (contract['models'] as Record<string, Record<string, unknown>>)['Post'] = {
        storage: {
          table: 'Post',
          fields: { id: { column: 'id' }, userId: { column: 'userId' } },
        },
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

    it('rejects model referencing missing table', () => {
      const contract = createModelContract();
      const userModel = (contract['models'] as Record<string, Record<string, unknown>>)[
        'User'
      ] as Record<string, unknown>;
      userModel['storage'] = { table: 'MissingTable', fields: {} };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow(
        /references non-existent table "MissingTable"/,
      );
    });

    it('accepts model table without primary key', () => {
      const contract = createModelContract();
      delete (
        (contract['storage'] as Record<string, Record<string, unknown>>)?.['tables'] as Record<
          string,
          Record<string, unknown>
        >
      )?.['User']?.['primaryKey'];
      expect(() => validateContract<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('rejects model field referencing missing column', () => {
      const contract = createModelContract();
      const userModel = (contract['models'] as Record<string, Record<string, unknown>>)[
        'User'
      ] as Record<string, Record<string, unknown>>;
      (userModel['storage'] as Record<string, unknown>)['fields'] = {
        id: { column: 'missing' },
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow(
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
          on: { localFields: ['id'], targetFields: ['userId'] },
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
          constraint: true,
          index: true,
        },
      ];
      expect(() => validateContract<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('accepts N:1 relation without matching FK', () => {
      const contract = addPostModel(createModelContract());
      (
        (contract['models'] as Record<string, Record<string, unknown>>)?.['Post'] as Record<
          string,
          unknown
        >
      )['relations'] = {
        user: {
          to: 'User',
          on: { localFields: ['userId'], targetFields: ['id'] },
          cardinality: 'N:1',
        },
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).not.toThrow();
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
          on: { localFields: ['userId'], targetFields: ['id'] },
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
          constraint: true,
          index: true,
        },
      ];
      expect(() => validateContract<Contract<SqlStorage>>(contract)).not.toThrow();
    });
  });

  describe('column defaults', () => {
    const baseContract = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      profileHash: 'sha256:test',
      capabilities: {},
      extensionPacks: {},
      meta: {},
      roots: {},
      models: {},
      storage: {
        storageHash: 'sha256:test',
        tables: {
          Post: {
            columns: {
              id: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                default: { kind: 'function', expression: 'gen_random_uuid()' },
              },
              title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };

    it('accepts function defaults without capability gating', () => {
      expect(() => validateContract<Contract<SqlStorage>>(baseContract)).not.toThrow();
    });

    it('accepts multiple function defaults without capability gating', () => {
      const contract = {
        ...baseContract,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            Post: {
              columns: {
                id: {
                  codecId: 'pg/int4@1',
                  nativeType: 'int4',
                  nullable: false,
                  default: { kind: 'function', expression: 'autoincrement()' },
                },
                createdAt: {
                  codecId: 'pg/timestamptz@1',
                  nativeType: 'timestamptz',
                  nullable: false,
                  default: { kind: 'function', expression: 'now()' },
                },
                externalId: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                  nullable: false,
                  default: { kind: 'function', expression: 'gen_random_uuid()' },
                },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('ignores non-function defaults (literal)', () => {
      const contract = {
        ...baseContract,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            Post: {
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
          },
        },
        // No capabilities needed for non-function defaults
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('keeps ISO string defaults as strings for timestamp columns', () => {
      const contract = {
        ...baseContract,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            Post: {
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                createdAt: {
                  codecId: 'pg/timestamptz@1',
                  nativeType: 'timestamptz',
                  nullable: false,
                  default: { kind: 'literal', value: '2024-01-01T00:00:00.000Z' },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };

      const validated = validateContract<Contract<SqlStorage>>(contract);
      const defaultValue = validated.storage.tables['Post']!.columns['createdAt']!.default;
      if (defaultValue?.kind !== 'literal') {
        throw new Error('Expected literal default');
      }
      expect(defaultValue.value).toBe('2024-01-01T00:00:00.000Z');
    });

    it('throws for default with unsupported kind', () => {
      const contract = {
        ...baseContract,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            Post: {
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                status: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                  nullable: false,
                  default: { kind: 'now', expression: 'now()' },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow();
    });

    it('throws for default missing value', () => {
      const contract = {
        ...baseContract,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            Post: {
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                status: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                  nullable: false,
                  default: { kind: 'literal' },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow();
    });

    it('throws for default expression with non-string type', () => {
      const contract = {
        ...baseContract,
        storage: {
          storageHash: 'sha256:test',
          tables: {
            Post: {
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                status: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                  nullable: false,
                  default: { kind: 'function', expression: 123 },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      };
      expect(() => validateContract<Contract<SqlStorage>>(contract)).toThrow();
    });
  });
});
