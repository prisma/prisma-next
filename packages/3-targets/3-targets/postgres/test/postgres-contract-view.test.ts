import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresContractView } from '../src/core/postgres-contract-view';
import { type CollisionContract, collisionContractValue } from './fixtures/collision-contract';
import type { Contract } from './fixtures/namespaced-contract.d';
import contractJson from './fixtures/namespaced-contract.json' with { type: 'json' };

const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

describe('PostgresContractView', () => {
  it('from() returns a view object', () => {
    expect(PostgresContractView.from(contract)).toBeDefined();
  });

  it('the view is a superset of the contract (contract fields present)', () => {
    const view = PostgresContractView.from(contract);
    expect(view.storage).toBe(contract.storage);
    expect(view.domain).toBe(contract.domain);
    expect(view.roots).toBe(contract.roots);
  });

  it('keys each schema separately with its own tables', () => {
    const view = PostgresContractView.from(contract);
    expect(view.public.table.users).toBeDefined();
    expect(view.auth.table.users).toBeDefined();
    expect(Object.keys(view.public.table.users.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(view.auth.table.users.columns).sort()).toEqual(['id', 'token']);
  });

  it('view.<ns>.table.<name> returns the same entity object as the raw contract', () => {
    const view = PostgresContractView.from(contract);
    expect(view.public.table.users).toBe(
      contract.storage.namespaces['public']?.entries.table?.users,
    );
    expect(view.auth.table.users).toBe(contract.storage.namespaces['auth']?.entries.table?.users);
  });

  it('view.namespace.<id> reaches every schema by raw id', () => {
    const view = PostgresContractView.from(contract);
    expect(view.namespace.public.table.users).toBe(view.public.table.users);
    expect(view.namespace.auth.table.users).toBe(view.auth.table.users);
  });

  it('view.<ns>.valueSet is present and empty (no value sets emitted)', () => {
    const view = PostgresContractView.from(contract);
    expect(view.public.valueSet).toEqual({});
    expect(view.auth.valueSet).toEqual({});
  });

  it('view.<ns>.entries excludes the built-in table and valueSet keys', () => {
    const view = PostgresContractView.from(contract);
    expect(Object.keys(view.public.entries)).not.toContain('table');
    expect(Object.keys(view.public.entries)).not.toContain('valueSet');
  });

  it('fromJson() deserializes and wraps in one call', () => {
    const view = PostgresContractView.fromJson<Contract>(contractJson);
    expect(view.public.table.users).toBeDefined();
    expect(view.auth.table.users).toBeDefined();
    expect(view.storage.storageHash).toBe(contract.storage.storageHash);
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

    const view = PostgresContractView.from(withDefault) as unknown as Record<
      string,
      { table: Record<string, unknown> }
    >;
    expect(view['__unbound__']?.table['widgets']).toBeDefined();
  });

  it('view.<ns>.entries exposes pack-contributed kinds', () => {
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

    const view = PostgresContractView.from(withPolicy);
    expect((view.public.entries as Record<string, unknown>)['policy']).toEqual({
      readAll: fakePolicy,
    });
  });

  describe('schema-name collision with a contract field', () => {
    const collision = collisionContractValue as unknown as CollisionContract;

    it('view.storage stays the contract field (not the schema named `storage`)', () => {
      const view = PostgresContractView.from(collision);
      expect(view.storage).toBe(collision.storage);
      expect(view.storage.namespaces).toBeDefined();
      // The contract field has no `.table` — the schema view would.
      expect((view.storage as unknown as Record<string, unknown>)['table']).toBeUndefined();
    });

    it('the `storage`-named schema is reachable via view.namespace.storage', () => {
      const view = PostgresContractView.from(collision);
      expect(view.namespace.storage.table.secrets).toBe(
        collision.storage.namespaces.storage.entries.table.secrets,
      );
    });

    it('a non-colliding schema (`public`) is promoted to the root AND under namespace', () => {
      const view = PostgresContractView.from(collision);
      expect(view.public.table.widgets).toBe(
        collision.storage.namespaces.public.entries.table.widgets,
      );
      expect(view.namespace.public.table.widgets).toBe(view.public.table.widgets);
    });
  });
});
