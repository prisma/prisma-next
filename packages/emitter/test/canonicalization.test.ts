import { describe, it, expect } from 'vitest';
import { canonicalizeContract } from '../src/canonicalization';
import type { ContractIR } from '../src/types';

describe('canonicalization', () => {
  it('orders top-level sections correctly', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      schemaVersion: '1',
      models: {},
      storage: { tables: {} },
      capabilities: { postgres: { jsonAgg: true } },
      meta: { source: 'test' },
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

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
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

    expect(parsed.storage.tables.user.columns.id.nullable).toBeUndefined();
    expect(parsed.storage.tables.user.columns.email.nullable).toBe(true);
  });

  it('omits empty arrays and objects except required ones', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
      storage: { tables: {} },
      capabilities: {},
      extensions: {},
      meta: {},
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

    expect(parsed.models).toBeDefined();
    expect(parsed.storage.tables).toBeDefined();
    expect(parsed.capabilities).toBeUndefined();
    expect(parsed.extensions).toBeUndefined();
    expect(parsed.meta).toBeUndefined();
  });

  it('preserves semantic array order for column lists', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
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
    };

    const result1 = canonicalizeContract(ir);

    const ir2: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
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
    };

    const result2 = canonicalizeContract(ir2);

    expect(result1).not.toBe(result2);
  });

  it('sorts non-semantic arrays by canonical name', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
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
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

    const indexNames = parsed.storage.tables.user.indexes.map(
      (idx: { name: string }) => idx.name,
    );
    expect(indexNames).toEqual(['user_email_idx', 'user_name_idx']);
  });

  it('sorts nested object keys lexicographically', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
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
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

    const columnKeys = Object.keys(parsed.storage.tables.user.columns);
    expect(columnKeys).toEqual(['a_field', 'm_field', 'z_field']);
  });

  it('produces compact JSON without whitespace', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      models: {},
      storage: { tables: {} },
    };

    const result = canonicalizeContract(ir);

    expect(result).not.toContain('\n');
    expect(result).not.toContain(' ');
    expect(result.startsWith('{')).toBe(true);
    expect(result.endsWith('}')).toBe(true);
  });

  it('sorts extension namespaces lexicographically', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      extensions: {
        pgvector: { version: '1.0.0' },
        postgres: { version: '15.0.0' },
        another: { version: '1.0.0' },
      },
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

    const extensionKeys = Object.keys(parsed.extensions);
    expect(extensionKeys).toEqual(['another', 'pgvector', 'postgres']);
  });

  it('omits generated false', () => {
    const ir: ContractIR = {
      targetFamily: 'sql',
      target: 'postgres',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', generated: false },
            },
          },
        },
      },
    };

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);

    expect(parsed.storage.tables.user.columns.id.generated).toBeUndefined();
  });
});

