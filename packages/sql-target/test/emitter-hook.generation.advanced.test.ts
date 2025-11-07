import type { ContractIR } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';

describe('sql-target-family-hook', () => {
  it('generates contract types with model relations', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('relations: {');
    expect(types).toContain(
      "readonly posts: { readonly on: { readonly parentCols: readonly ['id']; readonly childCols: readonly ['userId'] } }",
    );
  });

  it('generates relations type from models', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('export type Relations');
    expect(types).toContain('readonly User.posts: unknown');
    expect(types).toContain('readonly User.comments: unknown');
  });

  it('generates relations type as empty when no relations', () => {
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
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('Record<string, never>');
  });

  it('generates mappings type from models and storage', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
            name: { column: 'name' },
          },
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
          },
        },
      },
    };

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
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            userId: { column: 'userId' },
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain("modelToTable: { readonly User: 'user'; readonly Post: 'post' }");
    expect(types).toContain("tableToModel: { readonly user: 'User'; readonly post: 'Post' }");
  });

  it('generates mappings type as SqlMappings when no models', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
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
    expect(types).toContain('SqlMappings');
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
