import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { describe, expect, it } from 'vitest';

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
            id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  };

  it('accepts valid contract structure', () => {
    const result = validateContract<SqlContract<SqlStorage>>(validContractInput);
    expect(result.storage.tables).toHaveProperty('User');
  });

  it('throws on missing targetFamily', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/targetFamily/);
  });

  it('throws on wrong targetFamily', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: 'document' } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /Unsupported target family/,
    );
  });

  it('throws on missing target', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, target: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/target/);
  });

  it('throws on missing coreHash', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, coreHash: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/coreHash/);
  });

  it('throws on missing storage', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, storage: undefined } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(/storage/);
  });

  it('throws on missing models', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
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
              id: { nativeType: 123 as unknown as string, codecId: 'pg/text@1', nullable: false },
            },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateContract<SqlContract<SqlStorage>>(invalid)).toThrow(
      /nativeType.*must be.*string|Column.*validation failed/,
    );
  });

  it('throws on invalid nullable type', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        tables: {
          User: {
            columns: {
              id: {
                nativeType: 'text',
                codecId: 'pg/text@1',
                nullable: 'yes' as unknown as boolean,
              },
            },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
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
