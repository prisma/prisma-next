import type {
  GenerateContractTypesOptions,
  TypeRenderEntry,
  TypesImportSpec,
} from '@prisma-next/framework-components/emission';
import { createOperationRegistry } from '@prisma-next/operations';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { emit } from '../src/exports';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const mockSqlHook = createMockSpi();

describe('emitter', () => {
  it(
    'emits contract.json and contract.d.ts',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: { table: 'user' },
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        extensionPacks: {
          postgres: {
            version: '0.0.1',
          },
          pg: {},
        },
      });

      const operationRegistry = createOperationRegistry();
      const codecTypeImports: TypesImportSpec[] = [];
      const operationTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, mockSqlHook);
      expect(result.storageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');

      const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
      const storage = contractJson['storage'] as Record<string, unknown>;
      const tables = storage['tables'] as Record<string, unknown>;
      expect(tables).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it('does not validate codec namespaces against extensions', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'unknown/type@1', nativeType: 'unknown_type', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const operationRegistry = createOperationRegistry();
    const options: EmitStackInput = {
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('emits contract even when extension pack namespace does not match extensionIds', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const operationRegistry = createOperationRegistry();
    const options: EmitStackInput = {
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles missing extensionPacks field', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const operationRegistry = createOperationRegistry();
    const options: EmitStackInput = {
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles empty packs array', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const operationRegistry = createOperationRegistry();
    const options: EmitStackInput = {
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('omits sources from emitted contract artifact', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const operationRegistry = createOperationRegistry();
    const options: EmitStackInput = {
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    const contractJson = JSON.parse(result.contractJson) as Record<string, unknown>;
    expect(contractJson).not.toHaveProperty('sources');
  });

  it('accepts meta keys when family validation allows them', async () => {
    const ir = createTestContract({
      meta: {
        sourceId: 'schema.prisma',
        schemaPath: '/tmp/schema.prisma',
        source: 'psl',
      },
    });

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).resolves.toMatchObject({
      contractJson: expect.any(String),
      contractDts: expect.any(String),
    });
  });

  it('accepts canonical section keys when family validation allows them', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
                sourceId: 'schema.prisma',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      } as unknown as Record<string, unknown>,
    });

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).resolves.toMatchObject({
      contractJson: expect.any(String),
      contractDts: expect.any(String),
    });
  });

  it('emits contract even when extensionIds are not in contract.extensionPacks', async () => {
    const ir = createTestContract({
      storage: {
        tables: {},
      },
    });

    const mockHookNoTypeValidation = createMockSpi();

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: ['postgres'],
    };

    const result = await emit(ir, options, mockHookNoTypeValidation);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('defaults codecTypeImports and operationTypeImports to empty arrays when undefined', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
    });

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: undefined,
      operationTypeImports: undefined,
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('export type CodecTypes');
    expect(result.contractDts).toContain('export type OperationTypes');
  });

  it('passes parameterizedTypeImports and queryOperationTypeImports to generateContractDts', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
    });

    const parameterizedTypeImports: TypesImportSpec[] = [
      { package: '@ext/param', named: 'ParamTypes', alias: 'ExtParamTypes' },
    ];
    const queryOperationTypeImports: TypesImportSpec[] = [
      { package: '@ext/query', named: 'QueryOperationTypes', alias: 'ExtQueryOpTypes' },
    ];

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
      parameterizedTypeImports,
      queryOperationTypeImports,
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain("from '@ext/param'");
    expect(result.contractDts).toContain("from '@ext/query'");
  });

  it('delegates to emitter.generateModelsType when provided', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
    });

    const mockWithModelsType = createMockSpi({
      generateModelsType: () => '{ readonly Custom: { readonly custom: true } }',
    });

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockWithModelsType);
    expect(result.contractDts).toContain('readonly Custom: { readonly custom: true }');
  });

  it('emits execution clause when contract has execution section', async () => {
    const ir = createTestContract({
      storage: { tables: {} },
      execution: {
        executionHash: 'sha256:abc123',
        operations: {},
      },
    });

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractDts).toContain('readonly execution:');
    expect(result.executionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('forwards parameterizedRenderers option to getFamilyTypeAliases', async () => {
    const ir = createTestContract({
      storage: {
        tables: {},
      },
    });

    let receivedOptions: GenerateContractTypesOptions | undefined;

    const mockHookCapturingOptions = createMockSpi({
      getFamilyTypeAliases: (options) => {
        receivedOptions = options;
        return '';
      },
    });

    const vectorRenderer: TypeRenderEntry = {
      codecId: 'pg/vector@1',
      render: (params) => `Vector<${params['length']}>`,
    };

    const parameterizedRenderers = new Map<string, TypeRenderEntry>();
    parameterizedRenderers.set('pg/vector@1', vectorRenderer);

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
      parameterizedRenderers,
    };

    await emit(ir, options, mockHookCapturingOptions);

    expect(receivedOptions).toBeDefined();
    expect(receivedOptions?.parameterizedRenderers).toBeDefined();
    expect(receivedOptions?.parameterizedRenderers?.size).toBe(1);

    const entry = receivedOptions?.parameterizedRenderers?.get('pg/vector@1');
    expect(entry).toBeDefined();
    expect(entry?.codecId).toBe('pg/vector@1');
    expect(entry?.render({ length: 1536 }, { codecTypesName: 'CodecTypes' })).toBe('Vector<1536>');
  });
});
