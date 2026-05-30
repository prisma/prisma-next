import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
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

describe('SqlStorage.namespaces population', () => {
  it('materialises the unbound namespace with lowered tables when models default to the unbound coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [minimalModelArgs],
    });
    expect(
      [...storageNamespaceEntries(contract.storage as Record<string, unknown>)].map(([id]) => id),
    ).toEqual([UNBOUND_NAMESPACE_ID]);
    const slot = getStorageNamespace(
      contract.storage as Record<string, unknown>,
      UNBOUND_NAMESPACE_ID,
    )!;
    expect(slot).not.toBe(SqlUnboundNamespace.instance);
    expect(slot.id).toBe(UNBOUND_NAMESPACE_ID);
    expect(slot.tables['app_user']).toBeDefined();
  });

  it('creates declared namespace slots (initially empty tables) alongside the unbound coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      models: [minimalModelArgs],
    });
    const namespaceIds = [...storageNamespaceEntries(contract.storage as Record<string, unknown>)]
      .map(([id]) => id)
      .sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth', 'public']);
    expect(
      Object.keys(
        getStorageNamespace(contract.storage as Record<string, unknown>, 'public')!.tables,
      ),
    ).toHaveLength(0);
    expect(
      Object.keys(getStorageNamespace(contract.storage as Record<string, unknown>, 'auth')!.tables),
    ).toHaveLength(0);
    expect(
      getStorageNamespace(contract.storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID)!
        .tables['app_user'],
    ).toBeDefined();
  });

  it('places tables in the namespace referenced by the model coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        { ...minimalModelArgs, namespaceId: 'auth' },
        { ...minimalModelArgs, modelName: 'Post', tableName: 'blog_post' },
      ],
    });
    const namespaceIds = [...storageNamespaceEntries(contract.storage as Record<string, unknown>)]
      .map(([id]) => id)
      .sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth']);
    expect(
      getStorageNamespace(contract.storage as Record<string, unknown>, 'auth')!.tables['app_user'],
    ).toBeDefined();
    expect(
      getStorageNamespace(contract.storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID)!
        .tables['blog_post'],
    ).toBeDefined();
  });

  it('keeps the unbound singleton only when the unbound coordinate has no tables and no namespace types', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [],
    });
    expect(
      getStorageNamespace(contract.storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID),
    ).toBe(SqlUnboundNamespace.instance);
  });

  it('accepts declared namespaces without a createNamespace factory', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        target: postgresTargetPack,
        namespaces: ['auth'],
        models: [minimalModelArgs],
      }),
    ).not.toThrow();
  });

  it('deduplicates declared and table-referenced namespace ids — no slot is built twice', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaces: ['auth'],
      models: [{ ...minimalModelArgs, namespaceId: 'auth' }],
    });
    const namespaceIds = [...storageNamespaceEntries(contract.storage as Record<string, unknown>)]
      .map(([id]) => id)
      .sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth']);
    expect(
      getStorageNamespace(contract.storage as Record<string, unknown>, 'auth')!.tables['app_user'],
    ).toBeDefined();
  });
});
