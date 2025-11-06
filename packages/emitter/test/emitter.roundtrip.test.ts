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

describe('emitter round-trip', () => {
  it('round-trip with minimal IR', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: { version: '15.0.0' },
        pg: {},
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

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    const result1 = await emit(ir, options, mockSqlHook);
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

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
  });

  it('round-trip with complex IR', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: { version: '15.0.0' },
      },
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
            name: { column: 'name' },
          },
        },
        Post: {
          storage: { table: 'post' },
          fields: {
            id: { column: 'id' },
            title: { column: 'title' },
            userId: { column: 'user_id' },
          },
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
          },
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              title: { type: 'pg/text@1', nullable: false },
              user_id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
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
    };

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    const result1 = await emit(ir, options, mockSqlHook);
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

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
  });

  it('round-trip with nullable fields', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        postgres: { version: '15.0.0' },
        pg: {},
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: true },
              name: { type: 'pg/text@1', nullable: false },
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

    const result1 = await emit(ir, options, mockSqlHook);
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

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);

    const parsed2 = JSON.parse(result2.contractJson);
    expect(parsed2.storage.tables.user.columns.id.nullable).toBeUndefined();
    expect(parsed2.storage.tables.user.columns.email.nullable).toBe(true);
    expect(parsed2.storage.tables.user.columns.name.nullable).toBeUndefined();
  });

  it('round-trip with capabilities', async () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
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

    const packs = loadExtensionPacks(join(__dirname, '../../adapter-postgres'), []);
    const options: EmitOptions = {
      outputDir: '',
      packs,
    };

    const result1 = await emit(ir, options, mockSqlHook);
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

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.coreHash).toBe(result2.coreHash);
    expect(result1.profileHash).toBe(result2.profileHash);
  });
});
