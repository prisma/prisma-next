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
import { createContractIR } from './utils';

const mockSqlHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes: (ir: ContractIR, _ctx: ValidationContext) => {
    const storage = ir.storage as
      | { tables?: Record<string, { columns?: Record<string, { type?: string }> }> }
      | undefined;
    if (!storage?.tables) {
      return;
    }

    const referencedNamespaces = new Set<string>();
    const extensionPacks = ir.extensionPacks as Record<string, unknown> | undefined;
    if (extensionPacks) {
      for (const namespace of Object.keys(extensionPacks)) {
        referencedNamespaces.add(namespace);
      }
    }

    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [tableName, table] of Object.entries(storage.tables)) {
      if (!table.columns) continue;
      for (const [colName, col] of Object.entries(table.columns)) {
        const column = col as { codecId?: string };
        if (!column.codecId) {
          throw new Error(`Column "${colName}" in table "${tableName}" is missing codecId`);
        }

        if (!typeIdRegex.test(column.codecId)) {
          throw new Error(
            `Column "${colName}" in table "${tableName}" has invalid codecId format "${column.codecId}". Expected format: ns/name@version`,
          );
        }

        const match = column.codecId.match(typeIdRegex);
        if (match?.[1]) {
          const namespace = match[1];
          if (!referencedNamespaces.has(namespace)) {
            if (namespace === 'pg' && referencedNamespaces.has('postgres')) {
              continue;
            }
            throw new Error(
              `Column "${colName}" in table "${tableName}" uses codecId "${column.codecId}" from namespace "${namespace}" which is not referenced in contract.extensionPacks`,
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

describe('emitter integration', () => {
  it(
    'emits complete contract from IR to artifacts',
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

      // Create minimal test data (emitter tests don't load packs)
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

      expect(result.storageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');
      expect(result.contractDts).toContain('LaneCodecTypes');

      const contractJson = JSON.parse(result.contractJson);
      expect(contractJson).toMatchObject({
        schemaVersion: '1',
        targetFamily: 'sql',
        target: 'postgres',
        storageHash: result.storageHash,
        storage: {
          tables: {
            user: expect.anything(),
          },
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it('produces stable hashes for identical input', async () => {
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
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
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

    // Create minimal test data (emitter tests don't load packs)
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

    const result1 = await emit(ir, options, mockSqlHook);
    const result2 = await emit(ir, options, mockSqlHook);

    expect(result1.storageHash).toBe(result2.storageHash);
    expect(result1.contractDts).toBe(result2.contractDts);
    expect(result1.contractJson).toBe(result2.contractJson);
  });

  it(
    'round-trip: IR → JSON → parse JSON → compare',
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

      // Create minimal test data (emitter tests don't load packs)
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

      const result1 = await emit(ir, options, mockSqlHook);
      const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

      const ir2 = createContractIR({
        schemaVersion: contractJson1['schemaVersion'] as string,
        targetFamily: contractJson1['targetFamily'] as string,
        target: contractJson1['target'] as string,
        models: contractJson1['models'] as Record<string, unknown>,
        relations: (contractJson1['relations'] as Record<string, unknown>) || {},
        storage: contractJson1['storage'] as Record<string, unknown>,
        extensionPacks: contractJson1['extensionPacks'] as Record<string, unknown>,
        capabilities:
          (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
        meta: (contractJson1['meta'] as Record<string, unknown>) || {},
        sources: (contractJson1['sources'] as Record<string, unknown>) || {},
      });

      const result2 = await emit(ir2, options, mockSqlHook);

      expect(result1.contractJson).toBe(result2.contractJson);
      expect(result1.storageHash).toBe(result2.storageHash);
    },
    timeouts.typeScriptCompilation,
  );
});
