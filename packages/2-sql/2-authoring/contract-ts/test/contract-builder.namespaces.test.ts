import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { namespaceTables, SqlUnboundNamespace } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
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
  it('materialises the public namespace with lowered tables when models use the postgres default coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [minimalModelArgs],
    });
    expect(Object.keys(contract.storage.namespaces).sort()).toEqual(['__unbound__', 'public']);
    const slot = contract.storage.namespaces['public']!;
    expect(slot).not.toBe(SqlUnboundNamespace.instance);
    expect(slot.id).toBe('public');
    expect(namespaceTables(slot)['app_user']).toBeDefined();
    expect(Object.keys(namespaceTables(contract.storage.namespaces['__unbound__']!))).toHaveLength(
      0,
    );
  });

  it('creates declared namespace slots (initially empty tables) alongside the public default coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      models: [minimalModelArgs],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth', 'public']);
    expect(Object.keys(namespaceTables(contract.storage.namespaces['auth']!))).toHaveLength(0);
    expect(namespaceTables(contract.storage.namespaces['public']!)['app_user']).toBeDefined();
  });

  it('places tables in the namespace referenced by the model coordinate', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        { ...minimalModelArgs, namespaceId: 'auth' },
        { ...minimalModelArgs, modelName: 'Post', tableName: 'blog_post' },
      ],
    });
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth', 'public']);
    expect(namespaceTables(contract.storage.namespaces['auth']!)['app_user']).toBeDefined();
    expect(namespaceTables(contract.storage.namespaces['public']!)['blog_post']).toBeDefined();
  });

  it('materialises an empty public namespace when no models are declared', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [],
    });
    expect(Object.keys(contract.storage.namespaces).sort()).toEqual(['__unbound__', 'public']);
    expect(contract.storage.namespaces['public']).not.toBe(SqlUnboundNamespace.instance);
    expect(Object.keys(namespaceTables(contract.storage.namespaces['public']!))).toHaveLength(0);
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
    const namespaceIds = Object.keys(contract.storage.namespaces).sort();
    expect(namespaceIds).toEqual(['__unbound__', 'auth', 'public']);
    expect(namespaceTables(contract.storage.namespaces['auth']!)['app_user']).toBeDefined();
  });
});
