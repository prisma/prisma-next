/**
 * Tests for planner semantic satisfaction behavior.
 *
 * These tests verify that the planner correctly handles semantic satisfaction:
 * - Unique indexes can satisfy unique constraint requirements
 * - Unique indexes/constraints can satisfy non-unique index requirements
 * - Name differences do not cause operations to be emitted
 */

import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@prisma-next/sql-contract/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { PostgresSchemaIR, postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

describe('PostgresMigrationPlanner - semantic satisfaction', () => {
  const planner = createPostgresMigrationPlanner(
    new PostgresControlAdapter(createPostgresBuiltinCodecLookup()),
  );

  describe('unique constraint requirements', () => {
    it('does not emit unique operation when satisfied by unique index', () => {
      const contract = createTestContract({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [],
          foreignKeys: [],
        },
      });

      const schema = new PostgresSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }],
          },
        },
        pgSchemaName: 'public',
        pgVersion: '',
        rlsPolicies: [],
        roles: [],
        existingSchemas: [],
        nativeEnumTypeNames: [],
      });

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      expect(result.plan.operations).toHaveLength(0);
    });
  });

  describe('index requirements', () => {
    it('does not emit index operation when satisfied by unique index', () => {
      const contract = createTestContract({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['email'] }],
          foreignKeys: [],
        },
      });

      const schema = new PostgresSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }],
          },
        },
        pgSchemaName: 'public',
        pgVersion: '',
        rlsPolicies: [],
        roles: [],
        existingSchemas: [],
        nativeEnumTypeNames: [],
      });

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      expect(result.plan.operations).toHaveLength(0);
    });

    it('does not emit index operation when satisfied by unique constraint', () => {
      const contract = createTestContract({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [{ columns: ['email'] }],
          foreignKeys: [],
        },
      });

      const schema = new PostgresSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'user_email_key' }],
            foreignKeys: [],
            indexes: [],
          },
        },
        pgSchemaName: 'public',
        pgVersion: '',
        rlsPolicies: [],
        roles: [],
        existingSchemas: [],
        nativeEnumTypeNames: [],
      });

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      expect(result.plan.operations).toHaveLength(0);
    });
  });

  describe('name mismatches', () => {
    it('succeeds with no operations when only constraint/index names differ', () => {
      const contract = createTestContract({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'], name: 'user_pk' },
          uniques: [{ columns: ['email'], name: 'user_email_unique' }],
          indexes: [{ columns: ['email'], name: 'user_email_index' }],
          foreignKeys: [],
        },
      });

      const schema = new PostgresSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'], name: 'user_pkey' },
            uniques: [{ columns: ['email'], name: 'user_email_key' }],
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: false, name: 'user_email_idx' }],
          },
        },
        pgSchemaName: 'public',
        pgVersion: '',
        rlsPolicies: [],
        roles: [],
        existingSchemas: [],
        nativeEnumTypeNames: [],
      });

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      expect(result.plan.operations).toHaveLength(0);
    });
  });
});

function createTestContract(tables: Record<string, StorageTableInput> = {}): Contract<SqlStorage> {
  const unboundNs = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: tables },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:contract'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}
