import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('validateContract', () => {
  const validContractInput = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
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
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  };

  it('performs both structural and logical validation', () => {
    const result = validateContract<Contract<SqlStorage>>(validContractInput);
    expect(result.storage.tables).toHaveProperty('User');
  });

  it('throws on structural validation failure', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: undefined } as any;
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(
      /Invalid contract structure|Contract header validation failed|structural validation failed/,
    );
  });

  it('accepts contract with valid primaryKey columns', () => {
    const valid = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(valid)).not.toThrow();
  });

  it('throws on semantic validation failure for duplicate named storage objects', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
        tables: {
          User: {
            ...validContractInput.storage.tables.User,
            primaryKey: { columns: ['id'], name: 'user_pkey' },
            indexes: [{ columns: ['id'], name: 'user_pkey' }],
          },
        },
      },
    };

    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(
      /Contract semantic validation failed:.*user_pkey/,
    );
  });

  it('accepts type parameter for strict contract type', () => {
    // Simulate JSON import - TypeScript infers string types, not literal types
    // The type parameter provides the strict type from contract.d.ts
    const contractJson = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
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
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const result = validateContract<Contract<SqlStorage>>(contractJson);
    // After validation, types should match the type parameter
    expectTypeOf(result).toEqualTypeOf<Contract<SqlStorage>>();
    // Verify structure is validated at runtime
    expect(result.storage.tables).toHaveProperty('User');
    expect(result.storage.tables['User']?.columns).toHaveProperty('id');
  });

  it('handles empty foreignKeys array', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
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
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('rejects foreignKey referencing non-existent table', () => {
    const contractInput = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
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
                constraint: true,
                index: true,
              },
            ],
          },
        },
      },
    };
    expect(() => validateContract<Contract<SqlStorage>>(contractInput)).toThrow(
      /foreignKey references non-existent table "NonExistent"/,
    );
  });
});
