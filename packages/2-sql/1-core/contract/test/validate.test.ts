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
  it('validates and computes mappings', () => {
    const result = validateContract<SqlContract<SqlStorage>>(baseContract);

    expect(result.mappings.modelToTable.User).toBe('User');
    expect(result.mappings.tableToModel.User).toBe('User');
    expect(result.mappings.fieldToColumn.User?.id).toBe('id');
    expect(result.mappings.columnToField.User?.email).toBe('email');
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
});
