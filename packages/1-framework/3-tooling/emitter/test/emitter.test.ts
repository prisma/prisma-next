import type { EmitStackInput } from '@prisma-next/core-control-plane/emission';
import { emit } from '@prisma-next/core-control-plane/emission';
import type {
  GenerateContractTypesOptions,
  TargetFamilyHook,
  TypeRenderEntry,
  TypesImportSpec,
} from '@prisma-next/framework-components/emission';
import { createOperationRegistry } from '@prisma-next/operations';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestContract } from './utils';

const mockSqlHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes: (contract) => {
    const storage = contract.storage as
      | { tables?: Record<string, { columns?: Record<string, { codecId?: string }> }> }
      | undefined;
    if (!storage?.tables) {
      return;
    }

    // Only validate codec ID format (ns/name@version)
    // Namespace validation removed - codecs can use any namespace
    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [tableName, table] of Object.entries(storage.tables)) {
      if (!table.columns) continue;
      for (const [colName, col] of Object.entries(table.columns)) {
        if (!col.codecId) {
          throw new Error(`Column "${colName}" in table "${tableName}" is missing codecId`);
        }

        if (!typeIdRegex.test(col.codecId)) {
          throw new Error(
            `Column "${colName}" in table "${tableName}" has invalid codecId format "${col.codecId}". Expected format: ns/name@version`,
          );
        }
      }
    }
  },
  validateStructure: (contract) => {
    if (contract.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${contract.targetFamily}"`);
    }
  },
  generateContractTypes: (contract, _codecTypeImports, _operationTypeImports, _hashes) => {
    void contract;
    void _codecTypeImports;
    void _operationTypeImports;
    void _hashes;
    return `// Generated contract types
export type CodecTypes = Record<string, never>;
export type LaneCodecTypes = CodecTypes;
export type Contract = unknown;
`;
  },
};

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

      // Create empty registry and minimal test data (emitter tests don't load packs)
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
    // Namespace validation removed - codecs can use any namespace
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

    // Should succeed - namespace validation removed
    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('validates type ID format', async () => {
    const ir = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'invalid-format', nativeType: 'int4', nullable: false },
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

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('invalid codecId format');
  });

  it('emits contract even when extension pack namespace does not match extensionIds', async () => {
    // Adapter-provided codecs (pg/int4@1) don't need to be in contract.extensionPacks
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
      extensionIds: [], // No extensions, but codec still works
    };

    // Should succeed - adapter-provided codecs don't need to be in contract.extensionPacks
    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles missing extensionPacks field', async () => {
    // Namespace validation removed - codecs can use any namespace
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

    // Should succeed - namespace validation removed
    const result = await emit(ir, options, mockSqlHook);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('handles empty packs array', async () => {
    // Namespace validation removed - codecs can use any namespace
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

    // Should succeed - namespace validation removed
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
    // extensionIds includes adapters/targets which are not in contract.extensionPacks
    const ir = createTestContract({
      storage: {
        tables: {},
      },
    });

    // Use a mock hook that doesn't validate types to avoid type validation errors
    const mockHookNoTypeValidation: TargetFamilyHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: (contract) => {
        if (contract.targetFamily !== 'sql') {
          throw new Error(`Expected targetFamily "sql", got "${contract.targetFamily}"`);
        }
      },
      generateContractTypes: (contract, _codecTypeImports, _operationTypeImports, _hashes) => {
        void contract;
        void _codecTypeImports;
        void _operationTypeImports;
        void _hashes;
        return `// Generated contract types
export type CodecTypes = Record<string, never>;
export type LaneCodecTypes = CodecTypes;
export type Contract = unknown;
`;
      },
    };

    const options: EmitStackInput = {
      operationRegistry: createOperationRegistry(),
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: ['postgres'], // Adapter ID, not an extension
    };

    // Should succeed - extensionIds can include adapters/targets
    const result = await emit(ir, options, mockHookNoTypeValidation);
    expect(result.contractJson).toBeDefined();
    expect(result.contractDts).toBeDefined();
  });

  it('passes parameterizedRenderers to generateContractTypes options', async () => {
    const ir = createTestContract({
      storage: {
        tables: {},
      },
    });

    let receivedOptions: GenerateContractTypesOptions | undefined;

    const mockHookCapturingOptions: TargetFamilyHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: (
        contract,
        _codecTypeImports,
        _operationTypeImports,
        _hashes,
        options,
      ) => {
        void contract;
        receivedOptions = options;
        return `// Generated contract types
export type CodecTypes = Record<string, never>;
export type LaneCodecTypes = CodecTypes;
export type Contract = unknown;
`;
      },
    };

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
