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
import type { ContractIR } from '../../../core-contract/src/ir';
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
            if (namespace === 'pg' && referencedNamespaces.has('postgres')) {
              continue;
            }
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

describe('emitter round-trip', () => {
  it(
    'round-trip with minimal IR',
    async () => {
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
        extensions: {
          postgres: { version: '15.0.0' },
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
        extensions: contractJson1['extensions'] as Record<string, unknown>,
        capabilities:
          (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
        meta: (contractJson1['meta'] as Record<string, unknown>) || {},
        sources: (contractJson1['sources'] as Record<string, unknown>) || {},
      });

      const result2 = await emit(ir2, options, mockSqlHook);

      expect(result1.contractJson).toBe(result2.contractJson);
      expect(result1.coreHash).toBe(result2.coreHash);
    },
    timeouts.typeScriptCompilation,
  );

  it('round-trip with complex IR', async () => {
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
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            title: { column: 'title' },
            userId: { column: 'user_id' },
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
              name: { type: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'user_email_key' }],
            indexes: [{ columns: ['name'], name: 'user_name_idx' }],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              title: { type: 'pg/text@1', nullable: false },
              user_id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                columns: ['user_id'],
                references: { table: 'user', columns: ['id'] },
                name: 'post_user_id_fkey',
              },
            ],
          },
        },
      },
      extensions: {
        postgres: { version: '15.0.0' },
      },
    });

    // Create minimal test data (emitter tests don't load packs)
    const operationRegistry = createOperationRegistry();
    const codecTypeImports: TypesImportSpec[] = [];
    const operationTypeImports: TypesImportSpec[] = [];
    const extensionIds = ['postgres'];
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
      extensions: contractJson1['extensions'] as Record<string, unknown>,
      capabilities:
        (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
      meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      sources: (contractJson1['sources'] as Record<string, unknown>) || {},
    });

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
  });

  it('round-trip with nullable fields', async () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: true },
              name: { type: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      extensions: {
        postgres: { version: '15.0.0' },
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
      extensions: contractJson1['extensions'] as Record<string, unknown>,
      capabilities:
        (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
      meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      sources: (contractJson1['sources'] as Record<string, unknown>) || {},
    });

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);

    const parsed2 = JSON.parse(result2.contractJson) as Record<string, unknown>;
    const storage = parsed2['storage'] as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown>;
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const id = columns['id'] as Record<string, unknown>;
    const email = columns['email'] as Record<string, unknown>;
    const name = columns['name'] as Record<string, unknown>;
    expect(id['nullable']).toBeUndefined();
    expect(email['nullable']).toBe(true);
    expect(name['nullable']).toBeUndefined();
  });

  it('round-trip with capabilities', async () => {
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
      extensions: {
        postgres: { version: '15.0.0' },
        pg: {},
      },
      capabilities: {
        postgres: {
          jsonAgg: true,
          lateral: true,
        },
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
      extensions: contractJson1['extensions'] as Record<string, unknown>,
      capabilities:
        (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
      meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      sources: (contractJson1['sources'] as Record<string, unknown>) || {},
    });

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
    expect(result1.profileHash).toBe(result2.profileHash);
  });
});
