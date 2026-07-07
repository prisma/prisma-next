/**
 * Postgres migration planner.
 *
 * Takes schema issues (from collectSqlSchemaIssues) and emits migration IR
 * (`PostgresOpFactoryCall[]`). Strategies consume issues they recognize and
 * produce specialized call sequences (e.g. NOT NULL backfill →
 * addColumn(nullable) + dataTransform + setNotNull); remaining issues flow
 * through `mapIssueToCall` for the default case.
 */

import type { Contract, JsonValue } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@prisma-next/family-sql/control';
import { arraysEqual } from '@prisma-next/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaDiffIssue, SchemaIssue } from '@prisma-next/framework-components/control';
import type {
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { CodecRef, DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import * as contractFree from '@prisma-next/sql-relational-core/contract-free';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlForeignKeyIR,
  type SqlIndexIR,
  SqlSchemaIR,
  type SqlSchemaIRNode,
  type SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import type { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import { quoteIdentifier } from '../sql-utils';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateIndexCall,
  CreateSchemaCall,
  CreateTableCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  type PostgresOpFactoryCall,
  postgresDefaultToDdlColumnDefault,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import type { ForeignKeySpec } from './operations/shared';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { buildExpectedFormatType } from './planner-sql-checks';
import {
  type CallMigrationStrategy,
  type NodeCallMigrationStrategy,
  postgresNodePlannerStrategies,
  postgresPlannerStrategies,
  resolveDdlSchemaForNamespace,
  resolveNamespaceIdForIssue,
  type StrategyContext,
  tableAt,
} from './planner-strategies';
import { resolveColumnTypeMetadata } from './planner-type-resolution';
import { columnOpRenderOf } from './postgres-column-op-render';

export type { CallMigrationStrategy, StrategyContext };

/**
 * Deterministic name for the element-non-null CHECK constraint on a scalar-array
 * column. Distinct `_elem_not_null` suffix avoids collision with the enum
 * value-set `_check` constraints. Re-emitting the same schema produces the same
 * name, so `pg_get_constraintdef`-based verify sees no drift.
 */
function elementNonNullCheckName(tableName: string, columnName: string): string {
  return `${tableName}_${columnName}_elem_not_null`;
}

/**
 * Predicate enforcing that a scalar-array column carries no NULL element. The
 * array column itself may be NULL (container nullability is the column's NOT NULL
 * clause); `array_position` over a NULL array yields NULL, which a CHECK treats
 * as satisfied, so a nullable array column is unaffected.
 */
function elementNonNullCheckExpression(columnName: string): string {
  return `array_position(${quoteIdentifier(columnName)}, NULL) IS NULL`;
}

// ============================================================================
// Issue kind ordering (dependency order)
// ============================================================================

const ISSUE_KIND_ORDER: Record<string, number> = {
  // Schemas first — the database container must exist before any DDL
  // that targets it can run.
  missing_schema: 1,

  // Types next
  type_missing: 2,
  type_values_mismatch: 3,
  enum_values_changed: 3,

  // Drops (reconciliation — clear the way for creates)
  // FKs dropped first (they depend on other constraints)
  extra_foreign_key: 10,
  extra_unique_constraint: 11,
  extra_primary_key: 12,
  extra_index: 13,
  extra_default: 14,
  extra_column: 15,
  extra_table: 16,

  // Tables before columns
  missing_table: 20,

  // Columns before constraints
  missing_column: 30,

  // Reconciliation alters (on existing objects)
  type_mismatch: 40,
  nullability_mismatch: 41,
  default_missing: 42,
  default_mismatch: 43,

  // Constraints after columns exist
  primary_key_mismatch: 50,
  unique_constraint_mismatch: 51,
  index_mismatch: 52,
  foreign_key_mismatch: 60,

  // Check constraints
  check_missing: 53,
  check_mismatch: 54,
  check_removed: 55,
};

function issueOrder(issue: SchemaIssue): number {
  return ISSUE_KIND_ORDER[issue.kind] ?? 99;
}

// ============================================================================
// Conflict helpers
// ============================================================================

function issueConflict(
  kind: SqlPlannerConflict['kind'],
  summary: string,
  location?: SqlPlannerConflict['location'],
): SqlPlannerConflict {
  return {
    kind,
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function isMissing(issue: SchemaIssue): boolean {
  if (issue.kind === 'enum_values_changed') return false;
  return issue.actual === undefined;
}

// ============================================================================
// Issue planner
// ============================================================================

export interface IssuePlannerOptions {
  readonly issues: readonly SchemaIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  /**
   * Current database schema IR. Strategies read this to detect whether a
   * structure already exists (e.g. `buildSchemaLookupMap` for shared-temp-
   * default safety, extension dependency checks). Defaults to an empty schema
   * when omitted so the planner can still run over "fresh DB" contract
   * snapshots.
   */
  readonly schema?: SqlSchemaIR;
  /**
   * Operation-class policy. `planIssues` filters calls whose `operationClass`
   * is not in `policy.allowedOperationClasses` and surfaces them as conflicts
   * instead of emitting disallowed DDL. Defaults to additive-only.
   */
  readonly policy?: MigrationOperationPolicy;
  /**
   * Framework components participating in this composition. Available to
   * future strategies that may consult component metadata at plan time.
   */
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly strategies?: readonly CallMigrationStrategy[];
}

export interface IssuePlannerValue {
  readonly calls: readonly PostgresOpFactoryCall[];
}

export function toDdlColumn(
  name: string,
  column: StorageColumn,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
): DdlColumn {
  const typeSql = buildColumnTypeSql(column, codecHooks, storageTypes);
  const ddlDefault = postgresDefaultToDdlColumnDefault(column.default);
  const resolved = resolveColumnTypeMetadata(
    column,
    storageTypes as Record<string, StorageTypeInstance>,
  );
  const codecRef: CodecRef | undefined = resolved.codecId
    ? {
        codecId: resolved.codecId,
        ...(resolved.typeParams !== undefined
          ? {
              typeParams: blindCast<
                JsonValue,
                'resolved.typeParams is JsonValue-shaped storage metadata; the narrowed (non-undefined) value lands in CodecRef.typeParams which is JsonValue'
              >(resolved.typeParams),
            }
          : {}),
      }
    : undefined;
  return contractFree.col(name, typeSql, {
    ...(!column.nullable ? { notNull: true } : {}),
    ...ifDefined('default', ddlDefault),
    ...ifDefined('codecRef', codecRef),
  });
}

function mapIssueToCall(
  issue: SchemaIssue,
  ctx: StrategyContext,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  const { schemaName, codecHooks, storageTypes } = ctx;
  // Per-table effective schema. `extra_table` issues intentionally
  // omit `namespaceId` — the live DB carries a table that
  // is not claimed by any contract namespace, so there is no contract
  // coordinate to project from. Those issues fall back to the planner's
  // global `ctx.schemaName`; every other issue dispatches through the
  // resolved namespace's polymorphic `ddlSchemaName`.
  const tableSchema = (issue: SchemaIssue): string => {
    if (issue.kind === 'extra_table') return schemaName;
    if (!('table' in issue) || !issue.table) return schemaName;
    return resolveDdlSchemaForNamespace(ctx, resolveNamespaceIdForIssue(issue));
  };

  switch (issue.kind) {
    case 'missing_schema': {
      const namespaceId = issue.namespaceId;
      if (!namespaceId)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing schema issue has no namespaceId'),
        );
      const ddlSchemaName = resolveDdlSchemaForNamespace(ctx, namespaceId);
      return ok([new CreateSchemaCall(ddlSchemaName)]);
    }

    case 'missing_table': {
      if (!issue.table)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing table issue has no table name'),
        );
      const namespaceId = resolveNamespaceIdForIssue(issue);
      const contractTable = tableAt(ctx.toContract.storage, namespaceId, issue.table);
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" in namespace "${namespaceId}" reported missing but not found in destination contract`,
          ),
        );
      }
      const schemaForTable = tableSchema(issue);
      const missingTableName = issue.table;
      const ddlColumns: DdlColumn[] = Object.entries(contractTable.columns).map(([name, column]) =>
        toDdlColumn(name, column, codecHooks, storageTypes),
      );
      const primaryKeyConstraints: DdlTableConstraint[] = contractTable.primaryKey
        ? [
            contractFree.primaryKey(contractTable.primaryKey.columns, {
              ...(contractTable.primaryKey.name ? { name: contractTable.primaryKey.name } : {}),
            }),
          ]
        : [];
      const elementNonNullChecks: DdlTableConstraint[] = Object.entries(contractTable.columns)
        .filter(([, column]) => column.many === true)
        .map(([columnName]) =>
          contractFree.checkExpression(
            elementNonNullCheckName(missingTableName, columnName),
            elementNonNullCheckExpression(columnName),
          ),
        );
      const allTableConstraints = [...primaryKeyConstraints, ...elementNonNullChecks];
      const ddlConstraints: DdlTableConstraint[] | undefined =
        allTableConstraints.length > 0 ? allTableConstraints : undefined;
      const calls: PostgresOpFactoryCall[] = [
        new CreateTableCall(schemaForTable, issue.table, ddlColumns, ddlConstraints),
      ];
      for (const index of contractTable.indexes) {
        const indexName = index.name ?? `${issue.table}_${index.columns.join('_')}_idx`;
        const extras: { type?: string; options?: Record<string, unknown> } = {};
        if (index.type !== undefined) extras.type = index.type;
        if (index.options !== undefined) extras.options = index.options;
        calls.push(
          new CreateIndexCall(schemaForTable, issue.table, indexName, [...index.columns], extras),
        );
      }
      const explicitIndexColumnSets = new Set(
        contractTable.indexes.map((idx) => idx.columns.join(',')),
      );
      for (const fk of contractTable.foreignKeys) {
        if (fk.constraint) {
          const fkName = fk.name ?? `${issue.table}_${fk.source.columns.join('_')}_fkey`;
          const fkSpec: ForeignKeySpec = {
            name: fkName,
            columns: fk.source.columns,
            references: {
              schema: fk.target.namespaceId,
              table: fk.target.tableName,
              columns: fk.target.columns,
            },
            ...(fk.onDelete !== undefined && { onDelete: fk.onDelete }),
            ...(fk.onUpdate !== undefined && { onUpdate: fk.onUpdate }),
          };
          calls.push(new AddForeignKeyCall(schemaForTable, issue.table, fkSpec));
        }
        if (fk.index && !explicitIndexColumnSets.has(fk.source.columns.join(','))) {
          const indexName = `${issue.table}_${fk.source.columns.join('_')}_idx`;
          calls.push(
            new CreateIndexCall(schemaForTable, issue.table, indexName, [...fk.source.columns]),
          );
        }
      }
      for (const unique of contractTable.uniques) {
        const constraintName = unique.name ?? `${issue.table}_${unique.columns.join('_')}_key`;
        calls.push(
          new AddUniqueCall(schemaForTable, issue.table, constraintName, [...unique.columns]),
        );
      }
      return ok(calls);
    }

    case 'missing_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing column issue has no table/column name'),
        );
      {
        const namespaceId = resolveNamespaceIdForIssue(issue);
        const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[
          issue.column
        ];
        if (!column)
          return notOk(
            issueConflict(
              'unsupportedOperation',
              `Column "${issue.table}"."${issue.column}" not in destination contract`,
            ),
          );
        return ok([
          new AddColumnCall(
            tableSchema(issue),
            issue.table,
            toDdlColumn(issue.column, column, codecHooks, storageTypes),
          ),
        ]);
      }

    case 'default_missing':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default missing issue has no table/column name'),
        );
      {
        const namespaceId = resolveNamespaceIdForIssue(issue);
        const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[
          issue.column
        ];
        if (!column?.default) {
          return notOk(
            issueConflict(
              'unsupportedOperation',
              `Column "${issue.table}"."${issue.column}" has no default in contract`,
            ),
          );
        }
        const defaultSql = buildColumnDefaultSql(column.default, column);
        if (!defaultSql) return ok([]);
        return ok([new SetDefaultCall(tableSchema(issue), issue.table, issue.column, defaultSql)]);
      }

    case 'extra_table':
      if (!issue.table)
        return notOk(issueConflict('unsupportedOperation', 'Extra table issue has no table name'));
      return ok([new DropTableCall(tableSchema(issue), issue.table)]);

    case 'extra_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra column issue has no table/column name'),
        );
      return ok([new DropColumnCall(tableSchema(issue), issue.table, issue.column)]);

    case 'extra_index':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra index issue has no table/index name'),
        );
      return ok([new DropIndexCall(tableSchema(issue), issue.table, issue.indexOrConstraint)]);

    case 'extra_unique_constraint':
    case 'extra_foreign_key':
    case 'extra_primary_key': {
      if (!issue.table)
        return notOk(
          issueConflict(
            'unsupportedOperation',
            'Extra constraint issue has no table/constraint name',
          ),
        );
      // `extra_primary_key` issues don't carry a constraint name — the
      // verifier only has the table. Fall back to `<table>_pkey`, matching
      // Postgres' default PK constraint naming and the old reconciliation
      // planner's behavior.
      const constraintName =
        issue.indexOrConstraint ??
        (issue.kind === 'extra_primary_key' ? `${issue.table}_pkey` : undefined);
      if (!constraintName)
        return notOk(
          issueConflict(
            'unsupportedOperation',
            'Extra constraint issue has no table/constraint name',
          ),
        );
      const kindMap = {
        extra_unique_constraint: 'unique' as const,
        extra_foreign_key: 'foreignKey' as const,
        extra_primary_key: 'primaryKey' as const,
      };
      return ok([
        new DropConstraintCall(
          tableSchema(issue),
          issue.table,
          constraintName,
          kindMap[issue.kind],
        ),
      ]);
    }

    case 'extra_default':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra default issue has no table/column name'),
        );
      return ok([new DropDefaultCall(tableSchema(issue), issue.table, issue.column)]);

    case 'nullability_mismatch': {
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('nullabilityConflict', 'Nullability mismatch has no table/column name'),
        );
      const namespaceId = resolveNamespaceIdForIssue(issue);
      const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[
        issue.column
      ];
      if (!column)
        return notOk(
          issueConflict(
            'nullabilityConflict',
            `Column "${issue.table}"."${issue.column}" not found in destination contract`,
          ),
        );
      const schemaForTable = tableSchema(issue);
      return ok(
        column.nullable
          ? [new DropNotNullCall(schemaForTable, issue.table, issue.column)]
          : [new SetNotNullCall(schemaForTable, issue.table, issue.column)],
      );
    }

    case 'type_mismatch':
      if (!issue.table || !issue.column)
        return notOk(issueConflict('typeMismatch', 'Type mismatch has no table/column name'));
      {
        const namespaceId = resolveNamespaceIdForIssue(issue);
        const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[
          issue.column
        ];
        if (!column)
          return notOk(
            issueConflict(
              'typeMismatch',
              `Column "${issue.table}"."${issue.column}" not in destination contract`,
            ),
          );
        const hooksMap = codecHooks as Map<string, CodecControlHooks>;
        const typesMap = storageTypes as Record<string, StorageTypeInstance>;
        const qualifiedTargetType = buildColumnTypeSql(column, hooksMap, typesMap, false);
        const formatTypeExpected = buildExpectedFormatType(column, hooksMap, typesMap);
        return ok([
          new AlterColumnTypeCall(tableSchema(issue), issue.table, issue.column, {
            qualifiedTargetType,
            formatTypeExpected,
            rawTargetTypeForLabel: qualifiedTargetType,
          }),
        ]);
      }

    case 'default_mismatch':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default mismatch has no table/column name'),
        );
      {
        const namespaceId = resolveNamespaceIdForIssue(issue);
        const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[
          issue.column
        ];
        if (!column?.default) return ok([]);
        const defaultSql = buildColumnDefaultSql(column.default, column);
        if (!defaultSql) return ok([]);
        return ok([
          new SetDefaultCall(tableSchema(issue), issue.table, issue.column, defaultSql, 'widening'),
        ]);
      }

    case 'primary_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('indexIncompatible', 'Primary key issue has no table name'));
      if (isMissing(issue)) {
        const namespaceId = resolveNamespaceIdForIssue(issue);
        const pk = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.primaryKey;
        if (!pk)
          return notOk(
            issueConflict('indexIncompatible', `No primary key in contract for "${issue.table}"`),
          );
        const constraintName = pk.name ?? `${issue.table}_pkey`;
        return ok([
          new AddPrimaryKeyCall(tableSchema(issue), issue.table, constraintName, pk.columns),
        ]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Primary key on "${issue.table}" has different columns (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'unique_constraint_mismatch':
      if (!issue.table)
        return notOk(
          issueConflict('indexIncompatible', 'Unique constraint issue has no table name'),
        );
      if (isMissing(issue) && issue.expected) {
        const columns = issue.expected.split(', ');
        const constraintName = `${issue.table}_${columns.join('_')}_key`;
        return ok([new AddUniqueCall(tableSchema(issue), issue.table, constraintName, columns)]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Unique constraint on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'index_mismatch':
      if (!issue.table)
        return notOk(issueConflict('indexIncompatible', 'Index issue has no table name'));
      if (isMissing(issue) && issue.expected) {
        const namespaceId = resolveNamespaceIdForIssue(issue);
        const columns = issue.expected.split(', ');
        const contractIndex = tableAt(
          ctx.toContract.storage,
          namespaceId,
          issue.table,
        )?.indexes.find((idx: StorageTable['indexes'][number]) =>
          arraysEqual(idx.columns, columns),
        );
        const indexName = contractIndex?.name ?? `${issue.table}_${columns.join('_')}_idx`;
        const extras: { type?: string; options?: Record<string, unknown> } = {};
        if (contractIndex?.type !== undefined) extras.type = contractIndex.type;
        if (contractIndex?.options !== undefined) extras.options = contractIndex.options;
        return ok([
          new CreateIndexCall(tableSchema(issue), issue.table, indexName, columns, extras),
        ]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Index on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'check_missing': {
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict('unsupportedOperation', 'Check missing issue has no table/constraint name'),
        );
      // check_missing is normally consumed by checkConstraintPlanCallStrategy.
      // This case handles any that arrive here (e.g. in tests that invoke
      // mapIssueToCall directly or skip the strategy).
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Check constraint "${issue.indexOrConstraint}" missing on "${issue.table}" — handled by checkConstraintPlanCallStrategy`,
        ),
      );
    }

    case 'check_mismatch': {
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict(
            'unsupportedOperation',
            'Check mismatch issue has no table/constraint name',
          ),
        );
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Check constraint "${issue.indexOrConstraint}" values mismatch on "${issue.table}" — handled by checkConstraintPlanCallStrategy`,
        ),
      );
    }

    case 'check_removed': {
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict('unsupportedOperation', 'Check removed issue has no table/constraint name'),
        );
      return ok([
        new DropCheckConstraintCall(tableSchema(issue), issue.table, issue.indexOrConstraint),
      ]);
    }

    case 'foreign_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('foreignKeyConflict', 'Foreign key issue has no table name'));
      if (isMissing(issue) && issue.expected) {
        const arrowIdx = issue.expected.indexOf(' -> ');
        if (arrowIdx >= 0) {
          const namespaceId = resolveNamespaceIdForIssue(issue);
          const columns = issue.expected.slice(0, arrowIdx).split(', ');
          const fkName = `${issue.table}_${columns.join('_')}_fkey`;
          const fk = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.foreignKeys.find(
            (k) => k.source.columns.join(', ') === columns.join(', '),
          );
          if (fk) {
            const fkSpec: ForeignKeySpec = {
              name: fkName,
              columns: fk.source.columns,
              references: {
                schema: fk.target.namespaceId,
                table: fk.target.tableName,
                columns: fk.target.columns,
              },
              ...(fk.onDelete !== undefined && { onDelete: fk.onDelete }),
              ...(fk.onUpdate !== undefined && { onUpdate: fk.onUpdate }),
            };
            return ok([new AddForeignKeyCall(tableSchema(issue), issue.table, fkSpec)]);
          }
          return notOk(
            issueConflict(
              'foreignKeyConflict',
              `Foreign key on "${issue.table}" (${columns.join(', ')}) not found in destination contract`,
              { table: issue.table },
            ),
          );
        }
      }
      return notOk(
        issueConflict(
          'foreignKeyConflict',
          `Foreign key on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'type_missing': {
      if (!issue.typeName)
        return notOk(issueConflict('unsupportedOperation', 'Type missing issue has no typeName'));
      const typeInstance = ctx.toContract.storage.types?.[issue.typeName];
      if (!typeInstance) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Type "${issue.typeName}" reported missing but not found in destination contract`,
          ),
        );
      }
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Type "${issue.typeName}" uses codec "${typeInstance.codecId}" — only value-set types are supported`,
        ),
      );
    }

    case 'type_values_mismatch':
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Type "${issue.typeName ?? 'unknown'}" values differ — type alteration not yet supported`,
        ),
      );

    default:
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Unhandled issue kind: ${(issue as SchemaIssue).kind}`,
        ),
      );
  }
}

/**
 * Classifies calls into dependency order categories for correct DDL sequencing.
 */
type CallCategory =
  | 'dep'
  | 'drop'
  | 'table'
  | 'rlsEnable'
  | 'rlsPolicy'
  | 'column'
  | 'alter'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey';

/**
 * Classifies calls into DDL sequencing buckets. The order matches the
 * legacy walk-schema planner's emission order so `db init` and `db update`
 * produce byte-identical plans for the shared shape (deps → drops → tables
 * → columns → alters → PKs → uniques → indexes → FKs).
 */
function classifyCall(call: PostgresOpFactoryCall): CallCategory {
  switch (call.factoryName) {
    case 'createExtension':
    case 'createSchema':
      return 'dep';
    case 'dropTable':
    case 'dropColumn':
    case 'dropConstraint':
    case 'dropCheckConstraint':
    case 'dropIndex':
    case 'dropDefault':
      return 'drop';
    case 'addCheckConstraint':
      return 'unique'; // after uniques, before indexes
    case 'createTable':
      return 'table';
    case 'enableRowLevelSecurity':
      return 'rlsEnable';
    case 'createRlsPolicy':
      return 'rlsPolicy';
    case 'dropRlsPolicy':
      return 'drop';
    case 'addColumn':
      return 'column';
    case 'alterColumnType':
    case 'setNotNull':
    case 'dropNotNull':
    case 'setDefault':
      return 'alter';
    case 'addPrimaryKey':
      return 'primaryKey';
    case 'addUnique':
      return 'unique';
    case 'createIndex':
      return 'index';
    case 'addForeignKey':
      return 'foreignKey';
    case 'rawSql': {
      // Type ops lifted through `RawSqlCall` by `storageTypePlanCallStrategy`
      // to preserve the codec-emitted label and precheck/postcheck.
      // Classification falls back to inspecting the underlying op's target
      // details (`objectType: 'type'`).
      const op = (
        call as {
          op?: {
            target?: { details?: { objectType?: string } };
          };
        }
      ).op;
      const objectType = op?.target?.details?.objectType;
      if (objectType === 'type') return 'dep';
      return 'alter';
    }
    default:
      return 'alter';
  }
}

/** Stable lexical key used to order issues within the same kind bucket. */
function issueKey(issue: SchemaIssue): string {
  const table = 'table' in issue && typeof issue.table === 'string' ? issue.table : '';
  const column = 'column' in issue && typeof issue.column === 'string' ? issue.column : '';
  const name =
    'indexOrConstraint' in issue && typeof issue.indexOrConstraint === 'string'
      ? issue.indexOrConstraint
      : '';
  return `${table}\u0000${column}\u0000${name}`;
}

// When no policy is explicitly supplied (test-only path; production callers
// always pass one), allow every class so strategies that gate on
// `'data'` (data-safe placeholders) still fire — the test is treated as
// trusted. Filtering of actual emitted calls only runs when a policy was
// explicitly provided (see `policyProvided` below).
const DEFAULT_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function emptySchemaIR(): SqlSchemaIR {
  return new SqlSchemaIR({ tables: {} });
}

function conflictKindForCall(call: PostgresOpFactoryCall): SqlPlannerConflict['kind'] {
  switch (call.factoryName) {
    case 'alterColumnType':
      return 'typeMismatch';
    case 'setNotNull':
    case 'dropNotNull':
      return 'nullabilityConflict';
    case 'addForeignKey':
    case 'dropConstraint':
      return 'foreignKeyConflict';
    case 'createIndex':
    case 'dropIndex':
      return 'indexIncompatible';
    default:
      return 'missingButNonAdditive';
  }
}

function locationForCall(call: PostgresOpFactoryCall): SqlPlannerConflict['location'] | undefined {
  // Most Postgres call classes expose `tableName`/`columnName`/`indexName`/
  // `constraintName` as readonly fields. We avoid `toOp()` here because a
  // `DataTransformCall` intentionally throws from `toOp`.
  const anyCall = call as unknown as {
    tableName?: string;
    columnName?: string;
    indexName?: string;
    constraintName?: string;
    typeName?: string;
  };
  const location: {
    table?: string;
    column?: string;
    index?: string;
    constraint?: string;
    type?: string;
  } = {};
  if (anyCall.tableName) location.table = anyCall.tableName;
  if (anyCall.columnName) location.column = anyCall.columnName;
  if (anyCall.indexName) location.index = anyCall.indexName;
  if (anyCall.constraintName) location.constraint = anyCall.constraintName;
  if (anyCall.typeName) location.type = anyCall.typeName;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}

function conflictForDisallowedCall(
  call: PostgresOpFactoryCall,
  allowed: readonly string[],
): SqlPlannerConflict {
  const summary = `Operation "${call.label}" requires class "${call.operationClass}", but policy allows only: ${allowed.join(', ')}`;
  const location = locationForCall(call);
  return {
    kind: conflictKindForCall(call),
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

export function planIssues(
  options: IssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  // When no policy is supplied, `planIssues` treats the call as trusted (the
  // caller — typically a test — has already vetted the issues). Only explicit
  // policies gate operation classes into conflicts.
  // `PostgresMigrationPlanner` always passes an explicit policy.
  const policyProvided = options.policy !== undefined;
  const policy = options.policy ?? DEFAULT_POLICY;
  const schema = options.schema ?? emptySchemaIR();
  const frameworkComponents = options.frameworkComponents ?? [];

  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    schemaName: options.schemaName,
    codecHooks: options.codecHooks,
    storageTypes: options.storageTypes,
    schema,
    policy,
    frameworkComponents,
  };

  const strategies = options.strategies ?? postgresPlannerStrategies;

  let remaining = options.issues;
  const recipeCalls: PostgresOpFactoryCall[] = [];
  const bucketablePatternCalls: PostgresOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      if (result.recipe) {
        recipeCalls.push(...result.calls);
      } else {
        bucketablePatternCalls.push(...result.calls);
      }
    }
  }

  const sorted = [...remaining].sort((a, b) => {
    const kindDelta = issueOrder(a) - issueOrder(b);
    if (kindDelta !== 0) return kindDelta;
    const keyA = issueKey(a);
    const keyB = issueKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const defaultCalls: PostgresOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapIssueToCall(issue, context);
    if (result.ok) {
      defaultCalls.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  // Policy gating: drop calls whose operation class is not allowed and
  // surface a conflict describing the disallowed op. Applies to both strategy
  // output and default-mapped output. Only active when the caller explicitly
  // supplied a policy — direct unit-test invocations (which pass no policy)
  // stay as pass-through and keep destructive recipe steps intact.
  const allowed = policy.allowedOperationClasses;
  let gatedDefault = defaultCalls;
  let gatedRecipe = recipeCalls;
  let gatedBucketable = bucketablePatternCalls;
  if (policyProvided) {
    const keepIfAllowed = (bucket: PostgresOpFactoryCall[]) => (call: PostgresOpFactoryCall) => {
      if (allowed.includes(call.operationClass)) {
        bucket.push(call);
        return;
      }
      conflicts.push(conflictForDisallowedCall(call, allowed));
    };
    const gatedDefaultBucket: PostgresOpFactoryCall[] = [];
    const gatedRecipeBucket: PostgresOpFactoryCall[] = [];
    const gatedBucketableBucket: PostgresOpFactoryCall[] = [];
    defaultCalls.forEach(keepIfAllowed(gatedDefaultBucket));
    recipeCalls.forEach(keepIfAllowed(gatedRecipeBucket));
    bucketablePatternCalls.forEach(keepIfAllowed(gatedBucketableBucket));
    gatedDefault = gatedDefaultBucket;
    gatedRecipe = gatedRecipeBucket;
    gatedBucketable = gatedBucketableBucket;
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  // Recipe strategies (`notNullBackfillCallStrategy`,
  // `nullableTighteningCallStrategy`, etc.) emit a cohesive sequence that must
  // stay contiguous. They are inserted at a single pattern slot. Non-recipe
  // pattern strategies (`checkConstraintPlanCallStrategy`,
  // `storageTypePlanCallStrategy`, `notNullAddColumnCallStrategy`) produce
  // individually classifiable calls that slot into DDL buckets alongside
  // default-mapped calls.
  const combinedBucketable = [...gatedDefault, ...gatedBucketable];
  const byCategory = (cat: CallCategory) =>
    combinedBucketable.filter((c) => classifyCall(c) === cat);

  const calls: PostgresOpFactoryCall[] = [
    ...byCategory('dep'),
    ...byCategory('drop'),
    ...byCategory('table'),
    ...byCategory('column'),
    ...gatedRecipe,
    ...byCategory('alter'),
    ...byCategory('primaryKey'),
    ...byCategory('unique'),
    ...byCategory('index'),
    ...byCategory('foreignKey'),
  ];

  return ok({ calls });
}

// ============================================================================
// Node-based issue planner (the one differ path — additive, wired in the flip)
// ============================================================================
//
// The node planner consumes node-typed `SchemaDiffIssue`s (from the one differ
// — `buildPostgresPlanDiff`) and reads the diff node each issue carries
// (`issue.expected` / `issue.actual`) plus the derivation-stamped `opRender`
// payload for column DDL. It never reads the contract for STRUCTURAL op-render
// (column type/default SQL is relocated to `opRender`). The retained subsystems
// — codec type-operations, field-lifecycle hooks, the NOT-NULL temp-default
// deferred DDL, control-policy disposition — keep the contract via the strategy
// context, per the slice's scope.

/** The diff node an issue concerns — expected when present, else the actual (extra) node. */
function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a Postgres schema diff tree is a SqlSchemaIRNode; nodeKind is its required discriminant'
  >(node);
}

/** DDL schema segment of a table-or-descendant issue path: `[database, ddlSchema, table, …]`. */
function issueSchemaName(issue: SchemaDiffIssue): string | undefined {
  return issue.path[1];
}

/** Table segment of a table-or-descendant issue path: `[database, ddlSchema, table, …]`. */
function issueTableName(issue: SchemaDiffIssue): string | undefined {
  return issue.path[2];
}

/** Column name embedded in a column/default issue path segment (`column:<name>`). */
function issueColumnName(issue: SchemaDiffIssue): string | undefined {
  const segment = issue.path[3];
  if (segment === undefined || !segment.startsWith('column:')) return undefined;
  return segment.slice('column:'.length);
}

/** Whether the expected/actual native type (resolved, or raw+many fallback) differs — mirrors `SqlColumnIR.isEqualTo`'s type comparison. */
export function columnTypeChanged(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  if (expected.resolvedNativeType !== undefined && actual.resolvedNativeType !== undefined) {
    return expected.resolvedNativeType !== actual.resolvedNativeType;
  }
  return (
    expected.nativeType !== actual.nativeType || Boolean(expected.many) !== Boolean(actual.many)
  );
}

// ----------------------------------------------------------------------------
// Node-keyed issue ordering (re-keys ISSUE_KIND_ORDER on nodeKind + reason)
// ----------------------------------------------------------------------------

/**
 * Re-keys the legacy `ISSUE_KIND_ORDER` on `(nodeKind, reason)`, numbers
 * preserved so the dependency intent stays legible. Final emission order is
 * fixed downstream by `classifyCall` bucketing (dep → drop → table → column →
 * recipe → alter → primaryKey → unique → index → foreignKey), so this only
 * breaks ties within a bucket.
 */
export function nodeIssueOrder(issue: SchemaDiffIssue): number {
  const node = issueNode(issue);
  if (node === undefined) return 99;
  switch (node.nodeKind) {
    case PostgresSchemaNodeKind.namespace:
      return 1;
    case RelationalSchemaNodeKind.foreignKey:
      return issue.reason === 'not-expected' ? 10 : 60;
    case RelationalSchemaNodeKind.unique:
      return issue.reason === 'not-expected' ? 11 : 51;
    case RelationalSchemaNodeKind.primaryKey:
      return issue.reason === 'not-expected' ? 12 : 50;
    case RelationalSchemaNodeKind.index:
      return issue.reason === 'not-expected' ? 13 : 52;
    case RelationalSchemaNodeKind.columnDefault:
      if (issue.reason === 'not-expected') return 14;
      return issue.reason === 'not-found' ? 42 : 43;
    case RelationalSchemaNodeKind.column:
      if (issue.reason === 'not-expected') return 15;
      return issue.reason === 'not-found' ? 30 : 40;
    case PostgresSchemaNodeKind.table:
      return issue.reason === 'not-expected' ? 16 : 20;
    case RelationalSchemaNodeKind.check:
      if (issue.reason === 'not-found') return 53;
      return issue.reason === 'not-expected' ? 55 : 54;
    default:
      return 99;
  }
}

/** Deterministic tiebreak within an order bucket: the diff path already encodes schema → table → child. */
export function nodeIssueKey(issue: SchemaDiffIssue): string {
  return issue.path.join(' ');
}

// ----------------------------------------------------------------------------
// Subtree coalescing (the planner's responsibility per the differ's contract)
// ----------------------------------------------------------------------------

/**
 * The generic differ is total: a missing/extra table (or column) emits an
 * issue for itself AND for every node in its subtree. `CreateTable`/`DropTable`
 * and `AddColumn`/`DropColumn` already account for the whole subtree, so the
 * nested issues are redundant — coalescing drops any issue whose path is a
 * strict descendant of a `not-found`/`not-expected` issue's path. Run over the
 * relational subset ONLY (policy issues and synthesized namespace issues are
 * handled on their own paths, never coalesced against tables).
 */
export function coalesceSubtreeIssues(
  issues: readonly SchemaDiffIssue[],
): readonly SchemaDiffIssue[] {
  const collapsingPaths = issues
    .filter((issue) => issue.reason === 'not-found' || issue.reason === 'not-expected')
    .map((issue) => issue.path);
  if (collapsingPaths.length === 0) return issues;
  return issues.filter(
    (issue) => !collapsingPaths.some((ancestor) => isStrictDescendantPath(issue.path, ancestor)),
  );
}

function isStrictDescendantPath(path: readonly string[], ancestor: readonly string[]): boolean {
  if (path.length <= ancestor.length) return false;
  for (let i = 0; i < ancestor.length; i += 1) {
    if (path[i] !== ancestor[i]) return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Node → call construction
// ----------------------------------------------------------------------------

function fkSpecFromNode(fk: SqlForeignKeyIR, tableName: string): ForeignKeySpec {
  const name = fk.name ?? `${tableName}_${fk.columns.join('_')}_fkey`;
  return {
    name,
    columns: [...fk.columns],
    references: {
      // The raw target namespace coordinate, matching the retired coordinate
      // path's `references.schema: fk.target.namespaceId` (the FK node stamps
      // it verbatim). The op renderer qualifies the REFERENCES clause from it.
      schema: fk.referencedSchema ?? '',
      table: fk.referencedTable,
      columns: [...fk.referencedColumns],
    },
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
}

/**
 * Builds the `CreateTable` + child `CreateIndex` / `AddForeignKey` / `AddUnique`
 * calls for a newly-expected table, reading only the table node's children. The
 * PK and element-non-null CHECKs go inline as table constraints; indexes
 * (declared + FK-backing, already merged and ordered at derivation) and the
 * FK / unique constraints are separate calls (re-bucketed downstream). Every
 * column's DDL comes off its stamped `opRender.ddlColumn`.
 */
function buildCreateTableCallsFromNode(
  schemaName: string,
  table: PostgresTableSchemaNode,
): PostgresOpFactoryCall[] {
  const ddlColumns: DdlColumn[] = Object.values(table.columns).map(
    (c) => columnOpRenderOf(c).ddlColumn,
  );
  const primaryKeyConstraints: DdlTableConstraint[] = table.primaryKey
    ? [
        contractFree.primaryKey([...table.primaryKey.columns], {
          ...ifDefined('name', table.primaryKey.name),
        }),
      ]
    : [];
  const elementNonNullChecks: DdlTableConstraint[] = Object.values(table.columns)
    .filter((c) => c.many === true)
    .map((c) =>
      contractFree.checkExpression(
        elementNonNullCheckName(table.name, c.name),
        elementNonNullCheckExpression(c.name),
      ),
    );
  const allTableConstraints = [...primaryKeyConstraints, ...elementNonNullChecks];
  const calls: PostgresOpFactoryCall[] = [
    new CreateTableCall(
      schemaName,
      table.name,
      ddlColumns,
      allTableConstraints.length > 0 ? allTableConstraints : undefined,
    ),
  ];
  for (const index of table.indexes) {
    const indexName = index.name ?? defaultIndexName(table.name, index.columns);
    const extras: { type?: string; options?: Record<string, unknown> } = {};
    if (index.type !== undefined) extras.type = index.type;
    if (index.options !== undefined) extras.options = index.options;
    calls.push(new CreateIndexCall(schemaName, table.name, indexName, [...index.columns], extras));
  }
  for (const fk of table.foreignKeys) {
    calls.push(new AddForeignKeyCall(schemaName, table.name, fkSpecFromNode(fk, table.name)));
  }
  for (const unique of table.uniques) {
    const constraintName = unique.name ?? `${table.name}_${unique.columns.join('_')}_key`;
    calls.push(new AddUniqueCall(schemaName, table.name, constraintName, [...unique.columns]));
  }
  return calls;
}

function nodeConflict(kind: SqlPlannerConflict['kind'], message: string): SqlPlannerConflict {
  return issueConflict(kind, message);
}

function mapTableNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const table = blindCast<
      PostgresTableSchemaNode,
      'a not-found table issue always carries the expected PostgresTableSchemaNode'
    >(issue.expected);
    return ok(buildCreateTableCallsFromNode(schemaName, table));
  }
  if (issue.reason === 'not-expected') {
    const table = blindCast<
      PostgresTableSchemaNode,
      'a not-expected table issue always carries the actual PostgresTableSchemaNode'
    >(issue.actual);
    return ok([new DropTableCall(schemaName, table.name)]);
  }
  // Unreachable: PostgresTableSchemaNode.isEqualTo is identity.
  return notOk(nodeConflict('unsupportedOperation', `Unexpected table drift: ${issue.message}`));
}

function mapColumnNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const column = blindCast<
      SqlColumnIR,
      'a not-found column issue always carries the expected column node'
    >(issue.expected);
    return ok([new AddColumnCall(schemaName, tableName, columnOpRenderOf(column).ddlColumn)]);
  }
  if (issue.reason === 'not-expected') {
    const column = blindCast<
      SqlColumnIR,
      'a not-expected column issue always carries the actual column node'
    >(issue.actual);
    return ok([new DropColumnCall(schemaName, tableName, column.name)]);
  }
  // not-equal: Postgres alters in place — type drift and/or nullability drift.
  const expected = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the expected column node'
  >(issue.expected);
  const actual = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the actual column node'
  >(issue.actual);
  const calls: PostgresOpFactoryCall[] = [];
  if (columnTypeChanged(expected, actual)) {
    const { qualifiedTargetType, formatTypeExpected } = columnOpRenderOf(expected).alterType;
    calls.push(
      new AlterColumnTypeCall(schemaName, tableName, expected.name, {
        qualifiedTargetType,
        formatTypeExpected,
        rawTargetTypeForLabel: qualifiedTargetType,
      }),
    );
  }
  if (expected.nullable !== actual.nullable) {
    calls.push(
      expected.nullable
        ? new DropNotNullCall(schemaName, tableName, expected.name)
        : new SetNotNullCall(schemaName, tableName, expected.name),
    );
  }
  return ok(calls);
}

function mapColumnDefaultNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
  columnName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-expected') {
    return ok([new DropDefaultCall(schemaName, tableName, columnName)]);
  }
  // not-found (SET DEFAULT, additive) or not-equal (SET DEFAULT, widening).
  const defaultSql = readOpRenderDefaultSql(issue);
  if (!defaultSql) return ok([]);
  return ok([
    new SetDefaultCall(
      schemaName,
      tableName,
      columnName,
      defaultSql,
      issue.reason === 'not-equal' ? 'widening' : 'additive',
    ),
  ]);
}

/** The column's set-default SQL, read off the default node's threaded `opRender`. */
function readOpRenderDefaultSql(issue: SchemaDiffIssue): string {
  if (issue.expected === undefined) return '';
  const opRender = blindCast<
    { readonly opRender?: unknown },
    'a column-default diff node carries an optional opRender payload threaded from its owning column'
  >(issue.expected).opRender;
  if (opRender === undefined) return '';
  return (
    blindCast<
      { readonly setDefaultSql?: string },
      'the default node threads the owning column PostgresColumnOpRender, which carries setDefaultSql'
    >(opRender).setDefaultSql ?? ''
  );
}

function mapPrimaryKeyNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const pk = blindCast<
      { readonly columns: readonly string[]; readonly name?: string },
      'a not-found primary-key issue always carries the expected PrimaryKey node'
    >(issue.expected);
    const constraintName = pk.name ?? `${tableName}_pkey`;
    return ok([new AddPrimaryKeyCall(schemaName, tableName, constraintName, [...pk.columns])]);
  }
  if (issue.reason === 'not-expected') {
    const pk = blindCast<
      { readonly name?: string },
      'a not-expected primary-key issue always carries the actual PrimaryKey node'
    >(issue.actual);
    return ok([
      new DropConstraintCall(schemaName, tableName, pk.name ?? `${tableName}_pkey`, 'primaryKey'),
    ]);
  }
  return notOk(nodeConflict('indexIncompatible', issue.message));
}

function mapForeignKeyNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const fk = blindCast<
      SqlForeignKeyIR,
      'a not-found foreign-key issue always carries the expected foreign-key node'
    >(issue.expected);
    return ok([new AddForeignKeyCall(schemaName, tableName, fkSpecFromNode(fk, tableName))]);
  }
  if (issue.reason === 'not-expected') {
    const fk = blindCast<
      SqlForeignKeyIR,
      'a not-expected foreign-key issue always carries the actual foreign-key node'
    >(issue.actual);
    const name = fk.name ?? `${tableName}_${fk.columns.join('_')}_fkey`;
    return ok([new DropConstraintCall(schemaName, tableName, name, 'foreignKey')]);
  }
  return notOk(nodeConflict('foreignKeyConflict', issue.message));
}

function mapUniqueNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const unique = blindCast<
      SqlUniqueIR,
      'a not-found unique issue always carries the expected unique node'
    >(issue.expected);
    const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
    return ok([new AddUniqueCall(schemaName, tableName, name, [...unique.columns])]);
  }
  if (issue.reason === 'not-expected') {
    const unique = blindCast<
      SqlUniqueIR,
      'a not-expected unique issue always carries the actual unique node'
    >(issue.actual);
    const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
    return ok([new DropConstraintCall(schemaName, tableName, name, 'unique')]);
  }
  return notOk(nodeConflict('indexIncompatible', issue.message));
}

function mapIndexNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const index = blindCast<
      SqlIndexIR,
      'a not-found index issue always carries the expected index node'
    >(issue.expected);
    const indexName = index.name ?? defaultIndexName(tableName, index.columns);
    const extras: { type?: string; options?: Record<string, unknown> } = {};
    if (index.type !== undefined) extras.type = index.type;
    if (index.options !== undefined) extras.options = index.options;
    return ok([new CreateIndexCall(schemaName, tableName, indexName, [...index.columns], extras)]);
  }
  if (issue.reason === 'not-expected') {
    const index = blindCast<
      SqlIndexIR,
      'a not-expected index issue always carries the actual index node'
    >(issue.actual);
    const indexName = index.name ?? defaultIndexName(tableName, index.columns);
    return ok([new DropIndexCall(schemaName, tableName, indexName)]);
  }
  return notOk(nodeConflict('indexIncompatible', issue.message));
}

function mapCheckNodeIssue(
  issue: SchemaDiffIssue,
  schemaName: string,
  tableName: string,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  // check_removed (extra live check not in contract) is the only check drift
  // the default mapper handles directly; check_missing / check_mismatch are
  // consumed by `checkConstraintPlanCallStrategy` (drop+recreate), so reaching
  // here for them means the strategy did not run — a conflict.
  if (issue.reason === 'not-expected') {
    const check = blindCast<
      { readonly name: string },
      'a not-expected check issue always carries the actual check node'
    >(issue.actual);
    return ok([new DropCheckConstraintCall(schemaName, tableName, check.name)]);
  }
  return notOk(
    nodeConflict(
      'unsupportedOperation',
      `Check constraint drift on "${tableName}" — handled by checkConstraintPlanCallStrategy: ${issue.message}`,
    ),
  );
}

/**
 * Maps one node-typed diff issue to its migration call(s), dispatching on the
 * node's `nodeKind` + `issue.reason`, reading nodes + the stamped `opRender`.
 */
export function mapNodeIssueToCall(
  issue: SchemaDiffIssue,
  _ctx: StrategyContext,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  const node = issueNode(issue);
  if (node === undefined) {
    return notOk(
      nodeConflict(
        'unsupportedOperation',
        `Issue carries neither an expected nor an actual node: ${issue.message}`,
      ),
    );
  }
  if (node.nodeKind === PostgresSchemaNodeKind.namespace) {
    if (issue.reason !== 'not-found') {
      return notOk(
        nodeConflict('unsupportedOperation', `Unexpected namespace drift: ${issue.message}`),
      );
    }
    const namespace = blindCast<
      PostgresNamespaceSchemaNode,
      'a namespace-presence issue always carries a PostgresNamespaceSchemaNode'
    >(issue.expected);
    return ok([new CreateSchemaCall(namespace.schemaName)]);
  }

  const schemaName = issueSchemaName(issue);
  const tableName = issueTableName(issue);
  if (schemaName === undefined || tableName === undefined) {
    return notOk(
      nodeConflict(
        'unsupportedOperation',
        `Issue has no schema/table in its path: ${issue.message}`,
      ),
    );
  }

  switch (node.nodeKind) {
    case PostgresSchemaNodeKind.table:
      return mapTableNodeIssue(issue, schemaName);
    case RelationalSchemaNodeKind.column:
      return mapColumnNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.columnDefault: {
      const columnName = issueColumnName(issue);
      if (columnName === undefined) {
        return notOk(
          nodeConflict(
            'unsupportedOperation',
            `Default issue has no column in its path: ${issue.message}`,
          ),
        );
      }
      return mapColumnDefaultNodeIssue(issue, schemaName, tableName, columnName);
    }
    case RelationalSchemaNodeKind.primaryKey:
      return mapPrimaryKeyNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.foreignKey:
      return mapForeignKeyNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.unique:
      return mapUniqueNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.index:
      return mapIndexNodeIssue(issue, schemaName, tableName);
    case RelationalSchemaNodeKind.check:
      return mapCheckNodeIssue(issue, schemaName, tableName);
    default:
      return notOk(nodeConflict('unsupportedOperation', `Unhandled node kind: ${node.nodeKind}`));
  }
}

export interface NodeIssuePlannerOptions {
  readonly issues: readonly SchemaDiffIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema?: SqlSchemaIR;
  readonly policy?: MigrationOperationPolicy;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly strategies?: readonly NodeCallMigrationStrategy[];
}

/**
 * The node-based sibling of {@link planIssues}: runs node strategies, maps
 * leftover node issues via {@link mapNodeIssueToCall}, applies the same
 * operation-class policy gating, and buckets calls into the same DDL emission
 * order. Additive — wired into the planner in the cutover commit.
 */
export function planNodeIssues(
  options: NodeIssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  const policyProvided = options.policy !== undefined;
  const policy = options.policy ?? DEFAULT_POLICY;
  const schema = options.schema ?? emptySchemaIR();
  const frameworkComponents = options.frameworkComponents ?? [];

  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    schemaName: options.schemaName,
    codecHooks: options.codecHooks,
    storageTypes: options.storageTypes,
    schema,
    policy,
    frameworkComponents,
  };

  const strategies = options.strategies ?? postgresNodePlannerStrategies;

  let remaining = options.issues;
  const recipeCalls: PostgresOpFactoryCall[] = [];
  const bucketablePatternCalls: PostgresOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      if (result.recipe) {
        recipeCalls.push(...result.calls);
      } else {
        bucketablePatternCalls.push(...result.calls);
      }
    }
  }

  const sorted = [...remaining].sort((a, b) => {
    const kindDelta = nodeIssueOrder(a) - nodeIssueOrder(b);
    if (kindDelta !== 0) return kindDelta;
    const keyA = nodeIssueKey(a);
    const keyB = nodeIssueKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const defaultCalls: PostgresOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapNodeIssueToCall(issue, context);
    if (result.ok) {
      defaultCalls.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  const allowed = policy.allowedOperationClasses;
  let gatedDefault = defaultCalls;
  let gatedRecipe = recipeCalls;
  let gatedBucketable = bucketablePatternCalls;
  if (policyProvided) {
    const keepIfAllowed = (bucket: PostgresOpFactoryCall[]) => (call: PostgresOpFactoryCall) => {
      if (allowed.includes(call.operationClass)) {
        bucket.push(call);
        return;
      }
      conflicts.push(conflictForDisallowedCall(call, allowed));
    };
    const gatedDefaultBucket: PostgresOpFactoryCall[] = [];
    const gatedRecipeBucket: PostgresOpFactoryCall[] = [];
    const gatedBucketableBucket: PostgresOpFactoryCall[] = [];
    defaultCalls.forEach(keepIfAllowed(gatedDefaultBucket));
    recipeCalls.forEach(keepIfAllowed(gatedRecipeBucket));
    bucketablePatternCalls.forEach(keepIfAllowed(gatedBucketableBucket));
    gatedDefault = gatedDefaultBucket;
    gatedRecipe = gatedRecipeBucket;
    gatedBucketable = gatedBucketableBucket;
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  const combinedBucketable = [...gatedDefault, ...gatedBucketable];
  const byCategory = (cat: CallCategory) =>
    combinedBucketable.filter((c) => classifyCall(c) === cat);

  const calls: PostgresOpFactoryCall[] = [
    ...byCategory('dep'),
    ...byCategory('drop'),
    ...byCategory('table'),
    ...byCategory('column'),
    ...gatedRecipe,
    ...byCategory('alter'),
    ...byCategory('primaryKey'),
    ...byCategory('unique'),
    ...byCategory('index'),
    ...byCategory('foreignKey'),
  ];

  return ok({ calls });
}
