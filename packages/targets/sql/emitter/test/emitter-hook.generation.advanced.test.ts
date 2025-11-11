import type { ContractIR } from '@prisma-next/contract/ir';
import type { ExtensionPack } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { extractTypeImports } from '../../../framework/tooling/cli/src/pack-assembly';
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
  it('generates contract types with model relations', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              on: {
                parentCols: ['id'],
                childCols: ['userId'],
              },
            },
          },
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('relations: {');
    expect(types).toContain(
      "readonly posts: { readonly on: { readonly parentCols: readonly ['id']; readonly childCols: readonly ['userId'] } }",
    );
  });

  it('generates relations type with through table', () => {
    const ir = createContractIR({
      relations: {
        user: {
          posts: {
            to: 'Post',
            cardinality: '1:N',
            on: {
              parentCols: ['id'],
              childCols: ['userId'],
            },
            through: {
              table: 'user_post',
              parentCols: ['userId'],
              childCols: ['postId'],
            },
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
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Relations');
    expect(types).toContain('readonly user: {');
    expect(types).toContain('readonly posts: {');
    expect(types).toContain('readonly through:');
    expect(types).toContain("readonly table: 'user_post'");
  });

  it('generates relations type with non-object relation value', () => {
    const ir = createContractIR({
      relations: {
        user: {
          posts: null as unknown,
          comments: 'invalid' as unknown,
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Relations');
    expect(types).toContain('readonly user: {');
    expect(types).toContain('readonly posts: unknown');
    expect(types).toContain('readonly comments: unknown');
  });

  it('generates relations type with relation having no properties', () => {
    const ir = createContractIR({
      relations: {
        user: {
          posts: {},
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Relations');
    expect(types).toContain('readonly user: {');
    expect(types).toContain('readonly posts: unknown');
  });

  it('generates mappings type when models is undefined', () => {
    const ir = createContractIR({
      models: {},
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('SqlMappings');
    expect(types).toContain('codecTypes: Record<string, never>');
    expect(types).toContain('operationTypes: Record<string, never>');
  });

  it('generates mappings type when models is undefined with codecTypes', () => {
    const packs: ExtensionPack[] = [
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

    const ir = createContractIR({
      models: {},
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

    const typeImports = extractTypeImports(packs);
    const types = sqlTargetFamilyHook.generateContractTypes(ir, typeImports);
    expect(types).toContain('SqlMappings');
    expect(types).toContain('codecTypes: TestTypes');
    expect(types).toContain('operationTypes: Record<string, never>');
  });

  it('generates mappings type when models is undefined with codecTypes', () => {
    const ir = createContractIR({
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

    const packs: ExtensionPack[] = [
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

    const typeImports = extractTypeImports(packs);
    const types = sqlTargetFamilyHook.generateContractTypes(ir, typeImports);
    expect(types).toContain('SqlMappings');
    expect(types).toContain('codecTypes: TestTypes');
    expect(types).toContain('operationTypes: Record<string, never>');
  });

  it('generates relations type with non-object table relations value', () => {
    const ir = createContractIR({
      relations: {
        user: null as unknown,
        post: 'invalid' as unknown,
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Relations');
    expect(types).toContain('Record<string, never>');
  });

  it('generates relations type from models', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {
            posts: {
              on: {
                parentCols: ['id'],
                childCols: ['userId'],
              },
            },
            comments: {
              on: {
                parentCols: ['id'],
                childCols: ['authorId'],
              },
            },
          },
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Relations');
    // Relations type is table-based, not model-based
    // The test data doesn't include ir.relations, so Relations will be Record<string, never>
    // But we can verify that relations are embedded in the Models type
    expect(types).toContain('readonly posts: { readonly on:');
    expect(types).toContain('readonly comments: { readonly on:');
  });

  it('generates relations type as empty when no relations', () => {
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

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('Record<string, never>');
  });

  it('generates mappings type from models and storage', () => {
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
              name: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Contract');
    expect(types).toContain("modelToTable: { readonly User: 'user' }");
    expect(types).toContain("tableToModel: { readonly user: 'User' }");
    expect(types).toContain(
      "fieldToColumn: { readonly User: { readonly id: 'id'; readonly email: 'email'; readonly name: 'name' } }",
    );
    expect(types).toContain(
      "columnToField: { readonly user: { readonly id: 'id'; readonly email: 'email'; readonly name: 'name' } }",
    );
  });

  it('generates mappings type with multiple models', () => {
    const ir = createContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
          },
          relations: {},
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain("modelToTable: { readonly User: 'user'; readonly Post: 'post' }");
    expect(types).toContain("tableToModel: { readonly user: 'User'; readonly post: 'Post' }");
  });

  it('generates mappings type as SqlMappings when no models', () => {
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
        },
      },
    });

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('SqlMappings');
  });

  it('gets types imports with multiple extensions', () => {
    const packs: ExtensionPack[] = [
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

    const imports = extractTypeImports(packs);
    expect(imports.length).toBe(2);
    expect(imports[0]?.package).toBe('@test/adapter/codec-types');
    expect(imports[1]?.package).toBe('@test/extension/codec-types');
  });

  it('gets types imports with packs without codecTypes', () => {
    const packs: ExtensionPack[] = [
      {
        manifest: {
          id: 'test-adapter',
          version: '1.0.0',
        },
        path: '/path/to/pack',
      },
    ];

    const imports = extractTypeImports(packs);
    expect(imports.length).toBe(0);
  });

  it('gets types imports using extractTypeImports', () => {
    const packs: ExtensionPack[] = [
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
            operationTypes: {
              import: {
                package: '@test/adapter/operation-types',
                named: 'OperationTypes',
                alias: 'TestOps',
              },
            },
          },
        },
        path: '/path/to/pack',
      },
    ];

    const imports = extractTypeImports(packs);
    expect(imports.length).toBe(2);
    expect(imports[0]?.package).toBe('@test/adapter/codec-types');
    expect(imports[1]?.package).toBe('@test/adapter/operation-types');
  });
});
