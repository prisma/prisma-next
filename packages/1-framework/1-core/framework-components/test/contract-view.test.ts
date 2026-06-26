import { describe, expect, it } from 'vitest';
import { buildSingleNamespaceView } from '../src/ir/contract-view';
import { UNBOUND_NAMESPACE_ID } from '../src/ir/namespace';
import type { Storage } from '../src/ir/storage';

function storageWith(entries: Record<string, unknown>): Storage {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, kind: 'test-namespace', entries },
    },
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
