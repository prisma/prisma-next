import type { ContractIR } from '@prisma-next/contract/ir';
import type { ValidationContext } from '@prisma-next/contract/types';
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

describe('sql-target-family-hook', () => {
  it('validates types from referenced extensions', () => {
    const ir = createContractIR({
      extensions: {
        postgres: {
          version: '15.0.0',
        },
        pg: {},
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres', 'pg'],
    };

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('throws error for type ID from unreferenced extension', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'unknown/type@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres'],
    };

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).toThrow();
  });

  it('throws error for invalid type ID format', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'invalid-format', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).toThrow('invalid type ID format');
  });

  it('validates types from loaded packs even if not in extensions', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'postgres/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres'],
    };

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with missing column type', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).toThrow('is missing type');
  });

  it('validates types with type ID that fails regex match', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'invalid@format', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).toThrow('invalid type ID format');
  });

  it('validates types with empty storage', () => {
    const ir = createContractIR({
      storage: {
        tables: {},
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with missing storage', () => {
    const ir = createContractIR({});

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });
});
