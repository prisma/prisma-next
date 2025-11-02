import { describe, expect, it, expectTypeOf } from 'vitest';
import {
  validateContract,
  validateContractStructure,
  validateContractLogic,
} from '../src/contract';
import type { SqlContract } from '@prisma-next/contract/types';

describe('validateContractStructure', () => {
  const validContract: SqlContract = {
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
  };

  it('accepts valid contract structure', () => {
    const result = validateContractStructure(validContract);
    expect(result).toEqual(validContract);
  });

  it('throws on missing targetFamily', () => {
    const invalid = { ...validContract, targetFamily: undefined };
    expect(() => validateContractStructure(invalid)).toThrow(/targetFamily/);
  });

  it('throws on wrong targetFamily', () => {
    const invalid = { ...validContract, targetFamily: 'document' };
    expect(() => validateContractStructure(invalid)).toThrow(/targetFamily/);
  });

  it('throws on missing target', () => {
    const invalid = { ...validContract, target: undefined };
    expect(() => validateContractStructure(invalid)).toThrow(/target/);
  });

  it('throws on missing coreHash', () => {
    const invalid = { ...validContract, coreHash: undefined };
    expect(() => validateContractStructure(invalid)).toThrow(/coreHash/);
  });

  it('throws on missing storage', () => {
    const invalid = { ...validContract, storage: undefined };
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
    };
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
    };
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
  const validContract: SqlContract = {
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
  };

  it('accepts valid contract logic', () => {
    expect(() => validateContractLogic(validContract)).not.toThrow();
  });

  it('throws when primaryKey references non-existent column', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: {
            ...validContract.storage.tables.User,
            primaryKey: { columns: ['nonExistent'] },
          },
        },
      },
    };
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
            ...validContract.storage.tables.User,
            uniques: [{ columns: ['nonExistent'] }],
          },
        },
      },
    };
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
            ...validContract.storage.tables.User,
            indexes: [{ columns: ['nonExistent'] }],
          },
        },
      },
    };
    expect(() => validateContractLogic(invalid)).toThrow(/index references non-existent column/);
  });

  it('throws when foreignKey references non-existent table', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          Post: {
            ...validContract.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'NonExistent', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
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
            ...validContract.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['nonExistent'],
                references: { table: 'User', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
    expect(() => validateContractLogic(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistent/,
    );
  });

  it('throws when foreignKey references non-existent column in referenced table', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: validContract.storage.tables.User,
          Post: {
            ...validContract.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['nonExistent'] },
              },
            ],
          },
        },
      },
    };
    expect(() => validateContractLogic(invalid)).toThrow(
      /foreignKey references non-existent column.*nonExistent.*User/,
    );
  });

  it('throws when foreignKey column count mismatch', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: validContract.storage.tables.User,
          Post: {
            ...validContract.storage.tables.Post,
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'User', columns: ['id', 'email'] },
              },
            ],
          },
        },
      },
    };
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
  const validContract: SqlContract = {
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
  };

  it('performs both structural and logical validation', () => {
    const result = validateContract(validContract);
    expect(result).toEqual(validContract);
  });

  it('throws on structural validation failure', () => {
    const invalid = { ...validContract, targetFamily: undefined };
    expect(() => validateContract(invalid)).toThrow(
      /Invalid targetFamily|Contract header validation failed|structural validation failed/,
    );
  });

  it('throws on logical validation failure', () => {
    const invalid = {
      ...validContract,
      storage: {
        tables: {
          User: {
            ...validContract.storage.tables.User,
            primaryKey: { columns: ['nonExistent'] },
          },
        },
      },
    };
    expect(() => validateContract(invalid)).toThrow(/primaryKey references non-existent column/);
  });

  it('preserves structure types from JSON imports', () => {
    // Simulate JSON import - TypeScript infers string types, not literal types
    const contract = {
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
    const result = validateContract(contract);
    // After validation, types should be SqlContract-compatible
    // Note: JSON imports don't preserve literal types, so we verify structure instead
    expectTypeOf(result).toMatchTypeOf<SqlContract>();
    expectTypeOf(result.targetFamily).toEqualTypeOf<string>();
    expectTypeOf(result.target).toEqualTypeOf<string>();
    // Verify table names are preserved in structure
    expectTypeOf(result.storage.tables).toHaveProperty('User');
    // Verify column names are preserved
    expectTypeOf(result.storage.tables.User.columns).toHaveProperty('id');
  });
});
