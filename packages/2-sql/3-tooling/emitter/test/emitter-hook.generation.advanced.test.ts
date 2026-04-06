import type { Contract } from '@prisma-next/contract/types';
import { generateContractDts } from '@prisma-next/emitter';
import type { NormalizedTypeRenderer } from '@prisma-next/framework-components/components';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/framework-components/control';
import {
  extractCodecTypeImports,
  extractOperationTypeImports,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { sqlTargetFamilyHook } from '../src/index';

type TestDescriptor =
  | ControlTargetDescriptor<'sql', string>
  | ControlAdapterDescriptor<'sql', string>
  | ControlExtensionDescriptor<'sql', string>;

function createContract(overrides: Partial<Contract>): Contract {
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

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

describe('sql-target-family-hook', () => {
  it('generates contract types with model relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: {
            posts: {
              to: 'Post',
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
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
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).toContain('relations: {');
    expect(types).toContain(
      "readonly posts: { readonly to: 'Post'; readonly cardinality: '1:N'; readonly on: { readonly localFields: readonly ['id']; readonly targetFields: readonly ['userId'] } }",
    );
  });

  it('generates contract types when models is an empty object', () => {
    const ir = createContract({
      models: {},
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

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('export type TypeMaps');
    expect(types).not.toContain("'__@prisma-next/sql-contract/codecTypes@__'");
    expect(types).not.toContain("'__@prisma-next/sql-contract/operationTypes@__'");
  });

  it('generates contract types with explicitly empty models and codecTypes', () => {
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
      },
    ];

    const ir = createContract({
      models: {},
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

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const operationTypeImports = extractOperationTypeImports(descriptors);
    const types = generateContractDts(
      ir,
      sqlTargetFamilyHook,
      codecTypeImports,
      operationTypeImports,
      testHashes,
    );
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('CodecTypes');
    expect(types).toContain('export type TypeMaps');
  });

  it('generates contract types with default models and codecTypes from descriptors', () => {
    const ir = createContract({
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
      },
    ];

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const operationTypeImports = extractOperationTypeImports(descriptors);
    const types = generateContractDts(
      ir,
      sqlTargetFamilyHook,
      codecTypeImports,
      operationTypeImports,
      testHashes,
    );
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('CodecTypes');
    expect(types).toContain('export type TypeMaps');
  });

  it('emits model relations on each model in Contract', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: {
            posts: {
              to: 'Post',
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
            comments: {
              to: 'Comment',
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['authorId'],
              },
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
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
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).not.toContain('export type Relations');
    expect(types).toContain(
      "readonly posts: { readonly to: 'Post'; readonly cardinality: '1:N'; readonly on: { readonly localFields: readonly ['id']; readonly targetFields: readonly ['userId'] } }",
    );
    expect(types).toContain(
      "readonly comments: { readonly to: 'Comment'; readonly cardinality: '1:N'; readonly on: { readonly localFields: readonly ['id']; readonly targetFields: readonly ['authorId'] } }",
    );
  });

  it('generates models with empty relations object when no relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
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

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).toContain('Record<string, never>');
  });

  it('generates models type from models and storage', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
              name: { column: 'name' },
            },
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
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).toContain('export type Contract');
    expect(types).toContain('readonly User: {');
    expect(types).toContain("storage: { readonly table: 'user'");
    expect(types).toContain(
      "readonly id: { readonly codecId: 'pg/int4@1'; readonly nullable: false }",
    );
    expect(types).toContain(
      "readonly email: { readonly codecId: 'pg/text@1'; readonly nullable: false }",
    );
    expect(types).toContain(
      "readonly name: { readonly codecId: 'pg/text@1'; readonly nullable: false }",
    );
    expect(types).not.toContain('modelToTable');
    expect(types).not.toContain('fieldToColumn');
  });

  it('generates models type with multiple models', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: {},
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
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
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).toContain('readonly User: {');
    expect(types).toContain('readonly Post: {');
    expect(types).toContain("readonly table: 'user'");
    expect(types).toContain("readonly table: 'post'");
    expect(types).not.toContain('modelToTable');
  });

  it('uses Record<string, never> for models when IR has no models', () => {
    const ir = createContract({
      models: undefined,
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
        },
      },
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('storageHash: StorageHash');
  });

  it('generates models type with relations missing on/cols properties', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {},
          },
          relations: {
            partialRel: { to: 'Post' },
            invalidRel: { on: { childCols: ['id'] } },
          },
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).toContain("readonly partialRel: { readonly to: 'Post' }");
    expect(types).not.toContain('invalidRel');
  });

  it('generates models with empty fields object when model has no fields', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {},
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

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes);
    expect(types).toContain('readonly User: {');
    expect(types).toContain("storage: { readonly table: 'user'");
    expect(types).toContain('fields: {  }');
    expect(types).not.toContain('fieldToColumn');
    expect(types).not.toContain('columnToField');
  });

  it('gets types imports with multiple extensions', () => {
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
      },
      {
        kind: 'extension',
        id: 'test-extension',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
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
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    const operationImports = extractOperationTypeImports(descriptors);
    expect(codecImports.length).toBe(2);
    expect(codecImports[0]?.package).toBe('@test/adapter/codec-types');
    expect(codecImports[1]?.package).toBe('@test/extension/codec-types');
    expect(operationImports.length).toBe(0);
  });

  it('gets types imports with descriptors without codecTypes', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    const operationImports = extractOperationTypeImports(descriptors);
    expect(codecImports.length).toBe(0);
    expect(operationImports.length).toBe(0);
  });

  it('gets types imports using extractCodecTypeImports and extractOperationTypeImports', () => {
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
          operationTypes: {
            import: {
              package: '@test/adapter/operation-types',
              named: 'OperationTypes',
              alias: 'TestOps',
            },
          },
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    const operationImports = extractOperationTypeImports(descriptors);
    expect(codecImports).toEqual([
      { package: '@test/adapter/codec-types', named: 'CodecTypes', alias: 'TestTypes' },
    ]);
    expect(operationImports).toEqual([
      { package: '@test/adapter/operation-types', named: 'OperationTypes', alias: 'TestOps' },
    ]);
  });

  it('renders column type using inline typeParams with parameterized renderer', () => {
    const ir = createContract({
      models: {
        Embedding: {
          storage: {
            table: 'embedding',
            fields: {
              id: { column: 'id' },
              vector: { column: 'vector' },
            },
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
                nativeType: 'vector(1536)',
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

    const parameterizedRenderers = new Map<string, NormalizedTypeRenderer>();
    parameterizedRenderers.set('pg/vector@1', {
      codecId: 'pg/vector@1',
      render: (params, ctx) =>
        `${ctx.codecTypesName}['pg/vector@1']['output'] & { length: ${params['length']} }`,
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes, {
      parameterizedRenderers,
    });

    expect(types).toContain(
      "readonly vector: CodecTypes['pg/vector@1']['output'] & { length: 1536 }",
    );
  });

  it('renders column type using typeRef with parameterized renderer', () => {
    const ir = createContract({
      models: {
        Embedding: {
          storage: {
            table: 'embedding',
            fields: {
              id: { column: 'id' },
              vector: { column: 'vector' },
            },
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
                nativeType: 'vector(1536)',
                codecId: 'pg/vector@1',
                nullable: false,
                typeRef: 'Vector1536',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          Vector1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector(1536)',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const parameterizedRenderers = new Map<string, NormalizedTypeRenderer>();
    parameterizedRenderers.set('pg/vector@1', {
      codecId: 'pg/vector@1',
      render: (params, ctx) =>
        `${ctx.codecTypesName}['pg/vector@1']['output'] & { length: ${params['length']} }`,
    });

    const types = generateContractDts(ir, sqlTargetFamilyHook, [], [], testHashes, {
      parameterizedRenderers,
    });

    expect(types).toContain(
      "readonly vector: CodecTypes['pg/vector@1']['output'] & { length: 1536 }",
    );
  });
});
