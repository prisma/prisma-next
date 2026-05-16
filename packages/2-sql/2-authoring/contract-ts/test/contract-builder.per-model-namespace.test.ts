import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { freezeNode, type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
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
};

const sqliteTargetPack: TargetPackRef<'sql', 'sqlite'> = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
};

class StubNamespace extends NamespaceBase {
  readonly kind = 'schema' as const;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }

  qualifier(): string {
    return `"${this.id}"`;
  }

  qualifyTable(name: string): string {
    return `"${this.id}"."${name}"`;
  }
}

function createStubNamespace(id: string): Namespace {
  return new StubNamespace(id);
}

const int4Column = columnDescriptor('pg/int4@1');

const userModelArgs = {
  fields: {
    id: field.column(int4Column).id(),
  },
} as const;

describe('FR16a per-model `namespace` field (TS builder)', () => {
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

    const table = contract.storage.tables['User'] as { readonly namespaceId?: string } | undefined;
    expect(table).toBeDefined();
    expect(table?.namespaceId).toBe('auth');
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

    const table = contract.storage.tables['User'] as { readonly namespaceId?: string } | undefined;
    expect(table?.namespaceId).toBeUndefined();
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
