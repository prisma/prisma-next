import { describe, expect, it } from 'vitest';
import {
  canonicalizeContract,
  canonicalizeContractToObject,
  orderTopLevel,
} from '../src/canonicalization';
import type { Contract } from '../src/contract-types';
import { coreHash, profileHash } from '../src/types';

function minimal(overrides?: Record<string, unknown>): Contract {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    roots: {},
    models: {},
    storage: { storageHash: coreHash('sha256:stub') },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    profileHash: profileHash('sha256:stub'),
    ...overrides,
  };
}

function drill(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  let current: unknown = obj;
  for (const key of keys) {
    current = (current as Record<string, unknown>)[key];
  }
  return current as Record<string, unknown>;
}

describe('canonicalizeContractToObject', () => {
  it('returns an object with top-level keys in canonical order', () => {
    const result = canonicalizeContractToObject(minimal());
    const keys = Object.keys(result);
    expect(keys).toEqual([
      'targetFamily',
      'target',
      'profileHash',
      'roots',
      'models',
      'storage',
      'capabilities',
      'extensionPacks',
      'meta',
    ]);
  });

  it('includes schemaVersion when provided', () => {
    const result = canonicalizeContractToObject(minimal(), { schemaVersion: '1.0' });
    expect(result['schemaVersion']).toBe('1.0');
    expect(Object.keys(result)[0]).toBe('schemaVersion');
  });

  it('includes roots when provided', () => {
    const result = canonicalizeContractToObject(minimal({ roots: { users: 'User' } }));
    expect(result['roots']).toEqual({ users: 'User' });
  });

  it('includes execution when provided', () => {
    const input = minimal({
      execution: { executionHash: 'sha256:exec', mutations: { defaults: [] } },
    });
    const result = canonicalizeContractToObject(input);
    expect(result['execution']).toEqual({
      executionHash: 'sha256:exec',
      mutations: { defaults: [] },
    });
  });

  it('includes storageHash when provided inside storage', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 'sha256:abc' } }),
    );
    expect(drill(result, 'storage')['storageHash']).toBe('sha256:abc');
  });

  it('includes profileHash', () => {
    const result = canonicalizeContractToObject(minimal({ profileHash: 'sha256:def' }));
    expect(result['profileHash']).toBe('sha256:def');
  });

  it('keeps storageHash inside storage', () => {
    const result = canonicalizeContractToObject(minimal({ storage: { storageHash: 'sha256:s' } }));
    expect(result).not.toHaveProperty('storageHash');
    expect(drill(result, 'storage')['storageHash']).toBe('sha256:s');
  });

  it('keeps executionHash inside execution', () => {
    const result = canonicalizeContractToObject(
      minimal({
        execution: { executionHash: 'sha256:e', mutations: { defaults: [] } },
      }),
    );
    expect(result).not.toHaveProperty('executionHash');
    expect(drill(result, 'execution')['executionHash']).toBe('sha256:e');
  });

  it('places profileHash in canonical top-level order', () => {
    const result = canonicalizeContractToObject(minimal({ profileHash: 'sha256:p' }));
    const keys = Object.keys(result);
    const ordered = keys.filter((k) => ['profileHash', 'roots'].includes(k));
    expect(ordered).toEqual(['profileHash', 'roots']);
  });

  it('excludes keys not in the Contract schema', () => {
    const input = minimal({ zebra: 'z' });
    const result = canonicalizeContractToObject(input);
    expect(result).not.toHaveProperty('zebra');
  });

  it('sorts object keys recursively', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'text' }, nullable: false },
              age: { type: { kind: 'scalar', codecId: 'int' }, nullable: false },
            },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const userFields = drill(result, 'models', 'User', 'fields');
    expect(Object.keys(userFields)).toEqual(['age', 'name']);
  });
});

