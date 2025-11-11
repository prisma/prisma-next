import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { createOperationRegistry } from '@prisma-next/operations';
import { describe, expect, it } from 'vitest';
import type { ContractIR } from '../../../core-contract/src/ir';
import { emit } from '../src/emitter';
import { loadExtensionPacks } from '../src/extension-pack';
import type { TargetFamilyHook } from '../src/target-family';
import type { EmitOptions, ExtensionPack, TypesImportSpec } from '../src/types';
import { createContractIR } from './utils';

const mockSqlHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes: (ir: ContractIR, _operationRegistry?) => {
    const storage = ir.storage as
      | { tables?: Record<string, { columns?: Record<string, { type?: string }> }> }
      | undefined;
    if (!storage?.tables) {
      return;
    }

    const referencedNamespaces = new Set<string>();
    const extensions = ir.extensions as Record<string, unknown> | undefined;
    if (extensions) {
      for (const namespace of Object.keys(extensions)) {
        referencedNamespaces.add(namespace);
      }
    }

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [tableName, table] of Object.entries(storage.tables)) {
      if (!table.columns) continue;
      for (const [colName, col] of Object.entries(table.columns)) {
        if (!col.type) {
          throw new Error(`Column "${colName}" in table "${tableName}" is missing type`);
        }

        if (!typeIdRegex.test(col.type)) {
          throw new Error(
            `Column "${colName}" in table "${tableName}" has invalid type ID format "${col.type}". Expected format: ns/name@version`,
          );
        }

        const match = col.type.match(typeIdRegex);
        if (match?.[1]) {
          const namespace = match[1];
          if (!referencedNamespaces.has(namespace)) {
            throw new Error(
              `Column "${colName}" in table "${tableName}" uses type ID "${col.type}" from namespace "${namespace}" which is not referenced in contract.extensions`,
            );
          }
        }
      }
    }
  },
  validateStructure: (ir: ContractIR) => {
    if (ir.targetFamily !== 'sql') {
      throw new Error(`Expected targetFamily "sql", got "${ir.targetFamily}"`);
    }
  },
  generateContractTypes: (ir: ContractIR, typeImports) => {
    // Access ir properties to satisfy lint rules, but we don't use them in the mock
    void ir;
    void typeImports;
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
        extensions: {
          postgres: {
            version: '15.0.0',
          },
          pg: {},
        },
      });

      const packs = loadExtensionPacks(
        join(__dirname, '../../../../../packages/sql/runtime/adapters/postgres'),
        [],
      );
      // Create empty registry and extract type imports/extension IDs from packs for tests
      const operationRegistry = createOperationRegistry();
      const typeImports: TypesImportSpec[] = [];
      for (const pack of packs) {
        const codecTypes = pack.manifest.types?.codecTypes;
        if (codecTypes?.import) {
          typeImports.push(codecTypes.import);
        }
        const operationTypes = pack.manifest.types?.operationTypes;
        if (operationTypes?.import) {
          typeImports.push(operationTypes.import);
        }
      }
      const extensionIds = packs.map((p) => p.manifest.id);
      const options: EmitOptions = {
        outputDir: '',
        operationRegistry,
        typeImports,
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

  it('validates type IDs come from referenced extensions', async () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'unknown/type@1', nullable: false },
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
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow();
  });

  it('validates type ID format', async () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'invalid-format', nullable: false },
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
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('invalid type ID format');
  });

  it('throws error when targetFamily is missing', async () => {
    const ir = createContractIR({
      targetFamily: undefined as unknown as string,
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
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
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
              id: { type: 'pg/int4@1', nullable: false },
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
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have target');
  });

  it('throws error when extension pack is missing from extensions', async () => {
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

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
      extensionIds: [],
    };

    // validateTypes runs before validateExtensions, so it will throw about type ID first
    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow();
  });

  it('handles missing extensions field', async () => {
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

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
      extensionIds: [],
    };

    // validateTypes runs before validateExtensions, so it will throw about type ID first
    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow();
  });

  it('handles empty packs array', async () => {
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

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow();
  });

  it('throws error when schemaVersion is missing', async () => {
    const ir = createContractIR({
      schemaVersion: undefined as unknown as string,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have relations');
  });

  it('throws error when extensions is missing', async () => {
    const ir = createContractIR({
      extensions: undefined as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have extensions');
  });

  it('throws error when extensions is not an object', async () => {
    const ir = createContractIR({
      extensions: 'not-an-object' as unknown as Record<string, unknown>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have extensions');
  });

  it('throws error when capabilities is missing', async () => {
    const ir = createContractIR({
      capabilities: undefined as unknown as Record<string, Record<string, boolean>>,
    }) as ContractIR;

    const operationRegistry = createOperationRegistry();
    const options: EmitOptions = {
      outputDir: '',
      operationRegistry,
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
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
      typeImports: [],
      extensionIds: [],
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('ContractIR must have sources');
  });

  it('throws error when extension pack is missing from extensions', async () => {
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
      generateContractTypes: (_ir, _typeImports) => {
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
      typeImports: [],
      extensionIds: ['missing-pack'],
    };

    await expect(emit(ir, options, mockHookNoTypeValidation)).rejects.toThrow(
      'Extension "missing-pack" must appear in contract.extensions.missing-pack',
    );
  });
});
