import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { describe, expect, it } from 'vitest';

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
            id: { type: 'pg/text@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
            name: { type: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['name'] }],
          foreignKeys: [],
        },
        Post: {
          columns: {
            id: { type: 'pg/text@1', nullable: false },
            userId: { type: 'pg/text@1', nullable: false },
            title: { type: 'pg/text@1', nullable: false },
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

  it('validates composite primary keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: {
        tables: {
          UserRole: {
            columns: {
              userId: { type: 'pg/text@1', nullable: false },
              roleId: { type: 'pg/text@1', nullable: false },
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
              id: { type: 'pg/text@1', nullable: false },
              tenantId: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id', 'tenantId'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
              userId: { type: 'pg/text@1', nullable: false },
              tenantId: { type: 'pg/text@1', nullable: false },
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
});
