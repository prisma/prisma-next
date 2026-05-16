import type { TargetPackRef } from '@prisma-next/framework-components/components';
import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { SqlUnboundNamespace } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

class FakePostgresSchema extends NamespaceBase {
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

/**
 * Test-side stand-in for `postgresCreateNamespace` — the SQL family
 * layer is target-agnostic and cannot depend on `target-postgres`, so
 * the test uses a locally-defined fake `Namespace` concretion that
 * satisfies the same contract. The Postgres target's own test suite
 * verifies the real factory's behaviour against `PostgresSchema`.
 */
function fakePostgresCreateNamespace(id: string): Namespace {
  return new FakePostgresSchema(id);
}

const minimalModelArgs = {
  modelName: 'User',
  tableName: 'app_user',
  fields: [
    {
      fieldName: 'id',
      columnName: 'id',
      descriptor: {
        codecId: 'pg/int4@1',
        nativeType: 'int4',
      },
      nullable: false,
    },
  ],
  id: {
    columns: ['id'],
  },
} as const;

describe('SqlStorage.namespaces population (FR15 slice 3)', () => {
  it('falls back to the SqlUnboundNamespace singleton when no createNamespace factory is supplied (single-namespace default)', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [minimalModelArgs],
    });
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]).toBe(SqlUnboundNamespace.instance);
    expect(Object.keys(contract.storage.namespaces)).toEqual([UNBOUND_NAMESPACE_ID]);
  });

  it('routes every declared namespace through the supplied factory and parks the result in the storage map', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      createNamespace: fakePostgresCreateNamespace,
      models: [minimalModelArgs],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth', 'public']);
    expect(contract.storage.namespaces['public']).toBeInstanceOf(FakePostgresSchema);
    expect(contract.storage.namespaces['auth']).toBeInstanceOf(FakePostgresSchema);
    expect((contract.storage.namespaces['public'] as FakePostgresSchema).id).toBe('public');
    expect((contract.storage.namespaces['auth'] as FakePostgresSchema).id).toBe('auth');
  });

  it('collects namespaceIds referenced by storage tables and routes them through the factory even when not pre-declared', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      createNamespace: fakePostgresCreateNamespace,
      models: [
        { ...minimalModelArgs, namespaceId: 'auth' },
        { ...minimalModelArgs, modelName: 'Post', tableName: 'blog_post' },
      ],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth']);
    expect(contract.storage.namespaces['auth']).toBeInstanceOf(FakePostgresSchema);
  });

  it('always materialises the unbound slot through the factory when one is supplied (no SqlUnboundNamespace leak in the live storage map)', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      createNamespace: fakePostgresCreateNamespace,
      models: [minimalModelArgs],
    });
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]).toBeInstanceOf(FakePostgresSchema);
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]).not.toBe(
      SqlUnboundNamespace.instance,
    );
  });

  it('rejects multi-namespace contracts when no factory is supplied — the family layer cannot materialise non-unbound concretions on its own', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        target: postgresTargetPack,
        namespaces: ['auth'],
        models: [minimalModelArgs],
      }),
    ).toThrow(/createNamespace/);
  });

  it('deduplicates declared and table-referenced namespace ids — no slot is built twice', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaces: ['auth'],
      createNamespace: fakePostgresCreateNamespace,
      models: [{ ...minimalModelArgs, namespaceId: 'auth' }],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth']);
  });
});
