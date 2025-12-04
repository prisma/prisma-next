import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateContract } from '../src/contract';

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
  });

  it('performs both structural and logical validation', () => {
    const result = validateContract<SqlContract<SqlStorage>>(validContract);
    expect(result).toEqual(validContract);
  });

  it('throws on structural validation failure', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
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
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
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
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
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

  it('handles missing relations field', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      relations: undefined,
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
    };
    const result = validateContract<SqlContract<SqlStorage>>(contractInput);
    // Relations can be undefined if not provided
    expect(result).toBeDefined();
  });

  it('handles missing mappings field', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      relations: {},
      mappings: undefined,
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
    };
    const result = validateContract<SqlContract<SqlStorage>>(contractInput);
    expect(result.mappings).toBeDefined();
    expect(result.mappings.modelToTable).toBeDefined();
    expect(result.mappings.tableToModel).toBeDefined();
    expect(result.mappings.fieldToColumn).toBeDefined();
    expect(result.mappings.columnToField).toBeDefined();
  });

  it('handles empty foreignKeys array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      relations: {},
      mappings: {},
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
    };
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('handles missing foreignKey references table', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      relations: {},
      mappings: {},
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
                references: { table: 'NonExistent', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).toThrow(
      /foreignKey references non-existent table/,
    );
  });

  it('handles foreignKey with missing referenced table', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'sha256:test',
      models: {},
      relations: {},
      mappings: {},
      storage: {
        tables: {
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
                references: { table: 'User', columns: ['id'] },
              },
            ],
          },
        },
      },
    };
    expect(() => validateContract<SqlContract<SqlStorage>>(contractInput)).toThrow(
      /foreignKey references non-existent table/,
    );
  });
});
