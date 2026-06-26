import { describe, expect, it } from 'vitest';
import { MongoContractView } from '../src/contract-view';
import type { Contract } from './fixtures/orm-contract.d';
import contractJson from './fixtures/orm-contract.json' with { type: 'json' };

// The fixture JSON is typed as the emitted `Contract` so the view's projected
// types are exercised. These tests assert runtime property access on the view,
// not contract deserialization.
const contract = contractJson as unknown as Contract;

describe('MongoContractView', () => {
  it('from() returns a view object', () => {
    const cv = MongoContractView.from(contract);
    expect(cv).toBeDefined();
  });

  it('cv.collection exposes collections from the default namespace', () => {
    const cv = MongoContractView.from(contract);
    expect(cv.collection).toBeDefined();
    expect(cv.collection.tasks).toBeDefined();
    expect(cv.collection.users).toBeDefined();
  });

  it('cv.collection.<name> returns the MongoCollection entity', () => {
    const cv = MongoContractView.from(contract);
    expect(cv.collection.tasks).toBe(
      contract.storage.namespaces['__unbound__'].entries['collection']['tasks'],
    );
    expect(cv.collection.users).toBe(
      contract.storage.namespaces['__unbound__'].entries['collection']['users'],
    );
  });

  it('cv.entries does not contain the collection key', () => {
    const cv = MongoContractView.from(contract);
    expect(Object.keys(cv.entries)).not.toContain('collection');
  });

  it('cv.entries exposes pack-contributed kinds', () => {
    // The fixture only carries the built-in `collection` kind, so this test
    // hand-builds a contract with an extra pack-contributed `policy` kind to
    // prove non-built-in kinds land under `.entries`.
    const fakeEntry = { name: 'test-pack-entity' };
    const contractWithPackKind = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          __unbound__: {
            ...contract.storage.namespaces['__unbound__'],
            entries: {
              ...contract.storage.namespaces['__unbound__'].entries,
              policy: { readPolicy: fakeEntry },
            },
          },
        },
      },
    } as unknown as Contract;

    const cv = MongoContractView.from(contractWithPackKind);
    expect((cv.entries as Record<string, unknown>)['policy']).toEqual({
      readPolicy: fakeEntry,
    });
  });
});
