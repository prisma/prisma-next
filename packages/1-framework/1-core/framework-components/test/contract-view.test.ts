import { describe, expect, it } from 'vitest';
import {
  buildNamespaceAccessor,
  buildSingleNamespaceView,
  composeContractView,
} from '../src/ir/contract-view';
import { UNBOUND_NAMESPACE_ID } from '../src/ir/namespace';
import type { Storage } from '../src/ir/storage';

function storageWith(entries: Record<string, unknown>): Storage {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, kind: 'test-namespace', entries },
    },
  } as unknown as Storage;
}

function multiNamespaceStorage(namespaces: Record<string, Record<string, unknown>>): Storage {
  return {
    namespaces: Object.fromEntries(
      Object.entries(namespaces).map(([id, entries]) => [
        id,
        { id, kind: 'test-namespace', entries },
      ]),
    ),
  } as unknown as Storage;
}

describe('buildSingleNamespaceView', () => {
  it('promotes built-in kinds to top-level and keeps pack kinds under .entries', () => {
    const table = { users: { name: 'users' } };
    const policy = { readAll: { name: 'readAll' } };
    const view = buildSingleNamespaceView<{
      table: typeof table;
      valueSet: Record<string, never>;
      entries: { policy: typeof policy };
    }>(storageWith({ table, policy }), ['table', 'valueSet']);

    expect(view.table).toBe(table);
    expect(view.entries.policy).toBe(policy);
    expect(Object.keys(view.entries)).toEqual(['policy']);
  });

  it('materializes a missing built-in kind as an empty map', () => {
    const view = buildSingleNamespaceView<{
      table: Record<string, unknown>;
      valueSet: Record<string, never>;
      entries: Record<string, never>;
    }>(storageWith({ table: { t: {} } }), ['table', 'valueSet']);

    expect(view.valueSet).toEqual({});
  });

  it('.entries excludes every built-in kind', () => {
    const view = buildSingleNamespaceView<{
      table: Record<string, unknown>;
      valueSet: Record<string, unknown>;
      entries: Record<string, unknown>;
    }>(storageWith({ table: {}, valueSet: {}, policy: {} }), ['table', 'valueSet']);

    expect(Object.keys(view.entries)).toEqual(['policy']);
  });

  it('throws when the contract has no default namespace', () => {
    const storage = { namespaces: {} } as unknown as Storage;
    expect(() => buildSingleNamespaceView(storage, ['table'])).toThrow(/default namespace/);
  });
});

describe('buildNamespaceAccessor', () => {
  it('keys every namespace by raw id, each kind-promoted', () => {
    const storage = multiNamespaceStorage({
      public: { table: { users: { c: 1 } } },
      auth: { table: { sessions: { c: 2 } } },
    });
    const ns = buildNamespaceAccessor<{
      public: { table: { users: unknown }; entries: object };
      auth: { table: { sessions: unknown }; entries: object };
    }>(storage, ['table', 'valueSet']);

    expect(Object.keys(ns).sort()).toEqual(['auth', 'public']);
    expect(ns.public.table.users).toEqual({ c: 1 });
    expect(ns.auth.table.sessions).toEqual({ c: 2 });
  });
});

describe('composeContractView', () => {
  it('contract fields win at the root; root accessors and namespace are added', () => {
    const contract = { storage: { ns: 1 }, domain: { models: {} }, roots: {} };
    const rootAccessors = { table: { users: {} }, entries: {} };
    const namespaceAccessor = { __unbound__: { table: { users: {} }, entries: {} } };
    const view = composeContractView<
      typeof contract & typeof rootAccessors & { namespace: typeof namespaceAccessor }
    >(contract, rootAccessors, namespaceAccessor);

    expect(view.storage).toBe(contract.storage);
    expect(view.table).toBe(rootAccessors.table);
    expect(view.namespace).toBe(namespaceAccessor);
    expect(view).not.toBe(contract);
  });

  it('promotes non-colliding namespace names to the root', () => {
    const contract = { storage: {}, domain: {}, roots: {} };
    const namespaceAccessor = {
      public: { table: { widgets: {} } },
      auth: { table: { sessions: {} } },
    };
    const view = composeContractView<Record<string, unknown>>(contract, {}, namespaceAccessor);

    expect(view['public']).toBe(namespaceAccessor.public);
    expect(view['auth']).toBe(namespaceAccessor.auth);
  });

  it('does NOT promote a namespace whose name collides with a contract field', () => {
    const contract = { storage: { isContractField: true }, domain: {}, roots: {} };
    const namespaceAccessor = {
      storage: { table: { secrets: {} } },
      public: { table: { widgets: {} } },
    };
    const view = composeContractView<Record<string, unknown>>(contract, {}, namespaceAccessor);

    // The contract field wins at the root.
    expect(view['storage']).toBe(contract.storage);
    expect((view['storage'] as Record<string, unknown>)['table']).toBeUndefined();
    // The colliding schema is reachable only via the namespace accessor.
    expect((view['namespace'] as Record<string, unknown>)['storage']).toBe(
      namespaceAccessor.storage,
    );
    // A non-colliding schema is still promoted.
    expect(view['public']).toBe(namespaceAccessor.public);
  });

  it('does NOT let a namespace named `namespace` overwrite the namespace accessor', () => {
    const contract = { storage: {}, domain: {}, roots: {} };
    const namespaceAccessor = { namespace: { table: { x: {} } }, public: { table: { y: {} } } };
    const view = composeContractView<Record<string, unknown>>(contract, {}, namespaceAccessor);

    // `view.namespace` is the accessor map (holds both ids), not the schema view.
    expect(view['namespace']).toBe(namespaceAccessor);
    expect((view['namespace'] as Record<string, unknown>)['namespace']).toBe(
      namespaceAccessor.namespace,
    );
    expect(view['public']).toBe(namespaceAccessor.public);
  });
});
