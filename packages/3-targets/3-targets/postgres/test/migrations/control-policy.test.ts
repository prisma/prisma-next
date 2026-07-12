import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { resolvePostgresNodeIssueControlPolicySubject } from '../../src/core/migrations/control-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../../src/core/schema-ir/schema-node-kinds';

/**
 * `resolvePostgresNodeIssueControlPolicySubject` resolves a table and a
 * native enum through the SAME generic `postgresNodeStorageCoordinate`
 * branch — no per-kind (table vs enum) special-casing. These tests pin that
 * a create issue for each kind produces an identically-shaped subject
 * differing only in `entityKind`/`entityName`, and that a dropped
 * (`not-expected`) enum now resolves its subject namespace the same way a
 * dropped table always has: to `UNBOUND_NAMESPACE_ID`, since neither is
 * claimed by any contract namespace.
 */

const MEMBERS = ['draft', 'review', 'done'] as const;

function makeContract(): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'sales',
    entries: {
      table: {
        orders: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      native_enum: {
        order_status: {
          kind: 'postgres-enum',
          typeName: 'order_status',
          members: [...MEMBERS],
        },
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:control-policy-subject-test'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('sha256:control-policy-subject-test'),
      namespaces: { sales: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function tableNode(name: string): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function enumNode(typeName: string, members: readonly string[]): PostgresNativeEnumSchemaNode {
  return new PostgresNativeEnumSchemaNode({ typeName, namespaceId: 'sales', members });
}

describe('resolvePostgresNodeIssueControlPolicySubject — generic entity coordinate', () => {
  const contract = makeContract();

  it('a table create issue and a native-enum create issue resolve the same shape, differing only in entityKind/entityName', () => {
    const tableIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'orders'],
      reason: 'not-found',
      expected: tableNode('orders'),
    };
    const enumIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'native_enum:order_status'],
      reason: 'not-found',
      expected: enumNode('order_status', MEMBERS),
    };

    expect(resolvePostgresNodeIssueControlPolicySubject(tableIssue, contract)).toEqual({
      namespaceId: 'sales',
      entityKind: 'table',
      entityName: 'orders',
      createsNewObject: true,
    });
    expect(resolvePostgresNodeIssueControlPolicySubject(enumIssue, contract)).toEqual({
      namespaceId: 'sales',
      entityKind: 'native_enum',
      entityName: 'order_status',
      createsNewObject: true,
    });
  });

  it('a dropped (not-expected) enum resolves namespaceId to UNBOUND, matching a dropped table', () => {
    const droppedEnumIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'native_enum:stray_mood'],
      reason: 'not-expected',
      actual: enumNode('stray_mood', ['happy', 'sad']),
    };
    const droppedTableIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'orphan'],
      reason: 'not-expected',
      actual: tableNode('orphan'),
    };

    // Enum drops now resolve like table drops: neither is claimed by any
    // contract namespace, so both fall back to UNBOUND_NAMESPACE_ID.
    expect(resolvePostgresNodeIssueControlPolicySubject(droppedEnumIssue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'native_enum',
      entityName: 'stray_mood',
      createsNewObject: false,
    });
    expect(resolvePostgresNodeIssueControlPolicySubject(droppedTableIssue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'table',
      entityName: 'orphan',
      createsNewObject: false,
    });
  });
});
