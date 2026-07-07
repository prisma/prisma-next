import type { StorageHashBase } from '@prisma-next/contract/types';
import { profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  CheckConstraint,
  SqlStorage,
  StorageTable,
  StorageValueSet,
} from '@prisma-next/sql-contract/types';
import { SqlCheckConstraintIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { collectSqlSchemaIssues } from '../src/core/diff/sql-schema-diff';
import { classifySqlVerifierIssueKind } from '../src/core/diff/verifier-disposition';
import { createSchemaTable, createTestSchemaIR } from './schema-verify.helpers';

function buildContractWithCheck(
  tableName: string,
  checkName: string,
  column: string,
  values: readonly string[],
) {
  const valueSetName = `${tableName}_${column}_values`;
  const ns = createTestSqlNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [tableName]: new StorageTable({
          columns: {
            [column]: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: [
            new CheckConstraint({
              name: checkName,
              column,
              valueSet: {
                plane: 'storage',
                entityKind: 'valueSet',
                namespaceId: UNBOUND_NAMESPACE_ID,
                entityName: valueSetName,
              },
            }),
          ],
        }),
      },
      valueSet: {
        [valueSetName]: new StorageValueSet({ kind: 'valueSet', values: values as string[] }),
      },
    },
  });

  return {
    target: 'postgres' as const,
    targetFamily: 'sql' as const,
    roots: {},
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: 'sha256:test' as StorageHashBase<string>,
      namespaces: { [UNBOUND_NAMESPACE_ID]: ns },
    }),
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    meta: {},
    extensionPacks: {},
  };
}

function buildContractWithoutChecks(tableName: string, column: string) {
  const ns = createTestSqlNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [tableName]: new StorageTable({
          columns: { [column]: { nativeType: 'text', codecId: 'pg/text@1', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      valueSet: {},
    },
  });
  return {
    target: 'postgres' as const,
    targetFamily: 'sql' as const,
    roots: {},
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: 'sha256:test' as StorageHashBase<string>,
      namespaces: { [UNBOUND_NAMESPACE_ID]: ns },
    }),
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    meta: {},
    extensionPacks: {},
  };
}

function schemaWithCheck(
  tableName: string,
  column: string,
  checkName: string,
  permittedValues: readonly string[],
) {
  return createTestSchemaIR({
    [tableName]: new SqlTableIR({
      ...createSchemaTable(tableName, { [column]: { nativeType: 'text', nullable: false } }),
      checks: [new SqlCheckConstraintIR({ name: checkName, column, permittedValues })],
    }),
  });
}

// ---------------------------------------------------------------------------
// collectSqlSchemaIssues — check constraint value-set comparison
// ---------------------------------------------------------------------------

describe('collectSqlSchemaIssues — check constraint value-set comparison', () => {
  it('emits no issues when contract and live checks match', () => {
    const contract = buildContractWithCheck('user', 'user_status_check', 'status', [
      'active',
      'inactive',
    ]);
    const schema = schemaWithCheck('user', 'status', 'user_status_check', ['active', 'inactive']);
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });
    expect(issues.filter((i) => i.kind.startsWith('check'))).toHaveLength(0);
  });

  it('emits check_missing when contract declares a check absent from the live schema', () => {
    const contract = buildContractWithCheck('user', 'user_status_check', 'status', [
      'active',
      'inactive',
    ]);
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { status: { nativeType: 'text', nullable: false } }),
    });
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'check_missing', table: 'user' }),
    );
  });

  it('emits check_mismatch when contract and live checks have different permitted values', () => {
    const contract = buildContractWithCheck('user', 'user_status_check', 'status', [
      'active',
      'inactive',
      'pending',
    ]);
    const schema = schemaWithCheck('user', 'status', 'user_status_check', ['active', 'inactive']);
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'check_mismatch', table: 'user' }),
    );
  });

  it('emits check_removed in strict mode when the contract declares no checks but the live schema has one', () => {
    const contract = buildContractWithoutChecks('post', 'status');
    const schema = schemaWithCheck('post', 'status', 'post_status_check', ['draft', 'published']);
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: true,
      frameworkComponents: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'check_removed', table: 'post' }),
    );
  });

  it('does not emit check_removed in non-strict mode for extra live checks', () => {
    const contract = buildContractWithoutChecks('post', 'status');
    const schema = schemaWithCheck('post', 'status', 'post_status_check', ['draft', 'published']);
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });
    expect(issues.filter((i) => i.kind.startsWith('check'))).toHaveLength(0);
  });

  it('compares value sets as unordered sets — different order does not mismatch', () => {
    const contract = buildContractWithCheck('account', 'role_check', 'role', [
      'admin',
      'user',
      'guest',
    ]);
    const schema = schemaWithCheck('account', 'role', 'role_check', ['guest', 'user', 'admin']);
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });
    expect(issues.filter((i) => i.kind.startsWith('check'))).toHaveLength(0);
  });

  it('emits check_mismatch when duplicate live values mask a missing contract value', () => {
    // Live schema: ['a','a'] — after deduplication that's just {'a'}.
    // Contract:    ['a','b'] — that's {'a','b'}.
    // The two sets differ, so this must mismatch.
    const contract = buildContractWithCheck('item', 'col_check', 'col', ['a', 'b']);
    const schema = schemaWithCheck('item', 'col', 'col_check', ['a', 'a']);
    const issues = collectSqlSchemaIssues({
      contract,
      schema,
      strict: false,
      frameworkComponents: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'check_mismatch', table: 'item' }),
    );
  });

  it('throws when a check references a value-set that is absent from the contract (malformed contract)', () => {
    // A well-formed contract always co-emits the value-set alongside the
    // check; this case indicates a broken emitter — it must error
    // consistently instead of silently resolving to an empty set.
    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          post: new StorageTable({
            columns: {
              status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            checks: [
              new CheckConstraint({
                name: 'post_status_check',
                column: 'status',
                valueSet: {
                  plane: 'storage',
                  entityKind: 'valueSet',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  entityName: 'post_status_values_DOES_NOT_EXIST',
                },
              }),
            ],
          }),
        },
        valueSet: {},
      },
    });
    const contract = {
      target: 'postgres' as const,
      targetFamily: 'sql' as const,
      roots: {},
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: 'sha256:test' as StorageHashBase<string>,
        namespaces: { [UNBOUND_NAMESPACE_ID]: ns },
      }),
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      meta: {},
      extensionPacks: {},
    };
    const schema = createTestSchemaIR({
      post: createSchemaTable('post', { status: { nativeType: 'text', nullable: false } }),
    });

    expect(() =>
      collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      }),
    ).toThrow('resolveValueSetValues');
  });
});

// ---------------------------------------------------------------------------
// classifySqlVerifierIssueKind — check constraint kinds
// ---------------------------------------------------------------------------

describe('classifySqlVerifierIssueKind — check constraint kinds', () => {
  it('classifies check_missing as declaredMissing', () => {
    expect(classifySqlVerifierIssueKind('check_missing')).toBe('declaredMissing');
  });

  it('classifies check_mismatch as valueDrift (symmetric with enum_values_changed)', () => {
    expect(classifySqlVerifierIssueKind('check_mismatch')).toBe('valueDrift');
  });

  it('classifies check_removed as extraAuxiliary', () => {
    expect(classifySqlVerifierIssueKind('check_removed')).toBe('extraAuxiliary');
  });
});
