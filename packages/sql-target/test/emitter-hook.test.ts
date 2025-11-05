import { describe, it, expect } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';
import type { ContractIR, ExtensionPackManifest } from '@prisma-next/emitter';

describe('sql-target-family-hook', () => {
  it('canonicalizes bare scalars', () => {
    const manifests: ExtensionPackManifest[] = [
      {
        id: 'postgres',
        version: '1.0.0',
        types: {
          canonicalScalarMap: {
            int4: 'pg/int4@1',
            text: 'pg/text@1',
          },
        },
      },
    ];

    expect(sqlTargetFamilyHook.canonicalizeType('int4', manifests)).toBe('pg/int4@1');
    expect(sqlTargetFamilyHook.canonicalizeType('text', manifests)).toBe('pg/text@1');
  });

  it('passes through typeIds', () => {
    const manifests: ExtensionPackManifest[] = [];
    expect(sqlTargetFamilyHook.canonicalizeType('pg/int4@1', manifests)).toBe('pg/int4@1');
  });

  it('throws error for unknown scalar', () => {
    const manifests: ExtensionPackManifest[] = [];
    expect(() => {
      sqlTargetFamilyHook.canonicalizeType('unknown', manifests);
    }).toThrow();
  });

  it('validates SQL structure', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
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
              id: { type: 'pg/int4@1', nullable: false },
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
      target: 'postgres',
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
      target: 'postgres',
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
              id: { type: 'pg/int4@1', nullable: false },
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

  it('gets types imports', () => {
    const packs = [
      {
        manifest: {
          id: 'postgres',
          version: '1.0.0',
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
        path: '/path/to/pack',
      },
    ];

    const imports = sqlTargetFamilyHook.getTypesImports(packs);
    expect(imports.length).toBe(1);
    expect(imports[0].package).toBe('@prisma-next/adapter-postgres/codec-types');
    expect(imports[0].named).toBe('CodecTypes');
    expect(imports[0].alias).toBe('PgTypes');
  });
});

