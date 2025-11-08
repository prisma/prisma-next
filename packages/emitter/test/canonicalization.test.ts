import { describe, expect, it } from 'vitest';
import { canonicalizeContract } from '../src/canonicalization';
import type { ContractIR } from '../src/types';

describe('canonicalization', () => {
  it('orders top-level sections correctly', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensions: {},
      capabilities: { postgres: { jsonAgg: true } },
      meta: { source: 'test' },
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;

    const keys = Object.keys(parsed);
    const schemaVersionIndex = keys.indexOf('schemaVersion');
    const targetFamilyIndex = keys.indexOf('targetFamily');
    const targetIndex = keys.indexOf('target');
    const modelsIndex = keys.indexOf('models');
    const storageIndex = keys.indexOf('storage');
    const capabilitiesIndex = keys.indexOf('capabilities');
    const metaIndex = keys.indexOf('meta');

    expect(schemaVersionIndex).toBeLessThan(targetFamilyIndex);
    expect(targetFamilyIndex).toBeLessThan(targetIndex);
    expect(targetIndex).toBeLessThan(modelsIndex);
    expect(modelsIndex).toBeLessThan(storageIndex);
    expect(storageIndex).toBeLessThan(capabilitiesIndex);
    expect(capabilitiesIndex).toBeLessThan(metaIndex);
  });

  it('omits nullable false from columns', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: true },
            },
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown>;
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const id = columns['id'] as Record<string, unknown>;
    const email = columns['email'] as Record<string, unknown>;
    expect(id['nullable']).toBeUndefined();
    expect(email['nullable']).toBe(true);
  });

  it('omits empty arrays and objects except required ones', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      models: expect.anything(),
      storage: {
        tables: expect.anything(),
      },
    });
    // Required top-level fields (capabilities, extensions, meta, relations, sources) are preserved even when empty
    // because they are required by ContractIR and needed for round-trip tests
    expect(parsed).toHaveProperty('capabilities');
    expect(parsed).toHaveProperty('extensions');
    expect(parsed).toHaveProperty('meta');
    expect(parsed).toHaveProperty('relations');
    expect(parsed).toHaveProperty('sources');
  });

  it('preserves semantic array order for column lists', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              first: { type: 'pg/text@1' },
              second: { type: 'pg/text@1' },
            },
            primaryKey: {
              columns: ['second', 'first'],
            },
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result1 = canonicalizeContract(ir);

    const ir2: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              first: { type: 'pg/text@1' },
              second: { type: 'pg/text@1' },
            },
            primaryKey: {
              columns: ['first', 'second'],
            },
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result2 = canonicalizeContract(ir2);

    expect(result1).not.toBe(result2);
  });

  it('sorts non-semantic arrays by canonical name', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1' },
            },
            indexes: [
              { columns: ['id'], name: 'user_email_idx' },
              { columns: ['id'], name: 'user_name_idx' },
            ],
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown>;
    const user = tables['user'] as Record<string, unknown>;
    const indexes = user['indexes'] as Array<{ name: string }>;
    const indexNames = indexes.map((idx) => idx.name);
    expect(indexNames).toEqual(['user_email_idx', 'user_name_idx']);
  });

  it('sorts nested object keys lexicographically', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              z_field: { type: 'pg/text@1' },
              a_field: { type: 'pg/text@1' },
              m_field: { type: 'pg/text@1' },
            },
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown>;
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const columnKeys = Object.keys(columns);
    expect(columnKeys).toEqual(['a_field', 'm_field', 'z_field']);
  });

  it('sorts extension namespaces lexicographically', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: { tables: {} },
      extensions: {
        pgvector: { version: '1.0.0' },
        postgres: { version: '15.0.0' },
        another: { version: '1.0.0' },
      },
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const extensions = parsed['extensions'] as Record<string, unknown>;
    const extensionKeys = Object.keys(extensions);
    expect(extensionKeys).toEqual(['another', 'pgvector', 'postgres']);
  });

  it('omits generated false', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      relations: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', generated: false },
            },
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown>;
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const id = columns['id'] as Record<string, unknown>;
    expect(id['generated']).toBeUndefined();
  });
});
