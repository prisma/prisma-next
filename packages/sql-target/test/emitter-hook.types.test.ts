import type { ContractIR, ExtensionPackManifest } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';

describe('sql-target-family-hook', () => {
  it('validates types from referenced extensions', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
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
    };

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
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'unknown/type@1', nullable: false },
            },
          },
        },
      },
    };

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
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'invalid-format', nullable: false },
            },
          },
        },
      },
    };

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).toThrow('invalid type ID format');
  });

  it('validates types from loaded packs even if not in extensions', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'postgres/int4@1', nullable: false },
            },
          },
        },
      },
    };

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
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nullable: false },
            },
          },
        },
      },
    };

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).toThrow('is missing type');
  });

  it('validates types with type ID that fails regex match', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'invalid@format', nullable: false },
            },
          },
        },
      },
    };

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).toThrow('invalid type ID format');
  });

  it('validates types with empty storage', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {},
      },
    };

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).not.toThrow();
  });

  it('validates types with missing storage', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
    };

    const manifests: ExtensionPackManifest[] = [];

    expect(() => {
      sqlTargetFamilyHook.validateTypes(ir, manifests);
    }).not.toThrow();
  });
});
