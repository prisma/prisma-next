import { describe, it, expect } from 'vitest';
import { emit } from '../src/emitter';
import { loadExtensionPacks } from '../src/extension-pack';
import type { ContractIR, EmitOptions, ExtensionPackManifest } from '../src/types';
import type { TargetFamilyHook } from '../src/target-family';
import { join } from 'node:path';

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
        if (match && match[1]) {
          const namespace = match[1];
          if (!referencedNamespaces.has(namespace) && !packNamespaces.has(namespace)) {
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

describe('emitter', () => {
  it('emits contract.json and contract.d.ts', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: {
          version: '15.0.0',
        },
        pg: {},
      },
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
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

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    const result = await emit(ir, options, mockSqlHook);
    expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.contractDts).toContain('export type Contract');
    expect(result.contractDts).toContain('CodecTypes');

    const contractJson = JSON.parse(result.contractJson);
    expect(contractJson.storage.tables.user.columns.id.type).toBe('pg/int4@1');
    expect(contractJson.storage.tables.user.columns.email.type).toBe('pg/text@1');
  });

  it('validates type IDs come from referenced extensions', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'unknown/type@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow();
  });

  it('validates type ID format', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'invalid-format', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    await expect(emit(ir, options, mockSqlHook)).rejects.toThrow('invalid type ID format');
  });
});
