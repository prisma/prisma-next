import { describe, it, expect } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';
import type { ContractIR, ExtensionPackManifest } from '@prisma-next/emitter';

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

  it('validates SQL structure', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'sql/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).not.toThrow();
  });

  it('throws error for invalid structure', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'nonexistent' },
          fields: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow();
  });

  it('generates contract types', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'sql/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Contract');
    expect(types).toContain('CodecTypes');
  });

  it('generates contract types with correct import path', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'sql/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain("import type { SqlContract, SqlStorage, SqlMappings, ModelDefinition } from '@prisma-next/sql-target';");
    expect(types).not.toContain("from './contract-types'");
  });

  it('gets types imports', () => {
    const packs = [
      {
        manifest: {
          id: 'test-adapter',
          version: '1.0.0',
          types: {
            codecTypes: {
              import: {
                package: '@test/adapter/codec-types',
                named: 'CodecTypes',
                alias: 'TestTypes',
              },
            },
          },
        },
        path: '/path/to/pack',
      },
    ];

    const imports = sqlTargetFamilyHook.getTypesImports(packs);
    expect(imports.length).toBe(1);
    expect(imports[0]?.package).toBe('@test/adapter/codec-types');
    expect(imports[0]?.named).toBe('CodecTypes');
    expect(imports[0]?.alias).toBe('TestTypes');
  });
});
