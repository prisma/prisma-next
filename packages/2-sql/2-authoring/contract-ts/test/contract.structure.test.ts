import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { describe, expect, it } from 'vitest';

describe('validateContract structure validation', () => {
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
    const result = validateContract<Contract<SqlStorage>>(validContractInput);
    expect(result.storage.tables).toHaveProperty('User');
  });

  it('throws on missing targetFamily', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: undefined } as any;
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(/targetFamily/);
  });

  it('throws on wrong targetFamily', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, targetFamily: 'document' } as any;
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(
      /Unsupported target family/,
    );
  });

  it('throws on missing target', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, target: undefined } as any;
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(/target/);
  });

  it('preserves storageHash in storage', () => {
    const result = validateContract<Contract<SqlStorage>>(validContractInput);
    expect(result.storage.storageHash).toMatch(/^sha256:/);
  });

  it('throws on missing storage', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, storage: undefined } as any;
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(/storage/);
  });

  it('throws on missing models', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    const invalid = { ...validContractInput, models: undefined } as any;
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(/models/);
  });

  it('throws on invalid column type', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(
      /nativeType.*must be.*string|Column.*validation failed/,
    );
  });

  it('throws on invalid nullable type', () => {
    const invalid = {
      ...validContractInput,
      storage: {
        storageHash: 'sha256:test',
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
    expect(() => validateContract<Contract<SqlStorage>>(invalid)).toThrow(
      /Column.*validation failed|nullable.*must be.*boolean/,
    );
  });

  it('validates optional fields', () => {
    const withOptional = {
      ...validContractInput,
      profileHash: 'sha256:profile',
      capabilities: { feature: { enabled: true } },
      extensionPacks: { pack: { config: true } },
      meta: { key: 'value' },
      roots: {},
    };
    const result = validateContract<Contract<SqlStorage>>(withOptional);
    expect(result.profileHash).toBe('sha256:profile');
    expect(result.capabilities).toEqual({ feature: { enabled: true } });
  });
});
