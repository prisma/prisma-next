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

  it('validates structure with missing targetFamily', () => {
    const ir: ContractIR = {
      target: 'test-db',
      storage: {
        tables: {},
      },
    } as ContractIR;

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('Expected targetFamily "sql"');
  });

  it('validates structure with missing storage', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with missing storage.tables', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {},
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('SQL contract must have storage.tables');
  });

  it('validates structure with model missing storage.table', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
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
    }).toThrow('is missing storage.table');
  });

  it('validates structure with model referencing non-existent table', () => {
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
    }).toThrow('references non-existent table');
  });

  it('validates structure with model table missing primary key', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
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
    }).toThrow('is missing a primary key');
  });

  it('validates structure with model field referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'nonexistent' },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('references non-existent column');
  });

  it('validates structure with missing model fields', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('is missing fields');
  });

  it('generates contract types with multiple extensions', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
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

    const packs = [
      {
        manifest: {
          id: 'postgres',
          version: '15.0.0',
          types: {
            codecTypes: {
              import: {
                package: '@prisma-next/adapter-postgres/codec-types',
                named: 'CodecTypes',
                alias: 'PgTypes',
              },
            },
          },
        },
        path: '/path/to/postgres',
      },
      {
        manifest: {
          id: 'pgvector',
          version: '1.0.0',
          types: {
            codecTypes: {
              import: {
                package: '@prisma-next/pgvector/codec-types',
                named: 'CodecTypes',
                alias: 'VectorTypes',
              },
            },
          },
        },
        path: '/path/to/pgvector',
      },
    ];

    const types = sqlTargetFamilyHook.generateContractTypes(ir, packs);
    expect(types).toContain('PgTypes');
    expect(types).toContain('VectorTypes');
  });

  it('gets types imports with multiple extensions', () => {
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
      {
        manifest: {
          id: 'test-extension',
          version: '1.0.0',
          types: {
            codecTypes: {
              import: {
                package: '@test/extension/codec-types',
                named: 'CodecTypes',
                alias: 'ExtensionTypes',
              },
            },
          },
        },
        path: '/path/to/extension',
      },
    ];

    const imports = sqlTargetFamilyHook.getTypesImports(packs);
    expect(imports.length).toBe(2);
    expect(imports[0]?.package).toBe('@test/adapter/codec-types');
    expect(imports[1]?.package).toBe('@test/extension/codec-types');
  });

  it('gets types imports with packs without codecTypes', () => {
    const packs = [
      {
        manifest: {
          id: 'test-adapter',
          version: '1.0.0',
        },
        path: '/path/to/pack',
      },
    ];

    const imports = sqlTargetFamilyHook.getTypesImports(packs);
    expect(imports.length).toBe(0);
  });
});
