import { describe, expect, it, expectTypeOf } from 'vitest';
import {
  validateContract,
  validateContractStructure,
  validateContractLogic,
} from '../src/contract';
import type { SqlContract, SqlStorage } from '../src/contract-types';

describe('validateContractStructure', () => {
  const validContract = validateContract<SqlContract<SqlStorage>>({
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    storage: {
      tables: {
        User: {
          columns: {
            id: { type: 'text', nullable: false },
            email: { type: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
        },
      },
    },
  });

  it('accepts valid contract structure', () => {
    const result = validateContractStructure(validContract);
    expect(result).toEqual(validContract);
  });

  it('throws on missing targetFamily', () => {
    const invalid = { ...validContract, targetFamily: undefined } as any;
    expect(() => validateContractStructure(invalid)).toThrow(/targetFamily/);
  });

  it('throws on wrong targetFamily', () => {
    const invalid = { ...validContract, targetFamily: 'document' } as any;
    expect(() => validateContractStructure(invalid)).toThrow(/targetFamily/);
  });

  it('throws on missing target', () => {
    const invalid = { ...validContract, target: undefined } as any;
    expect(() => validateContractStructure(invalid)).toThrow(/target/);
  });

  it('throws on missing coreHash', () => {
    const invalid = { ...validContract, coreHash: undefined } as any;
    expect(() => validateContractStructure(invalid)).toThrow(/coreHash/);
  });

  it('throws on missing storage', () => {
    const invalid = { ...validContract, storage: undefined } as any;
    expect(() => validateContractStructure(invalid)).toThrow(/storage/);
  });

  it('throws on invalid column type', () => {
    const invalid = {
      ...validContract,
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
    expect(() => validateContractStructure(invalid)).toThrow(
      /Column.*validation failed|type.*must be.*string/,
    );
  });

  it('throws on invalid nullable type', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'text', nullable: 'yes' },
            },
          },
        },
      },
    } as any;
    expect(() => validateContractStructure(invalid)).toThrow(
      /Column.*validation failed|nullable.*must be.*boolean/,
    );
  });

  it('validates optional fields', () => {
    const withOptional = {
      ...validContract,
      profileHash: 'sha256:profile',
      capabilities: { feature: { enabled: true } },
      extensions: { pack: { config: true } },
      meta: { key: 'value' },
    };
    const result = validateContractStructure(withOptional);
    expect(result).toEqual(withOptional);
  });
});

describe('validateContractLogic', () => {
  const validContract = validateContract<SqlContract<SqlStorage>>({
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    storage: {
      tables: {
        User: {
          columns: {
            id: { type: 'text', nullable: false },
            email: { type: 'text', nullable: false },
            name: { type: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['name'] }],
        },
        Post: {
          columns: {
            id: { type: 'text', nullable: false },
            userId: { type: 'text', nullable: false },
            title: { type: 'text', nullable: false },
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
  });

  it('accepts valid contract logic', () => {
    expect(() => validateContractLogic(validContract)).not.toThrow();
  });

  it('throws when primaryKey references non-existent column', () => {
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
    expect(() => validateContractLogic(invalid)).toThrow(
      /primaryKey references non-existent column/,
    );
  });

  it('throws when unique constraint references non-existent column', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: {
            ...validContract.storage.tables['User'],
            uniques: [{ columns: ['nonExistent'] }],
          },
        },
      },
    } as any;
    expect(() => validateContractLogic(invalid)).toThrow(
      /unique constraint references non-existent column/,
    );
  });

  it('throws when index references non-existent column', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: {
            ...validContract.storage.tables['User'],
            indexes: [{ columns: ['nonExistent'] }],
          },
        },
      },
    } as any;
    expect(() => validateContractLogic(invalid)).toThrow(/index references non-existent column/);
  });

  it('throws when foreignKey references non-existent table', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          Post: {
            ...validContract.storage.tables['Post'],
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
    expect(() => validateContractLogic(invalid)).toThrow(
      /foreignKey references non-existent table/,
    );
  });

  it('throws when foreignKey references non-existent column in referencing table', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          Post: {
            ...validContract.storage.tables['Post'],
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
    expect(() => validateContractLogic(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistent/,
    );
  });

  it('throws when foreignKey references non-existent column in referenced table', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: validContract.storage.tables['User'],
          Post: {
            ...validContract.storage.tables['Post'],
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
    expect(() => validateContractLogic(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistent.*User/,
    );
  });

  it('throws when foreignKey column count mismatch', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: validContract.storage.tables['User'],
          Post: {
            ...validContract.storage.tables['Post'],
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
    expect(() => validateContractLogic(invalid)).toThrow(/column count.*does not match/);
  });

  it('validates composite primary keys', () => {
    const contract = {
      ...validContract,
      storage: {
        tables: {
          UserRole: {
            columns: {
              userId: { type: 'text', nullable: false },
              roleId: { type: 'text', nullable: false },
            },
            primaryKey: { columns: ['userId', 'roleId'] },
          },
        },
      },
    };
    expect(() => validateContractLogic(contract)).not.toThrow();
  });

  it('validates composite foreign keys', () => {
    const contract = {
      ...validContract,
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'text', nullable: false },
              tenantId: { type: 'text', nullable: false },
            },
            primaryKey: { columns: ['id', 'tenantId'] },
          },
          Post: {
            columns: {
              id: { type: 'text', nullable: false },
              userId: { type: 'text', nullable: false },
              tenantId: { type: 'text', nullable: false },
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
    expect(() => validateContractLogic(contract)).not.toThrow();
  });
});

describe('validateContract', () => {
  const validContract = validateContract<SqlContract<SqlStorage>>({
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    storage: {
      tables: {
        User: {
          columns: {
            id: { type: 'text', nullable: false },
            email: { type: 'text', nullable: false },
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
      storage: {
        tables: {
          User: {
            columns: {
              id: { type: 'text', nullable: false },
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
