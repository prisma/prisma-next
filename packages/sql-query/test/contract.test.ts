import { describe, expect, it, expectTypeOf } from 'vitest';
import { validateContract } from '../src/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';

describe('validateContract structure validation', () => {
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
          },
          primaryKey: { columns: ['id'] },
        },
      },
    },
  };

  it('accepts valid contract structure', () => {
    const result = validateContract<SqlContract<SqlStorage>>(validContractInput);
    expect(result.storage.tables).toHaveProperty('User');
  });

  it('throws on missing targetFamily', () => {
    const invalid = { ...validContractInput, targetFamily: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/targetFamily/);
  });

  it('throws on wrong targetFamily', () => {
    const invalid = { ...validContractInput, targetFamily: 'document' } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/targetFamily/);
  });

  it('throws on missing target', () => {
    const invalid = { ...validContractInput, target: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/target/);
  });

  it('throws on missing coreHash', () => {
    const invalid = { ...validContractInput, coreHash: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/coreHash/);
  });

  it('throws on missing storage', () => {
    const invalid = { ...validContractInput, storage: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/storage/);
  });

  it('throws on missing models', () => {
    const invalid = { ...validContractInput, models: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/models/);
  });

  it('throws on invalid column type', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 123, nullable: false },
            },
          },
        },
      },
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Column.*validation failed|type.*must be.*string/,
    );
  });

  it('throws on invalid nullable type', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'pg/text@1', nullable: 'yes' },
            },
          },
        },
      },
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Column.*validation failed|nullable.*must be.*boolean/,
    );
  });

  it('validates optional fields', () => {
    const withOptional = {
      ...validContractInput,
      profileHash: 'sha256:profile',
      capabilities: { feature: { enabled: true } },
      extensions: { pack: { config: true } },
      meta: { key: 'value' },
    };
    const result = validateContract<SqlContract<SqlStorage>>(withOptional);
    expect(result.profileHash).toBe('sha256:profile');
    expect(result.capabilities).toEqual({ feature: { enabled: true } });
  });
});

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
        },
        Post: {
          columns: {
            id: { type: 'pg/text@1', nullable: false },
            userId: { type: 'pg/text@1', nullable: false },
            title: { type: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
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
            ...validContractInput.storage.tables['User'],
            primaryKey: { columns: ['nonExistent'] },
          },
        },
      },
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
            ...validContractInput.storage.tables['User'],
            uniques: [{ columns: ['nonExistent'] }],
          },
        },
      },
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
            ...validContractInput.storage.tables['User'],
            indexes: [{ columns: ['nonExistent'] }],
          },
        },
      },
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
          Post: {
            ...validContractInput.storage.tables['Post'],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'NonExistent', columns: ['id'] },
              },
            ],
          },
        },
      },
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
          Post: {
            ...validContractInput.storage.tables['Post'],
            foreignKeys: [
              {
                columns: ['nonExistent'],
                references: { table: 'User', columns: ['id'] },
              },
            ],
          },
        },
      },
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
          User: validContractInput.storage.tables['User'],
          Post: {
            ...validContractInput.storage.tables['Post'],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['nonExistent'] },
              },
            ],
          },
        },
      },
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
          User: validContractInput.storage.tables['User'],
          Post: {
            ...validContractInput.storage.tables['Post'],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['id', 'email'] },
              },
            ],
          },
        },
      },
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
          },
          Post: {
            columns: {
              id: { type: 'pg/text@1', nullable: false },
              userId: { type: 'pg/text@1', nullable: false },
              tenantId: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
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

describe('validateContract', () => {
  const validContract = validateContract<SqlContract<SqlStorage>>({
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
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
        },
      },
    },
  });

  it('performs both structural and logical validation', () => {
    const result = validateContract<SqlContract<SqlStorage>>(validContract);
    expect(result).toEqual(validContract);
  });

  it('throws on structural validation failure', () => {
    const invalid = { ...validContract, targetFamily: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Invalid targetFamily|Contract header validation failed|structural validation failed/,
    );
  });

  it('throws on logical validation failure', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: {
            ...validContract.storage.tables['User'],
            primaryKey: { columns: ['nonExistent'] },
          },
        },
      },
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /primaryKey references non-existent column/,
    );
  });

  it('accepts type parameter for strict contract type', () => {
    // Simulate JSON import - TypeScript infers string types, not literal types
    // The type parameter provides the strict type from contract.d.ts
    const contractJson = {
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
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };
    const result = validateContract<SqlContract<SqlStorage>>(contractJson);
    // After validation, types should match the type parameter
    expectTypeOf(result).toMatchTypeOf<SqlContract<SqlStorage>>();
    // Verify structure is validated at runtime
    expect(result.storage.tables).toHaveProperty('User');
    expect(result.storage.tables['User']?.columns).toHaveProperty('id');
  });
});