describe('default omission', () => {
  it('strips _generated key from nested objects', () => {
    const result = canonicalizeContractToObject(
      minimal({
        meta: { _generated: 'should be removed', kept: 'yes' } as Record<string, unknown>,
      }),
    );
    const meta = result['meta'] as Record<string, unknown>;
    expect(meta).not.toHaveProperty('_generated');
    expect(meta['kept']).toBe('yes');
  });

  it('preserves nullable: false on fields (ADR 172: always explicit)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: { id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false } },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drill(result, 'models', 'User', 'fields', 'id');
    expect(idField['nullable']).toBe(false);
  });

  it('strips generated: false', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, generated: false },
            },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drill(result, 'models', 'User', 'fields', 'id');
    expect(idField).not.toHaveProperty('generated');
  });

  it('strips onDelete: noAction and onUpdate: noAction', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            posts: {
              foreignKeys: {
                fk_user: { onDelete: 'noAction', onUpdate: 'noAction', columns: ['user_id'] },
              },
            },
          },
        },
      }),
    );
    const fk = drill(result, 'storage', 'tables', 'posts', 'foreignKeys', 'fk_user');
    expect(fk).not.toHaveProperty('onDelete');
    expect(fk).not.toHaveProperty('onUpdate');
  });

  it('preserves required empty objects at top level', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(result['models']).toEqual({});
    expect(result['extensionPacks']).toEqual({});
    expect(result['capabilities']).toEqual({});
    expect(result['meta']).toEqual({});
  });

  it('preserves empty storage.tables', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 'sha256:stub', tables: {} } }),
    );
    expect(drill(result, 'storage')['tables']).toEqual({});
  });

  it('preserves empty roots', () => {
    const result = canonicalizeContractToObject(minimal({ roots: {} }));
    expect(result['roots']).toEqual({});
  });

  it('preserves empty model relations', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: { id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false } },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const user = drill(result, 'models', 'User');
    expect(user['relations']).toEqual({});
  });

  it('preserves empty table uniques, indexes, and foreignKeys', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            users: { columns: {}, uniques: [], indexes: [], foreignKeys: {} },
          },
        },
      }),
    );
    const table = drill(result, 'storage', 'tables', 'users');
    expect(table['uniques']).toEqual([]);
    expect(table['indexes']).toEqual([]);
    expect(table['foreignKeys']).toEqual({});
  });

  it('strips false-valued FK boolean fields (constraint, index)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            posts: {
              foreignKeys: {
                fk_user: { columns: ['user_id'], constraint: false, index: false },
              },
            },
          },
        },
      }),
    );
    const fk = drill(result, 'storage', 'tables', 'posts', 'foreignKeys', 'fk_user');
    expect(fk).not.toHaveProperty('constraint');
    expect(fk).not.toHaveProperty('index');
  });

  it('preserves empty execution.mutations.defaults', () => {
    const result = canonicalizeContractToObject(
      minimal({
        execution: { executionHash: 'sha256:exec', mutations: { defaults: [] } },
      }),
    );
    const mutations = drill(result, 'execution', 'mutations');
    expect(mutations['defaults']).toEqual([]);
  });

  it('preserves empty extension namespace entries', () => {
    const result = canonicalizeContractToObject(minimal({ extensionPacks: { paradedb: {} } }));
    expect(drill(result, 'extensionPacks')['paradedb']).toEqual({});
  });

  it('preserves empty storage.collections and collection entries', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: { storageHash: 'sha256:stub', collections: { tasks: {} } },
      }),
    );
    const storage = drill(result, 'storage');
    expect(storage['collections']).toEqual({ tasks: {} });
  });

  it('preserves empty model storage (embedded documents)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          Address: {
            fields: { street: { type: { kind: 'scalar', codecId: 'string' }, nullable: false } },
            storage: {},
            relations: {},
            owner: 'User',
          },
        },
      }),
    );
    const address = drill(result, 'models', 'Address');
    expect(address['storage']).toEqual({});
  });

  it('strips non-required empty objects', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, extra: {} },
            },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drill(result, 'models', 'User', 'fields', 'id');
    expect(idField).not.toHaveProperty('extra');
  });

  it('preserves ISO date strings in meta', () => {
    const isoString = '2024-01-01T00:00:00.000Z';
    const result = canonicalizeContractToObject(
      minimal({
        meta: { createdAt: isoString } as Record<string, unknown>,
      }),
    );
    expect(drill(result, 'meta')['createdAt']).toBe(isoString);
  });

  it('preserves null values (not treated as default)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, default: null },
            },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drill(result, 'models', 'User', 'fields', 'id');
    expect(idField['default']).toBeNull();
  });
});

