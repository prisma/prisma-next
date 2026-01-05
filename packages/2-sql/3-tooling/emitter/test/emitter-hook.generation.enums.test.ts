import type { ContractIR } from '@prisma-next/contract/ir';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/index';

function createContractIR(overrides: Partial<ContractIR>): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'test-db',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensions: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('sql-target-family-hook enum generation', () => {
  it('generates enum types in storage', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              role: { nativeType: 'Role', codecId: 'pg/enum@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        enums: {
          Role: { values: ['USER', 'ADMIN'] },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);

    // Enum should be included in storage.enums type
    expect(types).toContain(
      "readonly enums: { readonly Role: { readonly values: readonly ['USER', 'ADMIN'] } }",
    );
  });

  it('generates export type aliases for enums', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        enums: {
          Role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
          Status: { values: ['ACTIVE', 'INACTIVE'] },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);

    // Convenience export type aliases for enums
    expect(types).toContain("export type Role = 'USER' | 'ADMIN' | 'MODERATOR';");
    expect(types).toContain("export type Status = 'ACTIVE' | 'INACTIVE';");
  });

  it('generates empty enums object when no enums defined', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);

    // Empty enums object
    expect(types).toContain('readonly enums: Record<string, never>');
  });

  it('generates enums in sorted order for deterministic output', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        enums: {
          Zebra: { values: ['A', 'B'] },
          Alpha: { values: ['X', 'Y'] },
          Middle: { values: ['M', 'N'] },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);

    // Enum export types should be in alphabetical order
    const alphaPos = types.indexOf("export type Alpha = 'X' | 'Y';");
    const middlePos = types.indexOf("export type Middle = 'M' | 'N';");
    const zebraPos = types.indexOf("export type Zebra = 'A' | 'B';");

    expect(alphaPos).toBeGreaterThan(-1);
    expect(middlePos).toBeGreaterThan(-1);
    expect(zebraPos).toBeGreaterThan(-1);
    expect(alphaPos).toBeLessThan(middlePos);
    expect(middlePos).toBeLessThan(zebraPos);
  });

  it('handles enum with single value', () => {
    const ir = createContractIR({
      storage: {
        tables: {},
        enums: {
          SingleValue: { values: ['ONLY'] },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);

    expect(types).toContain("export type SingleValue = 'ONLY';");
  });
});
