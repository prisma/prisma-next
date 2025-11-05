import { describe, it, expect, beforeEach } from 'vitest';
import { emit } from '../src/emitter';
import { targetFamilyRegistry } from '../src/target-family-registry';
import type { ContractIR, EmitOptions, ExtensionPackManifest } from '../src/types';
import type { TargetFamilyHook } from '../src/target-family';
import { join } from 'node:path';

const mockSqlHook: TargetFamilyHook = {
  id: 'sql',
  validateTypes: (ir: ContractIR, packManifests: ReadonlyArray<ExtensionPackManifest>) => {
    const storage = ir.storage as { tables?: Record<string, { columns?: Record<string, { type?: string }> }> } | undefined;
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

describe('emitter integration', () => {
  beforeEach(() => {
    if (!targetFamilyRegistry.has('sql')) {
      targetFamilyRegistry.register(mockSqlHook);
    }
  });

  it('emits complete contract from IR to artifacts', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: {
          version: '15.0.0',
        },
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

    const options: EmitOptions = {
      outputDir: '',
      adapterPath: join(__dirname, '../../adapter-postgres'),
    };

    const result = await emit(ir, options);

    expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.contractDts).toContain('export type Contract');
    expect(result.contractDts).toContain('CodecTypes');
    expect(result.contractDts).toContain('LaneCodecTypes');

    const contractJson = JSON.parse(result.contractJson);
    expect(contractJson.schemaVersion).toBe('1');
    expect(contractJson.targetFamily).toBe('sql');
    expect(contractJson.target).toBe('postgres');
    expect(contractJson.coreHash).toBe(result.coreHash);
    expect(contractJson.storage.tables.user.columns.id.type).toBe('pg/int4@1');
    expect(contractJson.storage.tables.user.columns.email.type).toBe('pg/text@1');
  });

  it('produces stable hashes for identical input', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: {
          version: '15.0.0',
        },
      },
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
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
          },
        },
      },
    };

    const options: EmitOptions = {
      outputDir: '',
      adapterPath: join(__dirname, '../../adapter-postgres'),
    };

    const result1 = await emit(ir, options);
    const result2 = await emit(ir, options);

    expect(result1.coreHash).toBe(result2.coreHash);
    expect(result1.contractDts).toBe(result2.contractDts);
    expect(result1.contractJson).toBe(result2.contractJson);
  });

  it('round-trip: IR → JSON → parse JSON → compare', async () => {
    const ir: ContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: {
          version: '15.0.0',
        },
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

    const options: EmitOptions = {
      outputDir: '',
      adapterPath: join(__dirname, '../../adapter-postgres'),
    };

    const result1 = await emit(ir, options);
    const contractJson1 = JSON.parse(result1.contractJson);

    const ir2: ContractIR = {
      schemaVersion: contractJson1.schemaVersion,
      targetFamily: contractJson1.targetFamily,
      target: contractJson1.target,
      extensions: contractJson1.extensions,
      models: contractJson1.models,
      relations: contractJson1.relations,
      storage: contractJson1.storage,
      capabilities: contractJson1.capabilities,
      meta: contractJson1.meta,
      sources: contractJson1.sources,
    };

    const result2 = await emit(ir2, options);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
  });
});

