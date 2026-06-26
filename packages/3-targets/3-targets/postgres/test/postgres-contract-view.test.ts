import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresContractView } from '../src/core/postgres-contract-view';
import type { Contract } from './fixtures/namespaced-contract.d';
import contractJson from './fixtures/namespaced-contract.json' with { type: 'json' };

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

describe('PostgresContractView', () => {
  it('from() returns a view object', () => {
    expect(PostgresContractView.from(contract)).toBeDefined();
  });

  it('keys each schema separately with its own tables', () => {
    const cv = PostgresContractView.from(contract);
    expect(cv.public.table.users).toBeDefined();
    expect(cv.auth.table.users).toBeDefined();
    expect(Object.keys(cv.public.table.users.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(cv.auth.table.users.columns).sort()).toEqual(['id', 'token']);
  });

  it('cv.<ns>.table.<name> returns the same entity object as the raw contract', () => {
    const cv = PostgresContractView.from(contract);
    expect(cv.public.table.users).toBe(contract.storage.namespaces['public']?.entries.table?.users);
    expect(cv.auth.table.users).toBe(contract.storage.namespaces['auth']?.entries.table?.users);
  });

  it('cv.<ns>.valueSet is present and empty (no value sets emitted)', () => {
    const cv = PostgresContractView.from(contract);
    expect(cv.public.valueSet).toEqual({});
    expect(cv.auth.valueSet).toEqual({});
  });

  it('cv.<ns>.entries excludes the built-in table and valueSet keys', () => {
    const cv = PostgresContractView.from(contract);
    expect(Object.keys(cv.public.entries)).not.toContain('table');
    expect(Object.keys(cv.public.entries)).not.toContain('valueSet');
  });

  it('the default __unbound__ schema is keyed by its raw id (mirrors the facade)', () => {
    // Mirror the facade's keying: the default schema is reachable under its raw
    // `__unbound__` id, not a renamed key. Hand-built since the committed
    // namespaced fixture uses only named schemas.
    const withDefault = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          __unbound__: {
            id: '__unbound__',
            kind: 'postgres-schema',
            entries: { table: { widgets: { columns: {} } } },
          },
        },
      },
    } as unknown as Contract;

    const cv = PostgresContractView.from(withDefault) as Record<
      string,
      { table: Record<string, unknown> }
    >;
    expect(cv['__unbound__']?.table['widgets']).toBeDefined();
  });

  it('cv.<ns>.entries exposes pack-contributed kinds', () => {
    // RLS `policy` isn't in a committed fixture yet, so hand-build a contract
    // with a pack-contributed `policy` kind under the public schema.
    const fakePolicy = { name: 'read_all' };
    const withPolicy = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...contract.storage.namespaces['public'],
            entries: {
              ...contract.storage.namespaces['public']?.entries,
              policy: { readAll: fakePolicy },
            },
          },
        },
      },
    } as unknown as Contract;

    const cv = PostgresContractView.from(withPolicy);
    expect((cv.public.entries as Record<string, unknown>)['policy']).toEqual({
      readAll: fakePolicy,
    });
  });
});
