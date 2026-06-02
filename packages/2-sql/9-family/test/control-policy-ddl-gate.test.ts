import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
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
  controlPolicyAllowsDdlIntent,
  resolveControlForSchemaIssue,
  schemaIssueDdlIntent,
  shouldEmitSchemaIssue,
} from '../src/core/migrations/control-policy-ddl-gate';

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

describe('schemaIssueDdlIntent', () => {
  it('classifies missing_table as create', () => {
    expect(schemaIssueDdlIntent({ kind: 'missing_table', table: 'u', message: '' })).toBe('create');
  });

  it('classifies extra_table as drop', () => {
    expect(schemaIssueDdlIntent({ kind: 'extra_table', table: 'u', message: '' })).toBe('drop');
  });

  it('classifies type_mismatch as alter', () => {
    expect(
      schemaIssueDdlIntent({
        kind: 'type_mismatch',
        table: 'u',
        column: 'c',
        message: '',
      }),
    ).toBe('alter');
  });
});

describe('controlPolicyAllowsDdlIntent', () => {
  it('allows all intents for managed', () => {
    expect(controlPolicyAllowsDdlIntent('managed', 'create')).toBe(true);
    expect(controlPolicyAllowsDdlIntent('managed', 'alter')).toBe(true);
    expect(controlPolicyAllowsDdlIntent('managed', 'drop')).toBe(true);
  });

  it('allows only create for tolerated', () => {
    expect(controlPolicyAllowsDdlIntent('tolerated', 'create')).toBe(true);
    expect(controlPolicyAllowsDdlIntent('tolerated', 'alter')).toBe(false);
    expect(controlPolicyAllowsDdlIntent('tolerated', 'drop')).toBe(false);
  });

  it('allows nothing for external or observed', () => {
    for (const policy of ['external', 'observed'] as const) {
      expect(controlPolicyAllowsDdlIntent(policy, 'create')).toBe(false);
      expect(controlPolicyAllowsDdlIntent(policy, 'alter')).toBe(false);
      expect(controlPolicyAllowsDdlIntent(policy, 'drop')).toBe(false);
    }
  });
});

describe('shouldEmitSchemaIssue', () => {
  const missingTable: SchemaIssue = {
    kind: 'missing_table',
    table: 'users',
    namespaceId: UNBOUND_NAMESPACE_ID,
    message: '',
  };
  const extraTable: SchemaIssue = {
    kind: 'extra_table',
    table: 'users',
    message: '',
  };
  const typeMismatch: SchemaIssue = {
    kind: 'type_mismatch',
    table: 'users',
    column: 'email',
    namespaceId: UNBOUND_NAMESPACE_ID,
    message: '',
  };

  it('emits create/alter/drop for managed table', () => {
    const contract = makeContract({
      users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] },
    });
    expect(shouldEmitSchemaIssue(missingTable, contract)).toBe(true);
    expect(shouldEmitSchemaIssue(extraTable, contract)).toBe(true);
    expect(shouldEmitSchemaIssue(typeMismatch, contract)).toBe(true);
  });

  it('emits create only for tolerated table', () => {
    const contract = makeContract({
      users: { control: 'tolerated', columns: {}, uniques: [], indexes: [], foreignKeys: [] },
    });
    expect(shouldEmitSchemaIssue(missingTable, contract)).toBe(true);
    expect(shouldEmitSchemaIssue(extraTable, contract)).toBe(false);
    expect(shouldEmitSchemaIssue(typeMismatch, contract)).toBe(false);
  });

  it('emits nothing for external or observed table', () => {
    for (const control of ['external', 'observed'] as const) {
      const contract = makeContract({
        users: { control, columns: {}, uniques: [], indexes: [], foreignKeys: [] },
      });
      expect(shouldEmitSchemaIssue(missingTable, contract)).toBe(false);
      expect(shouldEmitSchemaIssue(extraTable, contract)).toBe(false);
      expect(shouldEmitSchemaIssue(typeMismatch, contract)).toBe(false);
    }
  });

  it('inherits defaultControl when table omits control', () => {
    const toleratedDefault = makeContract(
      { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      'tolerated',
    );
    expect(shouldEmitSchemaIssue(missingTable, toleratedDefault)).toBe(true);
    expect(shouldEmitSchemaIssue(typeMismatch, toleratedDefault)).toBe(false);
  });
});

describe('resolveControlForSchemaIssue', () => {
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
    expect(resolveControlForSchemaIssue(issue, contract)).toBe('tolerated');
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
    expect(resolveControlForSchemaIssue(issue, contract)).toBe('external');
  });
});
