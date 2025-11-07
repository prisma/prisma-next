import type { ContractIR } from '@prisma-next/emitter';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/emitter-hook';

describe('sql-target-family-hook', () => {
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
});

