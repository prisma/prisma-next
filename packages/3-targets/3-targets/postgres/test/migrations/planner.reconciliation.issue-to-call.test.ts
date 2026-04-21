/**
 * Class-flow level coverage for `buildReconciliationPlan`:
 *
 * Asserts the *call subclass* and the *literal args* emitted per
 * `SchemaIssue` kind, without lowering to runtime ops. The sibling
 * `planner.reconciliation-unit.test.ts` validates the runtime-op shape
 * after `renderOps(...)`; this file pins the IR one step earlier so a
 * regression in reconciliation (wrong subclass, wrong constructor args,
 * wrong `operationClass` for widening vs additive defaults) is caught
 * where the decision is actually made.
 */

import {
  type ColumnDefault,
  type Contract,
  coreHash,
  profileHash,
} from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  AlterColumnTypeCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  SetDefaultCall,
  SetNotNullCall,
} from '../../src/core/migrations/op-factory-call';
import { buildReconciliationPlan } from '../../src/core/migrations/planner-reconciliation';
import type { PlanningMode } from '../../src/core/migrations/planner-target-details';

const FULL_MODE: PlanningMode = {
  includeExtraObjects: true,
  allowWidening: true,
  allowDestructive: true,
};

const FULL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function issue(
  overrides: Partial<SchemaIssue> & Pick<SchemaIssue, 'kind' | 'message'>,
): SchemaIssue {
  return overrides as SchemaIssue;
}

function emptyContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: { storageHash: coreHash('sha256:test'), tables: {} },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function contractWithColumn(
  table: string,
  column: string,
  nativeType: string,
  nullable = false,
): Contract<SqlStorage> {
  return {
    ...emptyContract(),
    storage: {
      storageHash: coreHash('sha256:test'),
      tables: {
        [table]: {
          columns: { [column]: { nativeType, codecId: `pg/${nativeType}@1`, nullable } },
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
): Contract<SqlStorage> {
  return {
    ...emptyContract(),
    storage: {
      storageHash: coreHash('sha256:test'),
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

function planCalls(
  issues: SchemaIssue[],
  options?: {
    contract?: Contract<SqlStorage>;
    mode?: PlanningMode;
  },
) {
  return buildReconciliationPlan({
    contract: options?.contract ?? emptyContract(),
    issues,
    schemaName: 'public',
    mode: options?.mode ?? FULL_MODE,
    policy: FULL_POLICY,
    codecHooks: new Map(),
  });
}

describe('buildReconciliationPlan — issue → call mapping', () => {
  describe('destructive drops emit the matching Drop* call with literal args', () => {
    it('extra_table → DropTableCall(schema, table)', () => {
      const { operations } = planCalls([
        issue({ kind: 'extra_table', table: 'legacy', message: 'extra' }),
      ]);

      expect(operations).toHaveLength(1);
      const call = operations[0];
      expect(call).toBeInstanceOf(DropTableCall);
      expect(call).toMatchObject({
        factoryName: 'dropTable',
        operationClass: 'destructive',
        schemaName: 'public',
        tableName: 'legacy',
      });
    });

    it('extra_column → DropColumnCall(schema, table, column)', () => {
      const { operations } = planCalls([
        issue({ kind: 'extra_column', table: 'user', column: 'legacy', message: 'extra' }),
      ]);

      expect(operations).toHaveLength(1);
      expect(operations[0]).toBeInstanceOf(DropColumnCall);
      expect(operations[0]).toMatchObject({
        factoryName: 'dropColumn',
        schemaName: 'public',
        tableName: 'user',
        columnName: 'legacy',
      });
    });

    it('extra_index → DropIndexCall(schema, table, indexName)', () => {
      const { operations } = planCalls([
        issue({
          kind: 'extra_index',
          table: 'user',
          indexOrConstraint: 'idx_legacy',
          message: 'extra',
        }),
      ]);

      expect(operations).toHaveLength(1);
      expect(operations[0]).toBeInstanceOf(DropIndexCall);
      expect(operations[0]).toMatchObject({
        factoryName: 'dropIndex',
        schemaName: 'public',
        tableName: 'user',
        indexName: 'idx_legacy',
      });
    });

    it('extra_foreign_key → DropConstraintCall(..., kind: foreignKey)', () => {
      const { operations } = planCalls([
        issue({
          kind: 'extra_foreign_key',
          table: 'post',
          indexOrConstraint: 'fk_author',
          message: 'extra',
        }),
      ]);

      expect(operations[0]).toBeInstanceOf(DropConstraintCall);
      expect(operations[0]).toMatchObject({
        schemaName: 'public',
        tableName: 'post',
        constraintName: 'fk_author',
        kind: 'foreignKey',
      });
    });

    it('extra_unique_constraint → DropConstraintCall(..., kind: unique)', () => {
      const { operations } = planCalls([
        issue({
          kind: 'extra_unique_constraint',
          table: 'user',
          indexOrConstraint: 'uq_email',
          message: 'extra',
        }),
      ]);

      expect(operations[0]).toBeInstanceOf(DropConstraintCall);
      expect(operations[0]).toMatchObject({
        constraintName: 'uq_email',
        kind: 'unique',
      });
    });

    it('extra_primary_key → DropConstraintCall(..., kind: primaryKey) using supplied name', () => {
      const { operations } = planCalls([
        issue({
          kind: 'extra_primary_key',
          table: 'user',
          indexOrConstraint: 'user_pkey',
          message: 'extra',
        }),
      ]);

      expect(operations[0]).toBeInstanceOf(DropConstraintCall);
      expect(operations[0]).toMatchObject({
        constraintName: 'user_pkey',
        kind: 'primaryKey',
      });
    });

    it('extra_primary_key without indexOrConstraint falls back to <table>_pkey', () => {
      const { operations } = planCalls([
        issue({ kind: 'extra_primary_key', table: 'user', message: 'extra' }),
      ]);

      expect(operations[0]).toMatchObject({
        factoryName: 'dropConstraint',
        constraintName: 'user_pkey',
        kind: 'primaryKey',
      });
    });

    it('extra_default → DropDefaultCall(schema, table, column)', () => {
      const { operations } = planCalls([
        issue({
          kind: 'extra_default',
          table: 'user',
          column: 'created_at',
          message: 'extra',
        }),
      ]);

      expect(operations[0]).toBeInstanceOf(DropDefaultCall);
      expect(operations[0]).toMatchObject({
        schemaName: 'public',
        tableName: 'user',
        columnName: 'created_at',
      });
    });
  });

  describe('nullability_mismatch branches on direction', () => {
    it('contract-wants-nullable + DB NOT NULL → DropNotNullCall (widening)', () => {
      const { operations } = planCalls([
        issue({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'true',
          actual: 'false',
          message: 'nullable mismatch',
        }),
      ]);

      expect(operations[0]).toBeInstanceOf(DropNotNullCall);
      expect(operations[0]).toMatchObject({
        operationClass: 'widening',
        schemaName: 'public',
        tableName: 'user',
        columnName: 'email',
      });
    });

    it('contract-wants-NOT-NULL + DB nullable → SetNotNullCall (destructive)', () => {
      const { operations } = planCalls([
        issue({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'false',
          actual: 'true',
          message: 'nullable mismatch',
        }),
      ]);

      expect(operations[0]).toBeInstanceOf(SetNotNullCall);
      expect(operations[0]).toMatchObject({
        operationClass: 'destructive',
        schemaName: 'public',
        tableName: 'user',
        columnName: 'email',
      });
    });
  });

  describe('type_mismatch builds an AlterColumnTypeCall with buildColumnTypeSql output', () => {
    it('carries qualifiedTargetType + formatTypeExpected + label from the contract column', () => {
      const contract = contractWithColumn('user', 'age', 'integer');
      const { operations } = planCalls(
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
        { contract },
      );

      expect(operations[0]).toBeInstanceOf(AlterColumnTypeCall);
      const call = operations[0] as AlterColumnTypeCall;
      expect(call).toMatchObject({
        schemaName: 'public',
        tableName: 'user',
        columnName: 'age',
        operationClass: 'destructive',
      });
      expect(call.options.qualifiedTargetType).toBe('integer');
      expect(call.options.formatTypeExpected).toBe('integer');
      expect(call.options.rawTargetTypeForLabel).toBe('integer');
    });
  });

  describe('default_missing vs default_mismatch map to SetDefaultCall with distinct operationClass', () => {
    const literalDefault: ColumnDefault = { kind: 'literal', value: 42 };

    it('default_missing → SetDefaultCall with operationClass additive', () => {
      const contract = contractWithColumnDefault('user', 'tier', 'integer', literalDefault);
      const { operations } = planCalls(
        [
          issue({
            kind: 'default_missing',
            table: 'user',
            column: 'tier',
            message: 'default missing',
          }),
        ],
        { contract },
      );

      expect(operations[0]).toBeInstanceOf(SetDefaultCall);
      expect(operations[0]).toMatchObject({
        operationClass: 'additive',
        schemaName: 'public',
        tableName: 'user',
        columnName: 'tier',
      });
      const call = operations[0] as SetDefaultCall;
      expect(call.defaultSql).toContain('DEFAULT');
    });

    it('default_mismatch → SetDefaultCall with operationClass widening', () => {
      const contract = contractWithColumnDefault('user', 'tier', 'integer', literalDefault);
      const { operations } = planCalls(
        [
          issue({
            kind: 'default_mismatch',
            table: 'user',
            column: 'tier',
            expected: '42',
            actual: '0',
            message: 'default mismatch',
          }),
        ],
        { contract },
      );

      expect(operations[0]).toBeInstanceOf(SetDefaultCall);
      expect(operations[0]).toMatchObject({
        operationClass: 'widening',
        columnName: 'tier',
      });
    });
  });

  describe('mode gates', () => {
    const READ_ONLY_MODE: PlanningMode = {
      includeExtraObjects: false,
      allowWidening: false,
      allowDestructive: false,
    };

    it('destructive issues produce no calls when allowDestructive is false', () => {
      const { operations, conflicts } = planCalls(
        [issue({ kind: 'extra_table', table: 'legacy', message: 'extra' })],
        { mode: READ_ONLY_MODE },
      );

      expect(operations).toEqual([]);
      expect(conflicts).toHaveLength(1);
    });

    it('widening nullability produces no calls when allowWidening is false', () => {
      const { operations, conflicts } = planCalls(
        [
          issue({
            kind: 'nullability_mismatch',
            table: 'user',
            column: 'email',
            expected: 'true',
            actual: 'false',
            message: 'nullable mismatch',
          }),
        ],
        { mode: READ_ONLY_MODE },
      );

      expect(operations).toEqual([]);
      expect(conflicts).toHaveLength(1);
    });
  });
});
