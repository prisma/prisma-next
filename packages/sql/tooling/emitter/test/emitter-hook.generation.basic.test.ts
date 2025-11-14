import type { ContractIR } from '@prisma-next/contract/ir';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import { describe, expect, it } from 'vitest';
import {
  extractCodecTypeImportsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '../../../../framework/tooling/cli/src/pack-assembly';
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
  it('generates contract types', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'sql/int4@1', nullable: false },
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
    expect(types).toContain('export type Contract');
    expect(types).toContain('CodecTypes');
  });

  it('generates contract types with correct import path', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'sql/int4@1', nullable: false },
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
    expect(types).toContain(
      "import type { SqlContract, SqlStorage, SqlMappings, ModelDefinition } from '@prisma-next/sql-contract/types';",
    );
    expect(types).not.toContain("from './contract-types'");
  });

  it('gets types imports', () => {
    const packs: { readonly manifest: ExtensionPackManifest; readonly path: string }[] = [
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

    const codecImports = extractCodecTypeImportsFromPacks(packs);
    const operationImports = extractOperationTypeImportsFromPacks(packs);
    expect(codecImports.length).toBe(1);
    expect(codecImports[0]?.package).toBe('@test/adapter/codec-types');
    expect(codecImports[0]?.named).toBe('CodecTypes');
    expect(codecImports[0]?.alias).toBe('TestTypes');
    expect(operationImports.length).toBe(0);
  });

  it('generates contract types with multiple extensions', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const packs: { readonly manifest: ExtensionPackManifest; readonly path: string }[] = [
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

    const codecTypeImports = extractCodecTypeImportsFromPacks(packs);
    const operationTypeImports = extractOperationTypeImportsFromPacks(packs);
    const types = sqlTargetFamilyHook.generateContractTypes(
      ir,
      codecTypeImports,
      operationTypeImports,
    );
    expect(types).toContain('PgTypes');
    expect(types).toContain('VectorTypes');
  });

  it('generates contract types with uniques in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain("readonly columns: readonly ['email']");
  });

  it('generates contract types with uniques with names in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'unique_email' }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain("readonly name: 'unique_email'");
  });

  it('generates contract types with indexes in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['email'] }],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain('indexes: readonly');
    expect(types).toContain("readonly columns: readonly ['email']");
  });

  it('generates contract types with indexes with names in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['email'], name: 'idx_email' }],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain('indexes: readonly');
    expect(types).toContain("readonly name: 'idx_email'");
  });

  it('generates contract types with foreignKeys in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain('foreignKeys: readonly');
    expect(types).toContain("readonly columns: readonly ['userId']");
    expect(types).toContain("readonly table: 'user'");
    expect(types).toContain("readonly columns: readonly ['id']");
  });

  it('generates contract types with foreignKeys with names in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
                name: 'fk_post_user',
              },
            ],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain('foreignKeys: readonly');
    expect(types).toContain("readonly name: 'fk_post_user'");
  });

  it('generates contract types with primaryKey with name in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'], name: 'pk_user' },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], []);
    expect(types).toContain("readonly name: 'pk_user'");
  });

  it('generates contract types with nullable columns', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
            name: { column: 'name' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
              name: { type: 'pg/text@1', nullable: true },
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
    expect(types).toContain("readonly name: CodecTypes['pg/text@1']['output'] | null");
    expect(types).toContain("readonly email: CodecTypes['pg/text@1']['output']");
  });

  it('generates contract types with model field missing column reference', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'nonexistent' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
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
    expect(types).toContain("readonly email: { readonly column: 'nonexistent' }");
  });

  it('generates contract types with model referencing missing table', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'nonexistent' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
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
    expect(types).toContain("readonly id: { readonly column: 'id' }");
  });

  it('generates contract types with undefined models', () => {
    const ir = createContractIR({
      models: undefined,
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
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
    expect(types).toContain('Record<string, never>');
    expect(types).toContain('SqlMappings');
  });
});
