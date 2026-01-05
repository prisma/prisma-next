import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { normalizeContract, validateContract } from '../src/contract';

describe('validateContract enum validation', () => {
  const baseContract = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {},
    storage: {
      tables: {
        User: {
          columns: {
            id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  };

  describe('storage.enums structure', () => {
    it('accepts contract with empty enums', () => {
      const contract = {
        ...baseContract,
        storage: {
          ...baseContract.storage,
          enums: {},
        },
      };
      const result = validateContract<SqlContract<SqlStorage>>(contract);
      expect(result.storage.enums).toEqual({});
    });

    it('accepts contract with valid enum definition', () => {
      const contract = {
        ...baseContract,
        storage: {
          ...baseContract.storage,
          enums: {
            role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
          },
        },
      };
      const result = validateContract<SqlContract<SqlStorage>>(contract);
      expect(result.storage.enums).toEqual({
        role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
      });
    });

    it('accepts contract with multiple enums', () => {
      const contract = {
        ...baseContract,
        storage: {
          ...baseContract.storage,
          enums: {
            role: { values: ['USER', 'ADMIN'] },
            status: { values: ['ACTIVE', 'INACTIVE', 'PENDING'] },
          },
        },
      };
      const result = validateContract<SqlContract<SqlStorage>>(contract);
      expect(Object.keys(result.storage.enums ?? {})).toHaveLength(2);
    });

    it('normalizes missing enums to empty object', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);
      expect(result.storage.enums).toEqual({});
    });
  });

  describe('enum column encoding', () => {
    it('accepts column with enum codecId and nativeType referencing enum', () => {
      const contract = {
        ...baseContract,
        storage: {
          tables: {
            User: {
              columns: {
                id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                role: { nativeType: 'role', codecId: 'pg/enum@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          enums: {
            role: { values: ['USER', 'ADMIN'] },
          },
        },
      };
      const result = validateContract<SqlContract<SqlStorage>>(contract);
      expect(result.storage.tables['User']?.columns['role']).toEqual({
        nativeType: 'role',
        codecId: 'pg/enum@1',
        nullable: false,
      });
    });

    it('accepts nullable enum column', () => {
      const contract = {
        ...baseContract,
        storage: {
          tables: {
            User: {
              columns: {
                id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                role: { nativeType: 'role', codecId: 'pg/enum@1', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          enums: {
            role: { values: ['USER', 'ADMIN'] },
          },
        },
      };
      const result = validateContract<SqlContract<SqlStorage>>(contract);
      expect(result.storage.tables['User']?.columns['role']?.nullable).toBe(true);
    });
  });

  describe('enum validation errors', () => {
    it('throws on invalid enum values (non-string array)', () => {
      const contract = {
        ...baseContract,
        storage: {
          ...baseContract.storage,
          enums: {
            role: { values: [1, 2, 3] },
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      } as any;
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow();
    });

    it('throws on enum with non-array values', () => {
      const contract = {
        ...baseContract,
        storage: {
          ...baseContract.storage,
          enums: {
            role: { values: 'USER' },
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      } as any;
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow();
    });

    it('throws on enum missing values property', () => {
      const contract = {
        ...baseContract,
        storage: {
          ...baseContract.storage,
          enums: {
            role: {},
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      } as any;
      expect(() => validateContract<SqlContract<SqlStorage>>(contract)).toThrow();
    });
  });
});

describe('normalizeContract enum normalization', () => {
  it('defaults storage.enums to {} when missing', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {},
      },
    };
    const normalized = normalizeContract(contractInput);
    expect(normalized.storage.enums).toEqual({});
  });

  it('preserves existing enums during normalization', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      storage: {
        tables: {},
        enums: {
          role: { values: ['USER', 'ADMIN'] },
        },
      },
    };
    const normalized = normalizeContract(contractInput);
    expect(normalized.storage.enums).toEqual({
      role: { values: ['USER', 'ADMIN'] },
    });
  });
});
