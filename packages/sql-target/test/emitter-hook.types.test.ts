import type { ContractIR, ExtensionPackManifest } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';

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

    const manifests: ExtensionPackManifest[] = [
      {
        id: 'postgres',
        version: '15.0.0',
      },
    ];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
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

    const manifests: ExtensionPackManifest[] = [
      {
        id: 'postgres',
        version: '15.0.0',
      },
    ];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
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

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
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

    const manifests: ExtensionPackManifest[] = [
      {
        id: 'postgres',
        version: '15.0.0',
      },
    ];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
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

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
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

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).toThrow('invalid type ID format');
  });

  it('validates types with empty storage', () => {
    const ir = createContractIR({
      storage: {
        tables: {},
      },
    });

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).not.toThrow();
  });

  it('validates types with missing storage', () => {
    const ir = createContractIR({
    });

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).not.toThrow();
  });
});
