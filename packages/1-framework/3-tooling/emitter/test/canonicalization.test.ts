import { canonicalizeContract } from '@prisma-next/core-control-plane/emission';
import { describe, expect, it } from 'vitest';
import { createContractIR } from './utils';

describe('canonicalization', () => {
  it('orders top-level sections correctly', () => {
    const ir = createContractIR({
      capabilities: { postgres: { jsonAgg: true } },
      meta: { source: 'test' },
    });

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
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
            },
          },
        },
      },
    });

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

  it('keeps nullable false for columns with defaults', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              created_at: {
                codecId: 'pg/timestamptz@1',
                nativeType: 'timestamptz',
                nullable: false,
                default: { kind: 'function', expression: 'now()' },
              },
            },
          },
        },
      },
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const storage = parsed['storage'] as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown>;
    const user = tables['user'] as Record<string, unknown>;
    const columns = user['columns'] as Record<string, unknown>;
    const createdAt = columns['created_at'] as Record<string, unknown>;
    expect(createdAt['nullable']).toBe(false);
  });

  it('omits empty arrays and objects except required ones', () => {
    const ir = createContractIR();

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      models: expect.anything(),
      storage: {
        tables: expect.anything(),
      },
    });
    // Required top-level fields (capabilities, extensionPacks, meta, relations, sources) are preserved even when empty
    // because they are required by ContractIR and needed for round-trip tests
    expect(parsed).toMatchObject({
      capabilities: expect.anything(),
      extensionPacks: expect.anything(),
      meta: expect.anything(),
      relations: expect.anything(),
      sources: expect.anything(),
    });
  });

  it('preserves semantic array order for column lists', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              first: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              second: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: {
              columns: ['second', 'first'],
            },
          },
        },
      },
    });

    const result1 = canonicalizeContract(ir);

    const ir2 = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              first: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              second: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: {
              columns: ['first', 'second'],
            },
          },
        },
      },
    });

    const result2 = canonicalizeContract(ir2);

    expect(result1).not.toBe(result2);
  });

  it('sorts non-semantic arrays by canonical name', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            indexes: [
              { columns: ['id'], name: 'user_email_idx' },
              { columns: ['id'], name: 'user_name_idx' },
            ],
          },
        },
      },
    });

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
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              z_field: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              a_field: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              m_field: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
          },
        },
      },
    });

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
    const ir = createContractIR({
      extensionPacks: {
        pgvector: { version: '0.0.1' },
        postgres: { version: '0.0.1' },
        another: { version: '0.0.1' },
      },
    });

    const result = canonicalizeContract(ir);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const extensionPacks = parsed['extensionPacks'] as Record<string, unknown>;
    const extensionKeys = Object.keys(extensionPacks);
    expect(extensionKeys).toEqual(['another', 'pgvector', 'postgres']);
  });

  it('omits generated false', () => {
    const ir = createContractIR({
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false, generated: false },
            },
          },
        },
      },
    });

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
