import type { ContractIR } from '@prisma-next/contract/ir';
import type { TypeRenderEntry } from '@prisma-next/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import {
  extractCodecTypeImports,
  extractOperationTypeImports,
} from '../../family/src/core/assembly';
import { sqlTargetFamilyHook } from '../src/index';

type TestDescriptor =
  | ControlTargetDescriptor<'sql', string>
  | ControlAdapterDescriptor<'sql', string>
  | ControlExtensionDescriptor<'sql', string>;

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

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

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
              id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain(
      "import type { SqlContract, SqlStorage, SqlMappings, ModelDefinition } from '@prisma-next/sql-contract/types';",
    );
    expect(types).not.toContain("from './contract-types'");
  });

  it('gets types imports', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    const operationImports = extractOperationTypeImports(descriptors);
    expect(codecImports).toEqual([
      {
        package: '@test/adapter/codec-types',
        named: 'CodecTypes',
        alias: 'TestTypes',
      },
    ]);
    expect(operationImports).toEqual([]);
  });

  it('generates contract types with multiple extensions', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/adapter-postgres/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
          },
        },
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      },
      {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/pgvector/codec-types',
              named: 'CodecTypes',
              alias: 'VectorTypes',
            },
          },
        },
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      },
    ];

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const operationTypeImports = extractOperationTypeImports(descriptors);
    expect(codecTypeImports).toEqual([
      {
        package: '@prisma-next/adapter-postgres/codec-types',
        named: 'CodecTypes',
        alias: 'PgTypes',
      },
      { package: '@prisma-next/pgvector/codec-types', named: 'CodecTypes', alias: 'VectorTypes' },
    ]);
    expect(operationTypeImports).toEqual([]);
    const types = sqlTargetFamilyHook.generateContractTypes(
      ir,
      codecTypeImports,
      operationTypeImports,
      testHashes,
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'unique_email' }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain("readonly name: 'unique_email'");
  });

  it('generates contract types with composite uniques in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              first_name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              last_name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['first_name', 'last_name'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain("readonly columns: readonly ['first_name', 'last_name']");
  });

  it('generates contract types with indexes in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['email'] }],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['email'], name: 'idx_email' }],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'], name: 'pk_user' },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain("readonly id: { readonly column: 'id' }");
  });

  it('generates contract types with undefined models', () => {
    const ir = createContractIR({
      models: undefined,
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain('Record<string, never>');
    expect(types).toContain('SqlMappings');
  });

  it('generates contract types with column nullable undefined defaults to false', () => {
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
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: undefined as unknown as boolean,
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    // When nullable is undefined, it should default to false (not nullable)
    expect(types).toContain("readonly id: CodecTypes['pg/int4@1']['output']");
    expect(types).not.toContain("readonly id: CodecTypes['pg/int4@1']['output'] | null");
  });

  it('renders parameterized type when column has typeParams and renderer exists', () => {
    const ir = createContractIR({
      models: {
        Embedding: {
          storage: { table: 'embedding' },
          fields: {
            id: { column: 'id' },
            vector: { column: 'vector' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          embedding: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              vector: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 1536 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const vectorRenderer: TypeRenderEntry = {
      codecId: 'pg/vector@1',
      render: (params) => `Vector<${params['length']}>`,
    };

    const parameterizedRenderers = new Map<string, TypeRenderEntry>();
    parameterizedRenderers.set('pg/vector@1', vectorRenderer);

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes, {
      parameterizedRenderers,
    });

    // The parameterized renderer should be used for the vector column
    expect(types).toContain('readonly vector: Vector<1536>');
    // The scalar codec should still use CodecTypes lookup
    expect(types).toContain("readonly id: CodecTypes['pg/int4@1']['output']");
  });

  it('falls back to CodecTypes when column has typeParams but no renderer', () => {
    const ir = createContractIR({
      models: {
        Embedding: {
          storage: { table: 'embedding' },
          fields: {
            vector: { column: 'vector' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          embedding: {
            columns: {
              vector: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 1536 },
              },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    // No parameterized renderers provided
    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);

    // Should fall back to CodecTypes lookup since no renderer exists
    expect(types).toContain("readonly vector: CodecTypes['pg/vector@1']['output']");
    expect(types).not.toContain('Vector<1536>');
  });

  it('generates contract types with no operation type imports', () => {
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

    // Pass empty operationTypeImports array to test filter/map on lines 278-279
    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain('export type OperationTypes = Record<string, never>');
  });

  it('filters operation type imports to only OperationTypes', () => {
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

    // Include operation type imports with different named values to test filter on line 278
    const operationTypeImports = [
      { package: '@test/ops', named: 'OperationTypes', alias: 'TestOps' },
      { package: '@test/other', named: 'OtherTypes', alias: 'Other' },
    ];

    const types = sqlTargetFamilyHook.generateContractTypes(
      ir,
      [],
      operationTypeImports,
      testHashes,
    );
    // Only OperationTypes should be included in the intersection, not OtherTypes
    // (OtherTypes will still be imported but not used in the OperationTypes type)
    expect(types).toContain('export type OperationTypes = TestOps');
    expect(types).not.toContain('export type OperationTypes = TestOps & Other');
  });

  it('generates contract types with extension-owned index config in storage', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                using: 'bm25',
                name: 'search_idx',
                config: {
                  keyField: 'id',
                  fields: [
                    {
                      column: 'description',
                      tokenizer: 'simple',
                      tokenizerParams: { stemmer: 'english' },
                    },
                  ],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain("readonly using: 'bm25'");
    expect(types).toContain("readonly config: { readonly keyField: 'id'");
    expect(types).toContain("readonly name: 'search_idx'");
    expect(types).toContain("readonly column: 'description'");
    expect(types).toContain("readonly tokenizer: 'simple'");
    expect(types).toContain("readonly stemmer: 'english'");
  });

  it('generates contract types with expression entries in extension config', () => {
    const ir = createContractIR({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                using: 'bm25',
                config: {
                  keyField: 'id',
                  fields: [
                    {
                      expression: "description || ' ' || category",
                      alias: 'concat',
                      tokenizer: 'simple',
                    },
                  ],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, [], [], testHashes);
    expect(types).toContain("readonly expression: 'description || \\' \\' || category'");
    expect(types).toContain("readonly alias: 'concat'");
  });

  it('serializes empty typeParams to Record<string, never>', () => {
    const result = sqlTargetFamilyHook.serializeTypeParamsLiteral({});
    expect(result).toBe('Record<string, never>');
  });

  it('serializes bigint values correctly', () => {
    const result = sqlTargetFamilyHook.serializeValue(BigInt('12345678901234567890'));
    expect(result).toBe('12345678901234567890n');
  });

  it('serializes unknown types as unknown', () => {
    // Test with a function (not serializable)
    const result = sqlTargetFamilyHook.serializeValue(() => {});
    expect(result).toBe('unknown');

    // Test with a symbol
    const symbolResult = sqlTargetFamilyHook.serializeValue(Symbol('test'));
    expect(symbolResult).toBe('unknown');
  });
});
