import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  MigrationOperationClass,
  MigrationPlanOperation,
  OpFactoryCall,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  POSTGRES_ENUM_KIND,
  SqlStorage,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  controlPolicyAllowedOperationClasses,
  filterCallsByControlPolicy,
  type ResolvedControlSubject,
  resolveControlPolicyForSchemaIssue,
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

interface FakeCall extends OpFactoryCall {
  readonly subject?: ResolvedControlSubject;
}

function fakeCall(
  operationClass: MigrationOperationClass,
  subject?: ResolvedControlSubject,
): FakeCall {
  return {
    factoryName: 'fake',
    operationClass,
    label: 'fake',
    renderTypeScript: () => 'fake()',
    importRequirements: () => [],
    toOp: (): MigrationPlanOperation => ({ id: 'fake', label: 'fake', operationClass }),
    ...(subject !== undefined ? { subject } : {}),
  };
}

describe('controlPolicyAllowedOperationClasses', () => {
  it('allows every class for managed', () => {
    expect(controlPolicyAllowedOperationClasses('managed')).toEqual([
      'additive',
      'widening',
      'destructive',
      'data',
    ]);
  });

  it('allows only additive for tolerated', () => {
    expect(controlPolicyAllowedOperationClasses('tolerated')).toEqual(['additive']);
  });

  it('allows nothing for external or observed', () => {
    for (const policy of ['external', 'observed'] as const) {
      expect(controlPolicyAllowedOperationClasses(policy)).toEqual([]);
    }
  });
});

describe('resolveControlPolicyForSchemaIssue', () => {
  it('uses table control for column issues', () => {
    const contract = makeContract({
      users: {
        control: 'tolerated',
        columns: { id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false } },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const issue: SchemaIssue = {
      kind: 'type_mismatch',
      table: 'users',
      column: 'id',
      namespaceId: UNBOUND_NAMESPACE_ID,
      message: '',
    };
    expect(resolveControlPolicyForSchemaIssue(issue, contract)).toBe('tolerated');
  });

  it('reads enum entry control for type_missing', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('sha256:test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          tables: { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
          enum: {
            mood: {
              kind: POSTGRES_ENUM_KIND,
              name: 'mood',
              nativeType: 'mood',
              values: ['up', 'down'],
              codecId: 'pg/enum@1',
              control: 'external',
            },
          },
        }),
      },
    });
    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage,
      domain: applicationDomainOf({ models: {} }),
      roots: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };
    const issue: SchemaIssue = {
      kind: 'type_missing',
      typeName: 'mood',
      namespaceId: UNBOUND_NAMESPACE_ID,
      message: '',
    };
    expect(resolveControlPolicyForSchemaIssue(issue, contract)).toBe('external');
  });

  it('inherits defaultControl when the node omits control', () => {
    const contract = makeContract(
      { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      'tolerated',
    );
    const issue: SchemaIssue = {
      kind: 'type_mismatch',
      table: 'users',
      column: 'id',
      namespaceId: UNBOUND_NAMESPACE_ID,
      message: '',
    };
    expect(resolveControlPolicyForSchemaIssue(issue, contract)).toBe('tolerated');
  });
});

describe('filterCallsByControlPolicy', () => {
  const tableSubject = (control?: 'managed' | 'tolerated' | 'external' | 'observed') =>
    ({
      namespaceId: UNBOUND_NAMESPACE_ID,
      table: 'users',
      ...(control !== undefined ? { explicitNodeControlPolicy: control } : {}),
    }) satisfies ResolvedControlSubject;

  it('managed keeps every operation class', () => {
    const contract = makeContract({
      users: { control: 'managed', columns: {}, uniques: [], indexes: [], foreignKeys: [] },
    });
    const calls = [
      fakeCall('additive', tableSubject('managed')),
      fakeCall('destructive', tableSubject('managed')),
      fakeCall('widening', tableSubject('managed')),
    ];
    const kept = filterCallsByControlPolicy({
      calls,
      contract,
      resolveSubject: (c) => c.subject,
    });
    expect(kept).toHaveLength(3);
  });

  it('tolerated keeps only additive', () => {
    const contract = makeContract({
      users: { control: 'tolerated', columns: {}, uniques: [], indexes: [], foreignKeys: [] },
    });
    const calls = [
      fakeCall('additive', tableSubject('tolerated')),
      fakeCall('destructive', tableSubject('tolerated')),
      fakeCall('widening', tableSubject('tolerated')),
    ];
    const kept = filterCallsByControlPolicy({
      calls,
      contract,
      resolveSubject: (c) => c.subject,
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.operationClass).toBe('additive');
  });

  it('external and observed nodes keep nothing', () => {
    for (const control of ['external', 'observed'] as const) {
      const contract = makeContract({
        users: { control, columns: {}, uniques: [], indexes: [], foreignKeys: [] },
      });
      const calls = [
        fakeCall('additive', tableSubject(control)),
        fakeCall('destructive', tableSubject(control)),
      ];
      const kept = filterCallsByControlPolicy({
        calls,
        contract,
        resolveSubject: (c) => c.subject,
      });
      expect(kept).toHaveLength(0);
    }
  });

  it('external floor drops a managed-override op (the floor wins)', () => {
    const contract = makeContract(
      { users: { control: 'managed', columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      'external',
    );
    const calls = [fakeCall('additive', tableSubject('managed'))];
    const kept = filterCallsByControlPolicy({
      calls,
      contract,
      resolveSubject: (c) => c.subject,
    });
    expect(kept).toHaveLength(0);
  });

  it('external floor is fail-closed: unresolved-subject ops are dropped, not kept', () => {
    const contract = makeContract(
      { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      'external',
    );
    const calls = [fakeCall('additive', undefined)];
    const kept = filterCallsByControlPolicy({
      calls,
      contract,
      resolveSubject: (c) => c.subject,
    });
    expect(kept).toHaveLength(0);
  });

  it('keeps unresolved-subject ops when there is no external floor', () => {
    const contract = makeContract({
      users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] },
    });
    const calls = [fakeCall('additive', undefined)];
    const kept = filterCallsByControlPolicy({
      calls,
      contract,
      resolveSubject: (c) => c.subject,
    });
    expect(kept).toHaveLength(1);
  });
});
