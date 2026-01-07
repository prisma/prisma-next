import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  TargetFamilyHook,
  TypesImportSpec,
  ValidationContext,
} from '@prisma-next/contract/types';
import type { EmitOptions } from '@prisma-next/core-control-plane/emission';
import { emit } from '@prisma-next/core-control-plane/emission';
import { createOperationRegistry } from '@prisma-next/operations';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractIR } from './utils.ts';

const mockSqlHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes: (ir: ContractIR, _ctx: ValidationContext) => {
    const storage = ir.storage as
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
  validateStructure: (ir: ContractIR) => {
    if (ir.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${ir.targetFamily}"`);
    }
  },
  generateContractTypes: (ir: ContractIR, _codecTypeImports, _operationTypeImports) => {
    // Access ir properties to satisfy lint rules, but we don't use them in the mock
    void ir;
    void _codecTypeImports;
    void _operationTypeImports;
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
      const ir = createContractIR({
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
      const options: EmitOptions = {
        outputDir: '',
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, mockSqlHook);
      expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
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
    const ir = createContractIR({
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
    const options: EmitOptions = {
      outputDir: '',
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
    const ir = createContractIR({
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
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('invalid codecId format');
  });

  it('throws error when targetFamily is missing', async () => {
    const ir = createContractIR({
      targetFamily: undefined as unknown as string,
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
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow(
      'ContractIR must have targetFamily',
    );
  });

  it('throws error when target is missing', async () => {
    const ir = createContractIR({
      target: undefined as unknown as string,
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
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have target');
  });

  it('emits contract even when extension pack namespace does not match extensionIds', async () => {
    // Adapter-provided codecs (pg/int4@1) don't need to be in contract.extensionPacks
    const ir = createContractIR({
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
    const options: EmitOptions = {
      outputDir: '',
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
    const ir = createContractIR({
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
    const options: EmitOptions = {
      outputDir: '',
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
    const ir = createContractIR({
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
    const options: EmitOptions = {
      outputDir: '',
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

  it('throws error when schemaVersion is missing', async () => {
    const ir = createContractIR({
      schemaVersion: undefined as unknown as string,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow(
      'ContractIR must have schemaVersion',
    );
  });

  it('throws error when models is missing', async () => {
    const ir = createContractIR({
      models: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have models');
  });

  it('throws error when models is not an object', async () => {
    const ir = createContractIR({
      models: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have models');
  });

  it('throws error when storage is missing', async () => {
    const ir = createContractIR({
      storage: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have storage');
  });

  it('throws error when storage is not an object', async () => {
    const ir = createContractIR({
      storage: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have storage');
  });

  it('throws error when relations is missing', async () => {
    const ir = createContractIR({
      relations: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have relations');
  });

  it('throws error when relations is not an object', async () => {
    const ir = createContractIR({
      relations: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have relations');
  });

  it('throws error when extension packs are missing', async () => {
    const ir = createContractIR({
      extensionPacks: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow(
      'ContractIR must have extensionPacks',
    );
  });

  it('throws error when extension packs are not an object', async () => {
    const ir = createContractIR({
      extensionPacks: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow(
      'ContractIR must have extensionPacks',
    );
  });

  it('throws error when capabilities is missing', async () => {
    const ir = createContractIR({
      capabilities: undefined as unknown as Record<string, Record<string, boolean>>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow(
      'ContractIR must have capabilities',
    );
  });

  it('throws error when capabilities is not an object', async () => {
    const ir = createContractIR({
      capabilities: 'not-an-object' as unknown as Record<string, Record<string, boolean>>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow(
      'ContractIR must have capabilities',
    );
  });

  it('throws error when meta is missing', async () => {
    const ir = createContractIR({
      meta: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have meta');
  });

  it('throws error when meta is not an object', async () => {
    const ir = createContractIR({
      meta: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have meta');
  });

  it('throws error when sources is missing', async () => {
    const ir = createContractIR({
      sources: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have sources');
  });

  it('throws error when sources is not an object', async () => {
    const ir = createContractIR({
      sources: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      codecTypeImports: [],
      operationTypeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have sources');
  });

  it('emits contract even when extensionIds are not in contract.extensionPacks', async () => {
    // extensionIds includes adapters/targets which are not in contract.extensionPacks
    const ir = createContractIR({
      storage: {
        tables: {},
      },
    });

    // Use a mock hook that doesn't validate types to avoid type validation errors
    const mockHookNoTypeValidation: TargetFamilyHook = {
      id: 'sql',
      validateTypes: () => {
        // Skip type validation
      },
      validateStructure: (ir: ContractIR) => {
        if (ir.targetFamily !== 'sql') {
          throw new Error(`Expected targetFamily "sql", got "${ir.targetFamily}"`);
        }
      },
      generateContractTypes: (_ir, _codecTypeImports, _operationTypeImports) => {
        void _codecTypeImports;
        void _operationTypeImports;
        return `// Generated contract types
export type CodecTypes = Record<string, never>;
export type LaneCodecTypes = CodecTypes;
export type Contract = unknown;
`;
      },
    };

    const options: EmitOptions = {
      outputDir: '',
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
});
