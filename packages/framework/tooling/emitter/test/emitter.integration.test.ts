import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { ContractIR } from '../../../core-contract/src/ir';
import { emit } from '../src/emitter';
import { loadExtensionPacks } from '../src/extension-pack';
import type { TargetFamilyHook } from '../src/target-family';
import type { EmitOptions, ExtensionPackManifest } from '../src/types';
import { createContractIR } from './utils';

const mockSqlHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes: (ir: ContractIR, packManifests: ReadonlyArray<ExtensionPackManifest>) => {
    const storage = ir.storage as
      | { tables?: Record<string, { columns?: Record<string, { type?: string }> }> }
      | undefined;
    if (!storage?.tables) {
      return;
    }

    const packNamespaces = new Set(packManifests.map((p) => p.id));
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
          if (!referencedNamespaces.has(namespace) && !packNamespaces.has(namespace)) {
            if (namespace === 'pg' && packNamespaces.has('postgres')) {
              continue;
            }
            throw new Error(
              `Column "${colName}" in table "${tableName}" uses type ID "${col.type}" from namespace "${namespace}" which is not referenced in contract.extensions or available in loaded packs`,
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
  generateContractTypes: () => {
    return `// Generated contract types
export type CodecTypes = Record<string, never>;
export type LaneCodecTypes = CodecTypes;
export type Contract = unknown;
`;
  },
  getTypesImports: () => [],
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
      const options: EmitOptions = {
        outputDir: '',
        packs,
      };

      const result = await emit(ir, options, mockSqlHook);

      expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');
      expect(result.contractDts).toContain('LaneCodecTypes');

      const contractJson = JSON.parse(result.contractJson);
      expect(contractJson).toMatchObject({
        schemaVersion: '1',
        targetFamily: 'sql',
        target: 'postgres',
        coreHash: result.coreHash,
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
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    const result1 = await emit(ir, options, mockSqlHook);
    const result2 = await emit(ir, options, mockSqlHook);

    expect(result1.coreHash).toBe(result2.coreHash);
    expect(result1.contractDts).toBe(result2.contractDts);
    expect(result1.contractJson).toBe(result2.contractJson);
  });

  it('round-trip: IR → JSON → parse JSON → compare', async () => {
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
    const options: EmitOptions = {
      outputDir: '',
      packs,
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
});
