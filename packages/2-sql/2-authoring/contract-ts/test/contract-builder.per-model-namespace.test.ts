import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import {
  freezeNode,
  type IRNode,
  type Namespace,
  NamespaceBase,
} from '@prisma-next/framework-components/ir';
import type { SqlNamespaceTablesInput } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const sqlFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const sqliteTargetPack: TargetPackRef<'sql', 'sqlite'> = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
};

class StubNamespace extends NamespaceBase {
  readonly kind = 'schema' as const;
  readonly id: string;
  readonly entries: Readonly<{ readonly table: Readonly<Record<string, IRNode>> }>;

  constructor(id: string, tables: Readonly<Record<string, IRNode>> = {}) {
    super();
    this.id = id;
    this.entries = Object.freeze({ table: Object.freeze({ ...tables }) });
    freezeNode(this);
  }

  qualifier(): string {
    return `"${this.id}"`;
  }

  qualifyTable(name: string): string {
    return `"${this.id}"."${name}"`;
  }
}

function createStubNamespace(input: SqlNamespaceTablesInput): Namespace {
  return new StubNamespace(
    input.id,
    input.entries?.table as Readonly<Record<string, IRNode>> | undefined,
  );
}

const int4Column = columnDescriptor('pg/int4@1');

const userModelArgs = {
  fields: {
    id: field.column(int4Column).id(),
  },
} as const;

describe('per-model `namespace` field (TS builder)', () => {
  it('lowers `model(name, { namespace, fields })` to `StorageTable.namespaceId`', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createStubNamespace,
      models: {
        User: model('User', { namespace: 'auth', ...userModelArgs }),
      },
    });

    // The type-level `tables` for a declared namespace is `{}` to keep
    // `keyof` as `never` (preventing `Db<C>` from collapsing to a string
    // index signature). The runtime value is correct; cast to verify it.
    expect(
      (
        contract.storage.namespaces as Record<
          string,
          { entries: { table: Record<string, unknown> } }
        >
      )['auth']?.entries.table['User'],
    ).toBeDefined();
  });

  it('omits `namespaceId` for models that do not set `namespace` — the late-bound default stays implicit', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createStubNamespace,
      models: {
        User: model('User', userModelArgs),
      },
    });

    expect(
      (contract.storage.namespaces['public']?.entries.table as Record<string, unknown>)['User'],
    ).toBeDefined();
  });

  it('rejects per-model `namespace` that does not appear in the declared list', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public'],
        createNamespace: createStubNamespace,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(/User.*auth.*does not appear/);
  });

  it('rejects per-model `namespace` when no namespaces are declared at all', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(/User.*auth.*does not declare any namespaces/);
  });

  it('rejects per-model `namespace: "__unbound__"` — the IR sentinel is reserved on every target', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        models: {
          User: model('User', { namespace: '__unbound__', ...userModelArgs }),
        },
      }),
    ).toThrow(/__unbound__.*reserved/);
  });

  it('rejects per-model `namespace: "__unspecified__"` — the parser sentinel is reserved on every target', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        models: {
          User: model('User', { namespace: '__unspecified__', ...userModelArgs }),
        },
      }),
    ).toThrow(/__unspecified__.*reserved/);
  });

  it('rejects per-model `namespace: "unbound"` on Postgres — points to the PSL block', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        models: {
          User: model('User', { namespace: 'unbound', ...userModelArgs }),
        },
      }),
    ).toThrow(/unbound.*Postgres.*namespace unbound/);
  });

  it('rejects per-model `namespace` on SQLite outright — SQLite has no schema concept', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        models: {
          User: model('User', { namespace: 'auth', ...userModelArgs }),
        },
      }),
    ).toThrow(/SQLite/);
  });
});
