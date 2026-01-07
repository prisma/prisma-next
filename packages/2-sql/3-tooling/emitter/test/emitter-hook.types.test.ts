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
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('sql-target-family-hook', () => {
  it('validates types from referenced extensions', () => {
    const ir = createContractIR({
      extensionPacks: {
        postgres: {
          version: '0.0.1',
        },
        pg: {},
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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

  it('validates type ID format regardless of namespace', () => {
    // Namespace validation removed - codecs can use any namespace
    // Only format validation remains (ns/name@version)
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'unknown/type@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres'],
    };

    // Should not throw - namespace validation removed
    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('throws error for invalid type ID format', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'invalid-format', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).toThrow('invalid codec ID format');
  });

  it('validates types from loaded packs even if not in extensions', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'postgres/int4@1', nullable: false },
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
    }).toThrow('is missing codecId');
  });

  it('validates types with type ID that fails regex match', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'invalid@format', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).toThrow('invalid codec ID format');
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

  it('validates types with storage but no tables', () => {
    const ir = createContractIR({
      storage: {
        // No tables property - should hit early return at line 16
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types regardless of extensionIds', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['invalid-extension-id-without-slash'],
    };

    // Should not throw - extensionIds are not validated here
    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with undefined extensions', () => {
    const ir = {
      targetFamily: 'sql',
      storage: { tables: {} },
      extensions: undefined,
    } as unknown as ContractIR;

    expect(() => sqlTargetFamilyHook.validateTypes(ir, {})).not.toThrow();
  });
});
