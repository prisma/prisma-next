/**
 * AC3 — planner emits correct REFERENCES DDL for cross-space FKs (M3a.2).
 *
 * Audit result: `buildForeignKeySql` (planner-ddl-builders.ts) is **dead on
 * the hot path** — it is exported but has no production caller. The live path
 * is issue-planner → AddForeignKeyCall → addForeignKey() → renderForeignKeySql()
 * which reads fk.references.schema (the target namespace) and is correct.
 *
 * These tests pin the correct path's output for both qualified (named target
 * namespace) and unqualified (__unbound__ target namespace) cross-space FKs,
 * and add a local-FK regression guard.
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { buildSqlNamespace, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

const emptySchema: SqlSchemaIR = { tables: {} };

/**
 * Build a contract with a Profile table in the unbound (public) namespace
 * that has a FK to a target in the given namespace and table. This simulates
 * the post-M3a.1 world where the aggregate loader has already resolved
 * the cross-space FK's tableName to the real value ('users').
 */
function buildCrossSpaceFkContract(targetNamespaceId: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:cross-space-fk-ddl'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:cross-space-fk-ddl'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              profile: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  user_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'profile',
                      columns: ['user_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(targetNamespaceId),
                      tableName: 'users',
                      columns: ['id'],
                      spaceId: 'supabase',
                    },
                    constraint: true,
                    index: false,
                  },
                ],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

/**
 * Build a contract with a local (same-namespace) FK from post.user_id → user.id.
 * Used as a regression guard — local-FK DDL must be unchanged after M3a.2.
 */
function buildLocalFkContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:local-fk-regression'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:local-fk-regression'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                  user_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'post',
                      columns: ['user_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                      tableName: 'user',
                      columns: ['id'],
                    },
                    constraint: true,
                    index: false,
                  },
                ],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function planAndGetFkExecuteSql(contract: Contract<SqlStorage>): string {
  const planner = createPostgresMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
  });

  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('Expected success');

  const fkOp = result.plan.operations.find((op) => op.id.startsWith('foreignKey.'));
  expect(fkOp).toBeDefined();

  return fkOp!.execute[0]!.sql;
}

describe('PostgresMigrationPlanner — cross-space FK REFERENCES DDL (AC3)', () => {
  it('emits qualified REFERENCES "auth"."users"("id") for a named target namespace', () => {
    const sql = planAndGetFkExecuteSql(buildCrossSpaceFkContract('auth'));
    expect(sql).toContain('REFERENCES "auth"."users" ("id")');
  });

  it('emits unqualified REFERENCES "users"("id") for an __unbound__ target namespace', () => {
    const sql = planAndGetFkExecuteSql(buildCrossSpaceFkContract(UNBOUND_NAMESPACE_ID));
    expect(sql).toContain('REFERENCES "users" ("id")');
    expect(sql).not.toContain('"__unbound__"');
  });

  it('regression: local same-namespace FK emits correct unqualified REFERENCES', () => {
    const sql = planAndGetFkExecuteSql(buildLocalFkContract());
    expect(sql).toContain('ALTER TABLE "post"');
    expect(sql).toContain('FOREIGN KEY ("user_id")');
    expect(sql).toContain('REFERENCES "user" ("id")');
    expect(sql).not.toContain('"__unbound__"');
  });
});
