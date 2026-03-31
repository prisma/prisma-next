import type { ColumnDefault } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { MigrationOperationPolicy, SchemaIssue } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { PlanningMode } from '../../src/core/migrations/planner';
import { buildReconciliationPlan } from '../../src/core/migrations/planner-reconciliation';
import {
  buildExpectedFormatType,
  constraintExistsCheck,
} from '../../src/core/migrations/planner-sql';

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

function contractWithColumnDefault(
  table: string,
  column: string,
  nativeType: string,
  columnDefault: ColumnDefault,
  nullable = false,
): SqlContract<SqlStorage> {
  const contract = emptyContract();
  return {
    ...contract,
    storage: {
      tables: {
        [table]: {
          columns: {
            [column]: {
              nativeType,
              codecId: `pg/${nativeType}@1`,
              nullable,
              default: columnDefault,
            },
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

function contractWithTypeRef(
  table: string,
  column: string,
  nativeType: string,
  typeRef: string,
): SqlContract<SqlStorage> {
  const contract = emptyContract();
  return {
    ...contract,
    storage: {
      tables: {
        [table]: {
          columns: {
            [column]: { nativeType, codecId: 'pg/enum@1', nullable: false, typeRef },
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

    it('postcheck verifies column type, not just existence', () => {
      const result = plan(
        [
          issue({
            kind: 'type_mismatch',
            table: 'post',
            column: 'title',
            expected: 'int4',
            actual: 'text',
            message: 'type mismatch',
          }),
        ],
        { contract: contractWithColumn('post', 'title', 'int4') },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('format_type');
      expect(postcheckSql).toContain('integer');
      expect(postcheckSql).not.toBe(result.operations[0]!.precheck[0]!.sql);
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
  // Default operations — SET DEFAULT / ALTER DEFAULT
  // =========================================================================

  describe('column default operations', () => {
    it('generates additive SET DEFAULT for default_missing', () => {
      const contract = contractWithColumnDefault('user', 'bio', 'text', {
        kind: 'literal',
        value: 'no bio',
      });
      const result = plan(
        [
          issue({
            kind: 'default_missing',
            table: 'user',
            column: 'bio',
            expected: 'literal(no bio)',
            message: 'default missing',
          }),
        ],
        { contract },
      );

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'setDefault.user.bio',
        operationClass: 'additive',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('SET DEFAULT');
      expect(result.conflicts).toHaveLength(0);
    });

    it('generates widening SET DEFAULT for default_mismatch', () => {
      const contract = contractWithColumnDefault('user', 'status', 'text', {
        kind: 'literal',
        value: 'active',
      });
      const result = plan(
        [
          issue({
            kind: 'default_mismatch',
            table: 'user',
            column: 'status',
            expected: 'active',
            actual: 'pending',
            message: 'default mismatch',
          }),
        ],
        { contract },
      );

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        id: 'setDefault.user.status',
        operationClass: 'widening',
      });
      expect(result.operations[0]!.execute[0]!.sql).toContain('SET DEFAULT');
      expect(result.conflicts).toHaveLength(0);
    });

    it('generates SET DEFAULT with function expression for default_missing', () => {
      const contract = contractWithColumnDefault('user', 'created_at', 'timestamptz', {
        kind: 'function',
        expression: 'now()',
      });
      const result = plan(
        [
          issue({
            kind: 'default_missing',
            table: 'user',
            column: 'created_at',
            expected: 'now()',
            message: 'default missing',
          }),
        ],
        { contract },
      );

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]!.execute[0]!.sql).toContain('SET DEFAULT');
      expect(result.operations[0]!.execute[0]!.sql).toContain('now()');
    });

    it('returns conflict for default_missing when contract column not found', () => {
      const result = plan([
        issue({
          kind: 'default_missing',
          table: 'user',
          column: 'nonexistent',
          expected: 'literal(foo)',
          message: 'default missing',
        }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ kind: 'missingButNonAdditive' });
    });

    it('returns conflict for default_mismatch when contract column not found', () => {
      const result = plan([
        issue({
          kind: 'default_mismatch',
          table: 'user',
          column: 'nonexistent',
          expected: 'active',
          actual: 'pending',
          message: 'default mismatch',
        }),
      ]);

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ kind: 'missingButNonAdditive' });
    });

    it('throws when default_mismatch issue references a contract column with no default', () => {
      const contract = contractWithColumn('user', 'status', 'text');
      expect(() =>
        plan(
          [
            issue({
              kind: 'default_mismatch',
              table: 'user',
              column: 'status',
              expected: 'active',
              actual: 'pending',
              message: 'default mismatch',
            }),
          ],
          { contract },
        ),
      ).toThrow('default_mismatch issue for "user"."status" but contract column has no default');
    });

    it('converts default_missing to conflict when policy forbids additive', () => {
      const contract = contractWithColumnDefault('user', 'bio', 'text', {
        kind: 'literal',
        value: 'no bio',
      });
      const noAdditivePolicy: MigrationOperationPolicy = {
        allowedOperationClasses: ['widening', 'destructive'],
      };
      const result = plan(
        [
          issue({
            kind: 'default_missing',
            table: 'user',
            column: 'bio',
            expected: 'literal(no bio)',
            message: 'default missing',
          }),
        ],
        { contract, policy: noAdditivePolicy },
      );

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });

    it('converts default_mismatch to conflict when policy forbids widening', () => {
      const contract = contractWithColumnDefault('user', 'status', 'text', {
        kind: 'literal',
        value: 'active',
      });
      const result = plan(
        [
          issue({
            kind: 'default_mismatch',
            table: 'user',
            column: 'status',
            expected: 'active',
            actual: 'pending',
            message: 'default mismatch',
          }),
        ],
        { contract, policy: ADDITIVE_ONLY_POLICY },
      );

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });

    it('converts extra_default to conflict when policy forbids destructive', () => {
      const result = plan(
        [
          issue({
            kind: 'extra_default',
            table: 'user',
            column: 'status',
            actual: "'active'::text",
            message: 'extra default',
          }),
        ],
        { policy: ADDITIVE_ONLY_POLICY },
      );

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });

    it('default_missing postcheck verifies column has a default', () => {
      const contract = contractWithColumnDefault('user', 'bio', 'text', {
        kind: 'literal',
        value: 'no bio',
      });
      const result = plan(
        [
          issue({
            kind: 'default_missing',
            table: 'user',
            column: 'bio',
            expected: 'literal(no bio)',
            message: 'default missing',
          }),
        ],
        { contract },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('IS NOT NULL');
    });

    it('default_mismatch postcheck verifies column has a default', () => {
      const contract = contractWithColumnDefault('user', 'status', 'text', {
        kind: 'literal',
        value: 'active',
      });
      const result = plan(
        [
          issue({
            kind: 'default_mismatch',
            table: 'user',
            column: 'status',
            expected: 'literal(active)',
            actual: "'draft'::text",
            message: 'default mismatch',
          }),
        ],
        { contract },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('IS NOT NULL');
    });

    it('returns null (conflict) for default_missing with autoincrement default (TML-2107)', () => {
      const contract = contractWithColumnDefault('user', 'id', 'int4', {
        kind: 'function',
        expression: 'autoincrement()',
      });
      const result = plan(
        [
          issue({
            kind: 'default_missing',
            table: 'user',
            column: 'id',
            expected: 'function(autoincrement())',
            message: 'default missing',
          }),
        ],
        { contract },
      );

      expect(result.operations).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  // =========================================================================
  // Conflict conversion for unhandled issue kinds
  // =========================================================================

  describe('conflict conversion', () => {
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
  // P1-2: Temporal type mappings in FORMAT_TYPE_DISPLAY
  // =========================================================================

  describe('temporal type postcheck mappings', () => {
    it('postcheck for type_mismatch uses "timestamp without time zone" for timestamp', () => {
      const result = plan(
        [
          issue({
            kind: 'type_mismatch',
            table: 'event',
            column: 'created_at',
            expected: 'timestamp',
            actual: 'text',
            message: 'type mismatch',
          }),
        ],
        { contract: contractWithColumn('event', 'created_at', 'timestamp') },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('format_type');
      expect(postcheckSql).toContain('timestamp without time zone');
    });

    it('postcheck for type_mismatch uses "timestamp with time zone" for timestamptz', () => {
      const result = plan(
        [
          issue({
            kind: 'type_mismatch',
            table: 'event',
            column: 'created_at',
            expected: 'timestamptz',
            actual: 'text',
            message: 'type mismatch',
          }),
        ],
        { contract: contractWithColumn('event', 'created_at', 'timestamptz') },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('format_type');
      expect(postcheckSql).toContain('timestamp with time zone');
    });
  });

  // =========================================================================
  // P1-4: Mixed-case UDT names must be quoted for format_type comparison
  // =========================================================================

  describe('mixed-case user-defined type postcheck', () => {
    it('postcheck for type_mismatch quotes mixed-case typeRef names', () => {
      const result = plan(
        [
          issue({
            kind: 'type_mismatch',
            table: 'item',
            column: 'status',
            expected: 'StatusType',
            actual: 'text',
            message: 'type mismatch',
          }),
        ],
        { contract: contractWithTypeRef('item', 'status', 'StatusType', 'StatusType') },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('format_type');
      // format_type() returns double-quoted names for mixed-case types
      expect(postcheckSql).toContain('"StatusType"');
    });

    it('postcheck for type_mismatch does not quote lowercase typeRef names', () => {
      const result = plan(
        [
          issue({
            kind: 'type_mismatch',
            table: 'item',
            column: 'status',
            expected: 'status_type',
            actual: 'text',
            message: 'type mismatch',
          }),
        ],
        { contract: contractWithTypeRef('item', 'status', 'status_type', 'status_type') },
      );

      expect(result.operations).toHaveLength(1);
      const postcheckSql = result.operations[0]!.postcheck[0]!.sql;
      expect(postcheckSql).toContain('status_type');
      expect(postcheckSql).not.toContain('"status_type"');
    });
  });

  // =========================================================================
  // P2-1: constraintExistsCheck must be scoped to a specific table
  // =========================================================================

  describe('constraintExistsCheck table scoping', () => {
    it('generated SQL includes table filter', () => {
      const sql = constraintExistsCheck({
        constraintName: 'fk_user_id',
        schema: 'public',
        table: 'child',
      });

      // The check must filter by table (conrelid) to avoid matching
      // same-named constraints on different tables
      expect(sql).toContain('conrelid');
    });
  });

  // =========================================================================
  // Helper function unit tests
  // =========================================================================

  describe('buildExpectedFormatType', () => {
    it('maps timestamp to "timestamp without time zone"', () => {
      const result = buildExpectedFormatType(
        { nativeType: 'timestamp', codecId: 'pg/timestamp@1', nullable: false },
        new Map(),
      );
      expect(result).toBe('timestamp without time zone');
    });

    it('maps timestamptz to "timestamp with time zone"', () => {
      const result = buildExpectedFormatType(
        { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: false },
        new Map(),
      );
      expect(result).toBe('timestamp with time zone');
    });

    it('maps time to "time without time zone"', () => {
      const result = buildExpectedFormatType(
        { nativeType: 'time', codecId: 'pg/time@1', nullable: false },
        new Map(),
      );
      expect(result).toBe('time without time zone');
    });

    it('maps timetz to "time with time zone"', () => {
      const result = buildExpectedFormatType(
        { nativeType: 'timetz', codecId: 'pg/timetz@1', nullable: false },
        new Map(),
      );
      expect(result).toBe('time with time zone');
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
