import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  namespaceTables,
  namespaceValueSets,
  type SqlStorage,
  StorageTable,
  StorageValueSet,
} from '@prisma-next/sql-contract/types';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { SqlContractSerializer } from '../src/core/ir/sql-contract-serializer';

function makeContractJson(entries: Record<string, Record<string, unknown>>) {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Round-trip: built-in kinds hydrate to class instances
// ---------------------------------------------------------------------------

describe('SqlContractSerializer — built-in kind hydration', () => {
  it('hydrates table entries to StorageTable instances', () => {
    const json = makeContractJson({
      table: {
        users: {
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });
    const serializer = new SqlContractSerializer();
    const contract = serializer.deserializeContract(json) as Contract<SqlStorage>;
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    expect(namespaceTables(ns!)['users']).toBeInstanceOf(StorageTable);
  });

  it('hydrates valueSet entries to StorageValueSet instances', () => {
    const json = makeContractJson({
      table: {},
      valueSet: { Role: { kind: 'valueSet', values: ['user', 'admin'] } },
    });
    const serializer = new SqlContractSerializer();
    const contract = serializer.deserializeContract(json) as Contract<SqlStorage>;
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    expect(namespaceValueSets(ns!)['Role']).toBeInstanceOf(StorageValueSet);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: unknown entries key at validation boundary
// ---------------------------------------------------------------------------

describe('SqlContractSerializer — fail-closed at validation boundary', () => {
  it('throws on a contract with an unregistered entries key, error names the kind', () => {
    const json = makeContractJson({
      table: {},
      bogus: { Foo: { kind: 'bogus', name: 'Foo' } },
    });
    const serializer = new SqlContractSerializer();
    expect(() => serializer.deserializeContract(json)).toThrow(/bogus/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: unknown entries key at hydration boundary
// ---------------------------------------------------------------------------

describe('SqlContractSerializer — fail-closed at hydration boundary', () => {
  it('throws on a raw namespace with an unregistered entries key, error names the kind', () => {
    const json = {
      targetFamily: 'sql',
      target: 'sql',
      profileHash: 'sha256:test',
      roots: {},
      storage: {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              bogus: { Foo: {} },
            },
          },
        },
      },
      domain: {
        namespaces: {},
        models: {},
        valueObjects: {},
        capabilities: {},
      },
    };
    const serializer = new SqlContractSerializer();
    expect(() => serializer.deserializeContract(json)).toThrow(/bogus/);
  });
});
