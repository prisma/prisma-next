import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  SqlStorage,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  filterCallsByControlPolicy,
  type ResolvedControlSubject,
} from '../src/core/migrations/control-policy';

function makeContract(
  tables: Record<string, StorageTableInput>,
  defaultControl?: Contract<SqlStorage>['defaultControl'],
): Contract<SqlStorage> {
  const storage = new SqlStorage({
    storageHash: coreHash('sha256:test'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, tables }),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage,
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    ...(defaultControl !== undefined ? { defaultControl } : {}),
  };
}

interface FakeCall {
  readonly name: string;
  readonly subject: ResolvedControlSubject | undefined;
}

function call(name: string, subject: ResolvedControlSubject | undefined): FakeCall {
  return { name, subject };
}

function tableSubject(
  control: ResolvedControlSubject['explicitNodeControlPolicy'] | undefined,
  createsNewObject: boolean,
): ResolvedControlSubject {
  return {
    namespaceId: UNBOUND_NAMESPACE_ID,
    table: 'users',
    createsNewObject,
    ...(control !== undefined ? { explicitNodeControlPolicy: control } : {}),
  };
}

function filter(calls: readonly FakeCall[], contract: Contract<SqlStorage>): readonly FakeCall[] {
  return filterCallsByControlPolicy({
    calls,
    contract,
    resolveSubject: (c) => c.subject,
  });
}

const tableInput: StorageTableInput = { columns: {}, uniques: [], indexes: [], foreignKeys: [] };

describe('filterCallsByControlPolicy', () => {
  describe('managed', () => {
    it('keeps every call, creation or modification', () => {
      const contract = makeContract({ users: { control: 'managed', ...tableInput } });
      const kept = filter(
        [
          call('createTable', tableSubject('managed', true)),
          call('dropTable', tableSubject('managed', false)),
          call('addColumn', tableSubject('managed', false)),
        ],
        contract,
      );
      expect(kept).toHaveLength(3);
    });

    it('keeps an unresolved-subject call', () => {
      const contract = makeContract({ users: tableInput });
      const kept = filter([call('createExtension', undefined)], contract);
      expect(kept).toHaveLength(1);
    });
  });

  describe('tolerated', () => {
    const contract = makeContract({ users: { control: 'tolerated', ...tableInput } });

    it('keeps a whole-object creation', () => {
      const kept = filter([call('createTable', tableSubject('tolerated', true))], contract);
      expect(kept.map((c) => c.name)).toEqual(['createTable']);
    });

    it('drops modifications of an existing object (no add column, index, alter, drop)', () => {
      const kept = filter(
        [
          call('addColumn', tableSubject('tolerated', false)),
          call('createIndex', tableSubject('tolerated', false)),
          call('alterColumnType', tableSubject('tolerated', false)),
          call('dropTable', tableSubject('tolerated', false)),
        ],
        contract,
      );
      expect(kept).toHaveLength(0);
    });

    it('drops an unresolved-subject call (not provably object-creation)', () => {
      const toleratedDefault = makeContract({ users: tableInput }, 'tolerated');
      const kept = filter([call('createExtension', undefined)], toleratedDefault);
      expect(kept).toHaveLength(0);
    });
  });

  describe('external and observed', () => {
    it('drops every call for an external or observed node', () => {
      for (const control of ['external', 'observed'] as const) {
        const contract = makeContract({ users: { control, ...tableInput } });
        const kept = filter(
          [
            call('createTable', tableSubject(control, true)),
            call('dropTable', tableSubject(control, false)),
          ],
          contract,
        );
        expect(kept).toHaveLength(0);
      }
    });

    it('observed default drops an unresolved-subject call', () => {
      const observedDefault = makeContract({ users: tableInput }, 'observed');
      const kept = filter([call('createExtension', undefined)], observedDefault);
      expect(kept).toHaveLength(0);
    });
  });

  describe('external floor', () => {
    const externalDefault = makeContract(
      { users: { control: 'managed', ...tableInput } },
      'external',
    );

    it('drops a managed-override creation (the floor wins)', () => {
      const kept = filter([call('createTable', tableSubject('managed', true))], externalDefault);
      expect(kept).toHaveLength(0);
    });

    it('drops an unresolved-subject call (fail-closed)', () => {
      const kept = filter([call('createExtension', undefined)], externalDefault);
      expect(kept).toHaveLength(0);
    });
  });
});
