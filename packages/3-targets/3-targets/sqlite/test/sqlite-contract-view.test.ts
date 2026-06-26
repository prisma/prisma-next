import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';
import { SqliteContractView } from '../src/core/sqlite-contract-view';
import type { Contract } from './fixtures/sqlite-contract.d';
import contractJson from './fixtures/sqlite-contract.json' with { type: 'json' };

const contract = new SqliteContractSerializer().deserializeContract<Contract>(contractJson);

describe('SqliteContractView', () => {
  it('from() returns a view object', () => {
    expect(SqliteContractView.from(contract)).toBeDefined();
  });

  it('cv.table exposes tables from the default namespace', () => {
    const cv = SqliteContractView.from(contract);
    expect(cv.table.users).toBeDefined();
    expect(cv.table.posts).toBeDefined();
  });

  it('cv.table.<name> returns the same entity object as the raw contract', () => {
    const cv = SqliteContractView.from(contract);
    const rawTables = contract.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table;
    expect(cv.table.users).toBe(rawTables?.users);
  });

  it('cv.valueSet is present and empty (SQLite emits no value sets)', () => {
    const cv = SqliteContractView.from(contract);
    expect(cv.valueSet).toEqual({});
  });

  it('cv.entries does not contain the built-in table or valueSet keys', () => {
    const cv = SqliteContractView.from(contract);
    expect(Object.keys(cv.entries)).not.toContain('table');
    expect(Object.keys(cv.entries)).not.toContain('valueSet');
  });

  it('cv.entries exposes pack-contributed kinds', () => {
    // SQLite emits only the built-in `table` kind, so this hand-builds a
    // contract with an extra pack-contributed `policy` kind to prove non-built-in
    // kinds land under `.entries`.
    const fakeEntry = { name: 'test-pack-entity' };
    const contractWithPackKind = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...contract.storage.namespaces[UNBOUND_NAMESPACE_ID],
            entries: {
              ...contract.storage.namespaces[UNBOUND_NAMESPACE_ID].entries,
              policy: { readPolicy: fakeEntry },
            },
          },
        },
      },
    } as unknown as Contract;

    const cv = SqliteContractView.from(contractWithPackKind);
    expect((cv.entries as Record<string, unknown>)['policy']).toEqual({ readPolicy: fakeEntry });
  });
});
