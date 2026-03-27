import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type { MigrationOperationPolicy } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { buildReconciliationPlan } from '../../src/core/migrations/planner-reconciliation';
import type { PlanningMode } from '../../src/core/migrations/planner-types';

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const ADDITIVE_ONLY_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive'],
};

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

const FULL_MODE: PlanningMode = {
  includeExtraObjects: true,
  allowWidening: true,
  allowDestructive: true,
};

const ADDITIVE_MODE: PlanningMode = {
  includeExtraObjects: false,
  allowWidening: false,
  allowDestructive: false,
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function issue(
  overrides: Partial<SchemaIssue> & Pick<SchemaIssue, 'kind' | 'message'>,
): SchemaIssue {
  return overrides as SchemaIssue;
}

function emptyContract(): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:test'),
    profileHash: profileHash('sha256:test'),
    storage: { tables: {} },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

function contractWithColumn(
  table: string,
  column: string,
  nativeType: string,
  nullable = false,
): SqlContract<SqlStorage> {
  const contract = emptyContract();
  return {
    ...contract,
    storage: {
      tables: {
        [table]: {
          columns: {
            [column]: { nativeType, codecId: `pg/${nativeType}@1`, nullable },
          },
          primaryKey: { columns: [] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  };
}

function plan(
  issues: SchemaIssue[],
  options?: {
    contract?: SqlContract<SqlStorage>;
    mode?: PlanningMode;
    policy?: MigrationOperationPolicy;
    schemaName?: string;
  },
) {
  return buildReconciliationPlan({
    contract: options?.contract ?? emptyContract(),
    issues,
    schemaName: options?.schemaName ?? 'public',
    mode: options?.mode ?? FULL_MODE,
    policy: options?.policy ?? FULL_POLICY,
    codecHooks: new Map(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReconciliationPlan', () => {
  // =========================================================================
  // Destructive operations — drop
  // =========================================================================

  describe('destructive drop operations', () => {
    it('generates drop column for extra_column', () => {
      const result = plan([
        issue({ kind: 'extra_column', table: 'user', column: 'legacy', message: 'extra' }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'dropColumn.user.legacy',
        operationClass: 'destructive',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('DROP COLUMN');
      expect(result.conflicts).toHaveLength(0);
    });

    it('generates drop table for extra_table', () => {
      const result = plan([
        issue({ kind: 'extra_table', table: 'legacy_audit', message: 'extra' }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'dropTable.legacy_audit',
        operationClass: 'destructive',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('DROP TABLE');
    });

    it('generates drop index for extra_index', () => {
      const result = plan([
        issue({
          kind: 'extra_index',
          table: 'user',
          indexOrConstraint: 'idx_legacy',
          message: 'extra',
        }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'dropIndex.user.idx_legacy',
        operationClass: 'destructive',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('DROP INDEX');
    });

    it('generates drop constraint with foreignKey kind for extra_foreign_key', () => {
      const result = plan([
        issue({
          kind: 'extra_foreign_key',
          table: 'post',
          indexOrConstraint: 'fk_author',
          message: 'extra',
        }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'dropConstraint.post.fk_author',
        operationClass: 'destructive',
      });
      expect(result.operations[0]!.target.details!.objectType).toBe('foreignKey');
      expect(result.operations[0]!.execute[0]!.sql).toContain('DROP CONSTRAINT');
    });

    it('generates drop constraint with unique kind for extra_unique_constraint', () => {
      const result = plan([
        issue({
          kind: 'extra_unique_constraint',
          table: 'user',
          indexOrConstraint: 'uq_email',
          message: 'extra',
        }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]!.target.details!.objectType).toBe('unique');
    });

    it('generates drop constraint with primaryKey kind for extra_primary_key', () => {
      const result = plan([
        issue({
          kind: 'extra_primary_key',
          table: 'user',
          indexOrConstraint: 'user_pkey',
          message: 'extra',
        }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]!.target.details!.objectType).toBe('primaryKey');
    });

    it('uses default pkey name when indexOrConstraint is absent for extra_primary_key', () => {
      const result = plan([issue({ kind: 'extra_primary_key', table: 'user', message: 'extra' })]);

      expect(result.operations[0]).toMatchObject({
        id: 'dropConstraint.user.user_pkey',
      });
    });
  });

  // =========================================================================
  // Nullability operations
  // =========================================================================

  describe('nullability operations', () => {
    it('generates widening DROP NOT NULL when contract wants nullable (expected=true)', () => {
      const result = plan([
        issue({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'bio',
          expected: 'true',
          actual: 'false',
          message: 'nullability mismatch',
        }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'alterNullability.user.bio',
        operationClass: 'widening',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('DROP NOT NULL');
    });

    it('generates destructive SET NOT NULL when contract wants non-nullable (expected!=true)', () => {
      const result = plan([
        issue({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'false',
          actual: 'true',
          message: 'nullability mismatch',
        }),
      ]);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'alterNullability.user.email',
        operationClass: 'destructive',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('SET NOT NULL');
    });

    it('returns no operation for widening nullability when mode disallows widening', () => {
      const result = plan(
        [
          issue({
            kind: 'nullability_mismatch',
            table: 'user',
            column: 'bio',
            expected: 'true',
            message: 'mismatch',
          }),
        ],
        { mode: ADDITIVE_MODE, policy: ADDITIVE_ONLY_POLICY },
      );

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ kind: 'nullabilityConflict' });
    });
  });

  // =========================================================================
  // Type mismatch
  // =========================================================================

  describe('type mismatch operations', () => {
    it('generates ALTER COLUMN TYPE for type_mismatch when contract column exists', () => {
      const result = plan(
        [
          issue({
            kind: 'type_mismatch',
            table: 'user',
            column: 'age',
            expected: 'integer',
            actual: 'text',
            message: 'type mismatch',
          }),
        ],
        { contract: contractWithColumn('user', 'age', 'integer') },
      );

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'alterType.user.age',
        operationClass: 'destructive',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('TYPE');
      expect(result.operations[0]!.meta).toMatchObject({ warning: 'TABLE_REWRITE' });
    });

    it('returns conflict for type_mismatch when contract column not found', () => {
      const result = plan([
        issue({
          kind: 'type_mismatch',
          table: 'user',
          column: 'missing_col',
          expected: 'integer',
          actual: 'text',
          message: 'type mismatch',
        }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ kind: 'typeMismatch' });
    });
  });

  // =========================================================================
  // Additive issues are skipped
  // =========================================================================

  describe('additive issue filtering', () => {
    it('skips missing_table issues', () => {
      const result = plan([issue({ kind: 'missing_table', table: 'user', message: 'missing' })]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('skips missing_column issues', () => {
      const result = plan([
        issue({ kind: 'missing_column', table: 'user', column: 'name', message: 'missing' }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('skips dependency_missing issues', () => {
      const result = plan([issue({ kind: 'dependency_missing', message: 'missing' })]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('skips primary_key_mismatch when actual is undefined (additive)', () => {
      const result = plan([
        issue({ kind: 'primary_key_mismatch', table: 'user', message: 'pk missing' }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('skips unique_constraint_mismatch when indexOrConstraint is undefined (additive)', () => {
      const result = plan([
        issue({ kind: 'unique_constraint_mismatch', table: 'user', message: 'unique missing' }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  // =========================================================================
  // Policy enforcement
  // =========================================================================

  describe('policy enforcement', () => {
    it('converts destructive operation to conflict when policy forbids destructive', () => {
      const result = plan([issue({ kind: 'extra_table', table: 'legacy', message: 'extra' })], {
        policy: ADDITIVE_ONLY_POLICY,
      });

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ kind: 'missingButNonAdditive' });
    });

    it('converts widening operation to conflict when policy forbids widening', () => {
      const result = plan(
        [
          issue({
            kind: 'nullability_mismatch',
            table: 'user',
            column: 'bio',
            expected: 'true',
            message: 'mismatch',
          }),
        ],
        {
          mode: { includeExtraObjects: true, allowWidening: true, allowDestructive: false },
          policy: ADDITIVE_ONLY_POLICY,
        },
      );

      // Mode allows widening so the operation is built, but policy rejects it → conflict
      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  // =========================================================================
  // Deduplication
  // =========================================================================

  describe('deduplication', () => {
    it('deduplicates operations with the same id', () => {
      // extra_unique_constraint and extra_index on the same object can produce overlapping IDs
      // via dropConstraint; here we simulate two issues that map to the same operation id
      const result = plan([
        issue({
          kind: 'extra_foreign_key',
          table: 'post',
          indexOrConstraint: 'fk_author',
          message: 'extra fk',
        }),
        issue({
          kind: 'extra_foreign_key',
          table: 'post',
          indexOrConstraint: 'fk_author',
          message: 'duplicate fk',
        }),
      ]);

      // Only one operation, second is deduplicated
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]!.id).toBe('dropConstraint.post.fk_author');
    });
  });

  // =========================================================================
  // Conflict conversion for unhandled issue kinds
  // =========================================================================

  describe('conflict conversion', () => {
    it('converts default_mismatch to missingButNonAdditive conflict', () => {
      const result = plan([
        issue({
          kind: 'default_mismatch',
          table: 'user',
          column: 'status',
          expected: 'active',
          actual: 'pending',
          message: 'default mismatch',
        }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({
        kind: 'missingButNonAdditive',
        summary: 'default mismatch',
      });
    });

    it('converts foreign_key_mismatch (non-additive) to foreignKeyConflict', () => {
      const result = plan([
        issue({
          kind: 'foreign_key_mismatch',
          table: 'post',
          indexOrConstraint: 'fk_author',
          message: 'fk mismatch',
        }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ kind: 'foreignKeyConflict' });
    });

    it('includes location metadata in conflicts', () => {
      const result = plan(
        [
          issue({
            kind: 'extra_column',
            table: 'user',
            column: 'legacy',
            message: 'extra',
          }),
        ],
        { mode: ADDITIVE_MODE, policy: ADDITIVE_ONLY_POLICY },
      );

      expect(result.conflicts[0]).toMatchObject({
        location: { table: 'user', column: 'legacy' },
      });
    });

    it('includes expected/actual in conflict meta', () => {
      const result = plan([
        issue({
          kind: 'default_mismatch',
          table: 'user',
          column: 'status',
          expected: 'active',
          actual: 'pending',
          message: 'default mismatch',
        }),
      ]);

      expect(result.conflicts[0]!.meta).toMatchObject({
        expected: 'active',
        actual: 'pending',
      });
    });
  });

  // =========================================================================
  // Sorting
  // =========================================================================

  describe('deterministic output ordering', () => {
    it('keeps planner operation ordering without id resorting', () => {
      const result = plan([
        issue({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'bio',
          expected: 'true',
          message: 'mismatch',
        }),
        issue({ kind: 'extra_table', table: 'legacy_audit', message: 'extra' }),
      ]);

      expect(result.operations.map((op) => op.id)).toEqual([
        'dropTable.legacy_audit',
        'alterNullability.user.bio',
      ]);
    });
  });

  // =========================================================================
  // Empty input
  // =========================================================================

  it('returns empty operations and conflicts for no issues', () => {
    const result = plan([]);

    expect(result.operations).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });
});
