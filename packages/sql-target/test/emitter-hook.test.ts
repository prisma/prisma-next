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
    expect(types).toContain(
      "import type { SqlContract, SqlStorage, SqlMappings, ModelDefinition } from '@prisma-next/sql-target';",
    );
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

  it('validates structure with model field missing column property', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: {},
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
    }).toThrow('is missing column property');
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
      targetFamily: undefined as unknown as string,
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

  it('generates contract types with uniques in storage', () => {
    const ir: ContractIR = {
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
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain("readonly columns: readonly ['email']");
  });

  it('generates contract types with uniques with names in storage', () => {
    const ir: ContractIR = {
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
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain("readonly name: 'unique_email'");
  });

  it('generates contract types with indexes in storage', () => {
    const ir: ContractIR = {
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
            indexes: [{ columns: ['email'] }],
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('indexes: readonly');
    expect(types).toContain("readonly columns: readonly ['email']");
  });

  it('generates contract types with indexes with names in storage', () => {
    const ir: ContractIR = {
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
            indexes: [{ columns: ['email'], name: 'idx_email' }],
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('indexes: readonly');
    expect(types).toContain("readonly name: 'idx_email'");
  });

  it('generates contract types with foreignKeys in storage', () => {
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('foreignKeys: readonly');
    expect(types).toContain("readonly columns: readonly ['userId']");
    expect(types).toContain("readonly table: 'user'");
    expect(types).toContain("readonly columns: readonly ['id']");
  });

  it('generates contract types with foreignKeys with names in storage', () => {
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain('foreignKeys: readonly');
    expect(types).toContain("readonly name: 'fk_post_user'");
  });

  it('generates contract types with primaryKey with name in storage', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'], name: 'pk_user' },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain("readonly name: 'pk_user'");
  });

  it('generates contract types with nullable columns', () => {
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
              name: { type: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain("readonly name: CodecTypes['pg/text@1']['output'] | null");
    expect(types).toContain("readonly email: CodecTypes['pg/text@1']['output']");
  });

  it('generates contract types with model field missing column reference', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'nonexistent' },
          },
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
          },
        },
      },
    };

    const types = sqlTargetFamilyHook.generateContractTypes(ir, []);
    expect(types).toContain("readonly email: { readonly column: 'nonexistent' }");
  });

  it('generates contract types with model referencing missing table', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      models: {
        User: {
          storage: { table: 'nonexistent' },
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
    expect(types).toContain("readonly id: { readonly column: 'id' }");
  });

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

  it('validates structure with primaryKey referencing non-existent column', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['nonexistent'] },
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('primaryKey references non-existent column');
  });

  it('validates structure with unique constraint referencing non-existent column', () => {
    const ir: ContractIR = {
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
            uniques: [{ columns: ['nonexistent'] }],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('unique constraint references non-existent column');
  });

  it('validates structure with index referencing non-existent column', () => {
    const ir: ContractIR = {
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
            indexes: [{ columns: ['nonexistent'] }],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent column', () => {
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['nonexistent'],
                references: { table: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent table', () => {
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'nonexistent', columns: ['id'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent table');
  });

  it('validates structure with foreignKey referencing non-existent referenced column', () => {
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['nonexistent'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey column count mismatch', () => {
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
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              userId: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['userId'],
                references: { table: 'user', columns: ['id', 'id'] },
              },
            ],
          },
        },
      },
    };

    expect(() => {
      sqlTargetFamilyHook.validateStructure(ir);
    }).toThrow('column count');
  });
});
