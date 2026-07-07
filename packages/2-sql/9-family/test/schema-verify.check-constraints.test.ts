import type { StorageHashBase } from '@prisma-next/contract/types';
import { profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
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
import { verifySqlSchema } from '../src/core/diff/sql-schema-diff';
import { classifySqlVerifierIssueKind } from '../src/core/diff/verifier-disposition';
import { verifyCheckConstraints } from '../src/core/diff/verify-helpers';
import {
  createSchemaTable,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

// ---------------------------------------------------------------------------
// verifyCheckConstraints unit tests
// ---------------------------------------------------------------------------

function makeContractCheck(name: string, column: string, permittedValues: readonly string[]) {
  return { name, column, permittedValues };
}

function makeSchemaCheck(
  name: string,
  column: string,
  permittedValues: readonly string[],
): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({ name, column, permittedValues });
}

describe('verifyCheckConstraints', () => {
  it('emits no issues when contract and live checks match', () => {
    const issues: SchemaIssue[] = [];
    const nodes = verifyCheckConstraints(
      [makeContractCheck('user_status_check', 'status', ['active', 'inactive'])],
      [makeSchemaCheck('user_status_check', 'status', ['active', 'inactive'])],
      'user',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[user]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(0);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.status).toBe('pass');
  });

  it('emits check_missing when contract declares a check absent from the live schema', () => {
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [makeContractCheck('user_status_check', 'status', ['active', 'inactive'])],
      [],
      'user',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[user]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'check_missing', table: 'user' });
  });

  it('emits check_mismatch when contract and live checks have different permitted values', () => {
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [makeContractCheck('user_status_check', 'status', ['active', 'inactive', 'pending'])],
      [makeSchemaCheck('user_status_check', 'status', ['active', 'inactive'])],
      'user',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[user]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'check_mismatch', table: 'user' });
  });

  it('emits check_removed in strict mode when a live check is absent from the contract', () => {
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [],
      [makeSchemaCheck('user_status_check', 'status', ['active', 'inactive'])],
      'user',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[user]',
      'managed',
      issues,
      true,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'check_removed', table: 'user' });
  });

  it('does not emit check_removed in non-strict mode for extra live checks', () => {
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [],
      [makeSchemaCheck('user_status_check', 'status', ['active', 'inactive'])],
      'user',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[user]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(0);
  });

  it('compares value sets as unordered sets — different order does not mismatch', () => {
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [makeContractCheck('role_check', 'role', ['admin', 'user', 'guest'])],
      [makeSchemaCheck('role_check', 'role', ['guest', 'user', 'admin'])],
      'account',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[account]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(0);
  });

  it('emits check_mismatch when duplicate live values mask a missing contract value', () => {
    // Live schema: ['a','a'] — after deduplication that's just {'a'}.
    // Contract:    ['a','b'] — that's {'a','b'}.
    // The two sets differ, so this must mismatch.
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [makeContractCheck('col_check', 'col', ['a', 'b'])],
      [makeSchemaCheck('col_check', 'col', ['a', 'a'])],
      'item',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[item]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'check_mismatch', table: 'item' });
  });

  it('normalization: IN ("a","b") vs = ANY (ARRAY["a","b"]) compare equal at the value-set level', () => {
    // Contract carries resolved string values; adapter parses Postgres-rewritten
    // predicate into the same values. Comparison is on sets, not SQL strings.
    const issues: SchemaIssue[] = [];
    verifyCheckConstraints(
      [makeContractCheck('status_check', 'status', ['active', 'inactive'])],
      [makeSchemaCheck('status_check', 'status', ['active', 'inactive'])],
      'post',
      UNBOUND_NAMESPACE_ID,
      'namespaces[__unbound__].tables[post]',
      'managed',
      issues,
      false,
    );
    expect(issues).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// verifySqlSchema integration — check constraint wiring
// ---------------------------------------------------------------------------

describe('verifySqlSchema — check constraints', () => {
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

  it('passes when check constraint matches', () => {
    const contract = buildContractWithCheck('post', 'post_status_check', 'status', [
      'draft',
      'published',
    ]);
    const schema = createTestSchemaIR({
      post: new SqlTableIR({
        ...createSchemaTable('post', { status: { nativeType: 'text', nullable: false } }),
        checks: [
          new SqlCheckConstraintIR({
            name: 'post_status_check',
            column: 'status',
            permittedValues: ['draft', 'published'],
          }),
        ],
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues.filter((i) => i.kind.startsWith('check'))).toHaveLength(0);
  });

  it('emits check_missing when check is in contract but absent from live schema', () => {
    const contract = buildContractWithCheck('post', 'post_status_check', 'status', [
      'draft',
      'published',
    ]);
    const schema = createTestSchemaIR({
      post: createSchemaTable('post', { status: { nativeType: 'text', nullable: false } }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'check_missing', table: 'post' }),
    );
  });

  it('emits check_removed in strict mode when the contract declares no checks but the live schema has one', () => {
    // Contract has zero checks for the table. In strict mode the extra live
    // CHECK must be flagged as check_removed. The old guard
    // `if (contractTable.checks && contractTable.checks.length > 0)` skipped
    // verifyCheckConstraints entirely in this case, so the issue was never emitted.
    const ns = createTestSqlNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          post: new StorageTable({
            columns: { status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
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
      post: new SqlTableIR({
        ...createSchemaTable('post', { status: { nativeType: 'text', nullable: false } }),
        checks: [
          new SqlCheckConstraintIR({
            name: 'post_status_check',
            column: 'status',
            permittedValues: ['draft', 'published'],
          }),
        ],
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: true,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'check_removed', table: 'post' }),
    );
  });

  it('throws when a check references a value-set that is absent from the contract (malformed contract)', () => {
    // Build a contract where the check's valueSet ref points to a name that
    // does not exist in the namespace. A well-formed contract always
    // co-emits the value-set alongside the check; this case indicates a
    // broken emitter — it must error consistently instead of silently
    // resolving to an empty set.
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
      verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      }),
    ).toThrow('resolveValueSetValues');
  });
});
