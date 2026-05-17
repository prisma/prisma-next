import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { freezeNode, type Namespace, NamespaceBase } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

/**
 * FR16b — TS builder cross-namespace FK lowering.
 *
 * The model handle carries the referenced model's `namespace` coordinate;
 * when a relation/FK call site references a model that lives in a
 * different namespace from the declaring model, the lowering picks up
 * `targetSpec.namespace` and populates `target.namespaceId` on the
 * resulting `ForeignKey` IR. No new TS syntax — this exercises the
 * existing relations DSL and constraints DSL automatically.
 */

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

const textColumn = columnDescriptor('pg/text@1');

interface NamespacedFkTargetTable {
  readonly foreignKeys?: readonly {
    readonly source: { readonly columns: readonly string[] };
    readonly target: {
      readonly table: string;
      readonly namespaceId?: string;
      readonly columns: readonly string[];
    };
  }[];
}

describe('FR16b cross-namespace FK lowering (TS builder)', () => {
  it('populates target.namespaceId from the target model handle when namespaces differ (rel.belongsTo)', () => {
    const User = model('User', {
      namespace: 'auth',
      fields: {
        id: field.column(textColumn).id(),
      },
    });

    const Profile = model('Profile', {
      namespace: 'public',
      fields: {
        id: field.column(textColumn).id(),
        userId: field.column(textColumn).column('user_id'),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
      },
    }).sql({ table: 'profile' });

    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createStubNamespace,
      foreignKeyDefaults: { constraint: true, index: true },
      models: { User, Profile },
    });

    const profile = contract.storage.tablesByNamespace?.['public']?.['profile'] as
      | NamespacedFkTargetTable
      | undefined;
    expect(profile).toBeDefined();
    const fk = profile?.foreignKeys?.[0];
    expect(fk).toBeDefined();
    expect(fk?.target.table).toBe('User');
    expect(fk?.target.namespaceId).toBe('auth');
  });

  it('populates target.namespaceId via the constraints.foreignKey DSL when namespaces differ', () => {
    const User = model('User', {
      namespace: 'auth',
      fields: {
        id: field.column(textColumn).id(),
      },
    });

    const Profile = model('Profile', {
      namespace: 'public',
      fields: {
        id: field.column(textColumn).id(),
        userId: field.column(textColumn).column('user_id'),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [
        constraints.foreignKey([cols.userId], [User.refs['id']!], {
          name: 'profile_user_id_fkey',
        }),
      ],
    }));

    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: createStubNamespace,
      foreignKeyDefaults: { constraint: true, index: false },
      models: { User, Profile },
    });

    const profile = contract.storage.tablesByNamespace?.['public']?.['profile'] as
      | NamespacedFkTargetTable
      | undefined;
    const fk = profile?.foreignKeys?.[0];
    expect(fk?.target.table).toBe('User');
    expect(fk?.target.namespaceId).toBe('auth');
  });

  it('same-namespace FKs collapse target.namespaceId to the source namespace (no spurious cross-namespace coordinate)', () => {
    const User = model('User', {
      namespace: 'public',
      fields: {
        id: field.column(textColumn).id(),
      },
    });

    const Profile = model('Profile', {
      namespace: 'public',
      fields: {
        id: field.column(textColumn).id(),
        userId: field.column(textColumn).column('user_id'),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
      },
    }).sql({ table: 'profile' });

    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      namespaces: ['public'],
      createNamespace: createStubNamespace,
      foreignKeyDefaults: { constraint: true, index: true },
      models: { User, Profile },
    });

    const profile = contract.storage.tablesByNamespace?.['public']?.['profile'] as
      | NamespacedFkTargetTable
      | undefined;
    const fk = profile?.foreignKeys?.[0];
    expect(fk?.target.table).toBe('User');
    expect(fk?.target.namespaceId).toBe('public');
  });
});