describe('index and unique sorting', () => {
  it('sorts indexes by name', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            users: {
              columns: {},
              indexes: [{ name: 'idx_z' }, { name: 'idx_a' }, { name: 'idx_m' }],
            },
          },
        },
      }),
    );
    const table = drill(result, 'storage', 'tables', 'users');
    const indexes = table['indexes'] as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(['idx_a', 'idx_m', 'idx_z']);
  });

  it('sorts uniques by name', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            users: {
              columns: {},
              uniques: [{ name: 'uq_z' }, { name: 'uq_a' }],
            },
          },
        },
      }),
    );
    const table = drill(result, 'storage', 'tables', 'users');
    const uniques = table['uniques'] as Array<{ name: string }>;
    expect(uniques.map((u) => u.name)).toEqual(['uq_a', 'uq_z']);
  });

  it('handles storage without tables (no-op)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: { storageHash: 'sha256:stub', collections: { tasks: {} } },
      }),
    );
    expect(result['storage']).toBeDefined();
  });

  it('preserves ISO date string defaults through sort', () => {
    const isoString = '2024-06-15T00:00:00.000Z';
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              createdAt: {
                type: { kind: 'scalar', codecId: 'timestamp' },
                nullable: false,
                default: isoString,
              },
            },
            storage: { table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const field = drill(result, 'models', 'User', 'fields', 'createdAt');
    expect(field['default']).toBe(isoString);
  });

  it('sorts indexes without name using empty-string fallback', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            users: {
              columns: {},
              indexes: [{ columns: ['b'] }, { name: 'idx_a', columns: ['a'] }],
            },
          },
        },
      }),
    );
    const table = drill(result, 'storage', 'tables', 'users');
    const indexes = table['indexes'] as Array<{ name?: string }>;
    expect(indexes[0]?.['name']).toBeUndefined();
    expect(indexes[1]?.['name']).toBe('idx_a');
  });

  it('sorts uniques without name using empty-string fallback', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: {
            users: {
              columns: {},
              uniques: [{ columns: ['b'] }, { name: 'uq_a', columns: ['a'] }],
            },
          },
        },
      }),
    );
    const table = drill(result, 'storage', 'tables', 'users');
    const uniques = table['uniques'] as Array<{ name?: string }>;
    expect(uniques[0]?.['name']).toBeUndefined();
    expect(uniques[1]?.['name']).toBe('uq_a');
  });

  it('handles non-object table entries gracefully', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'sha256:stub',
          tables: { bad: null as unknown as Record<string, unknown> },
        },
      }),
    );
    const tables = drill(result, 'storage', 'tables');
    expect(tables['bad']).toBeNull();
  });
});

describe('canonicalizeContract', () => {
  it('returns a JSON string', () => {
    const result = canonicalizeContract(minimal());
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('serializes number values in meta', () => {
    const result = canonicalizeContract(
      minimal({
        meta: { limit: 42 } as Record<string, unknown>,
      }),
    );
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(drill(parsed, 'meta')['limit']).toBe(42);
  });

  it('produces identical output as JSON.stringify of canonicalizeContractToObject', () => {
    const input = minimal({
      storage: { storageHash: 'sha256:test' },
      profileHash: 'sha256:profile',
    });
    const objResult = canonicalizeContractToObject(input);
    const strResult = canonicalizeContract(input);
    expect(JSON.parse(strResult)).toEqual(objResult);
  });
});

describe('orderTopLevel', () => {
  it('places known keys in canonical order followed by unknown keys sorted alphabetically', () => {
    const result = orderTopLevel({
      zebra: 'z',
      target: 'postgres',
      apple: 'a',
      targetFamily: 'sql',
    });
    expect(Object.keys(result)).toEqual(['targetFamily', 'target', 'apple', 'zebra']);
  });

  it('places valueObjects between models and storage', () => {
    const result = orderTopLevel({
      storage: {},
      valueObjects: { Address: { fields: {} } },
      models: {},
      target: 'postgres',
    });
    const keys = Object.keys(result);
    expect(keys.indexOf('models')).toBeLessThan(keys.indexOf('valueObjects'));
    expect(keys.indexOf('valueObjects')).toBeLessThan(keys.indexOf('storage'));
  });
});

describe('canonicalize with valueObjects', () => {
  it('includes valueObjects in canonicalized output when present', () => {
    const contract = minimal({
      valueObjects: {
        Address: {
          fields: {
            street: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            city: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
    });
    const result = canonicalizeContractToObject(contract);
    expect(result).toHaveProperty('valueObjects');
    const vo = result['valueObjects'] as Record<string, unknown>;
    expect(vo).toHaveProperty('Address');
  });

  it('omits valueObjects from output when undefined', () => {
    const contract = minimal();
    const result = canonicalizeContractToObject(contract);
    expect(result).not.toHaveProperty('valueObjects');
  });
});
