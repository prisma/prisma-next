/**
 * Descriptor-based migration planner.
 *
 * Takes schema issues (from verifySqlSchema) and emits PostgresMigrationOpDescriptor[].
 * Migration strategies consume issues they recognize and produce specialized op
 * sequences (e.g., NOT NULL backfill → addColumn(nullable) + dataTransform + setNotNull).
 * Remaining issues get default descriptor mapping.
 *
 * This planner does NOT produce SqlMigrationPlanOperation — that's the resolver's job.
 * The separation means the same descriptors work for both planner-generated and
 * user-authored migrations.
 */

import type { Contract } from '@prisma-next/contract/types';
import type { SqlPlannerConflict } from '@prisma-next/family-sql/control';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateSchemaCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropEnumTypeCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  type PostgresOpFactoryCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import {
  addColumn,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  alterColumnType,
  createDependency,
  createEnumType,
  createIndex,
  createTable,
  dropColumn,
  dropConstraint,
  dropDefault,
  dropIndex,
  dropNotNull,
  dropTable,
  type PostgresMigrationOpDescriptor,
  setDefault,
  setNotNull,
} from './operation-descriptors';
import type { ColumnSpec, ForeignKeySpec } from './operations/shared';
import {
  buildColumnDefaultSql,
  buildColumnTypeSql,
  renderDefaultLiteral,
} from './planner-ddl-builders';
import {
  type CallMigrationStrategy,
  type MigrationStrategy,
  migrationPlanCallStrategies,
  migrationPlanStrategies,
  type StrategyContext,
} from './planner-strategies';

export type { CallMigrationStrategy, MigrationStrategy, StrategyContext };

// ============================================================================
// Issue kind ordering (dependency order)
// ============================================================================

const ISSUE_KIND_ORDER: Record<string, number> = {
  // Dependencies and types first
  dependency_missing: 1,
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

// ============================================================================
// Default issue-to-descriptor mapping
// ============================================================================

function isMissing(issue: SchemaIssue): boolean {
  if (issue.kind === 'enum_values_changed') return false;
  return issue.actual === undefined;
}

function mapIssue(
  issue: SchemaIssue,
  ctx: StrategyContext,
): Result<readonly PostgresMigrationOpDescriptor[], SqlPlannerConflict> {
  switch (issue.kind) {
    // Additive — missing structures
    case 'missing_table': {
      if (!issue.table)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing table issue has no table name'),
        );
      const contractTable = ctx.toContract.storage.tables[issue.table];
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" reported missing but not found in destination contract`,
          ),
        );
      }
      const ops: PostgresMigrationOpDescriptor[] = [createTable(issue.table)];
      for (const index of contractTable.indexes) {
        ops.push(createIndex(issue.table, [...index.columns]));
      }
      const explicitIndexColumnSets = new Set(
        contractTable.indexes.map((idx) => idx.columns.join(',')),
      );
      for (const fk of contractTable.foreignKeys) {
        if (fk.constraint) {
          ops.push(addForeignKey(issue.table, [...fk.columns]));
        }
        if (fk.index && !explicitIndexColumnSets.has(fk.columns.join(','))) {
          ops.push(createIndex(issue.table, [...fk.columns]));
        }
      }
      for (const unique of contractTable.uniques) {
        ops.push(addUnique(issue.table, [...unique.columns]));
      }
      return ok(ops);
    }

    case 'missing_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing column issue has no table/column name'),
        );
      return ok([addColumn(issue.table, issue.column)]);

    case 'default_missing':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default missing issue has no table/column name'),
        );
      return ok([setDefault(issue.table, issue.column)]);

    // Destructive — extra structures
    case 'extra_table':
      if (!issue.table)
        return notOk(issueConflict('unsupportedOperation', 'Extra table issue has no table name'));
      return ok([dropTable(issue.table)]);

    case 'extra_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra column issue has no table/column name'),
        );
      return ok([dropColumn(issue.table, issue.column)]);

    case 'extra_index':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra index issue has no table/index name'),
        );
      return ok([dropIndex(issue.table, issue.indexOrConstraint)]);

    case 'extra_unique_constraint':
    case 'extra_foreign_key':
    case 'extra_primary_key':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict(
            'unsupportedOperation',
            'Extra constraint issue has no table/constraint name',
          ),
        );
      return ok([dropConstraint(issue.table, issue.indexOrConstraint)]);

    case 'extra_default':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra default issue has no table/column name'),
        );
      return ok([dropDefault(issue.table, issue.column)]);

    // Nullability changes
    case 'nullability_mismatch': {
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('nullabilityConflict', 'Nullability mismatch has no table/column name'),
        );
      const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
      if (!column)
        return notOk(
          issueConflict(
            'nullabilityConflict',
            `Column "${issue.table}"."${issue.column}" not found in destination contract`,
          ),
        );
      return ok(
        column.nullable
          ? [dropNotNull(issue.table, issue.column)]
          : [setNotNull(issue.table, issue.column)],
      );
    }

    // Type changes
    case 'type_mismatch':
      if (!issue.table || !issue.column)
        return notOk(issueConflict('typeMismatch', 'Type mismatch has no table/column name'));
      return ok([alterColumnType(issue.table, issue.column)]);

    // Default changes
    case 'default_mismatch':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default mismatch has no table/column name'),
        );
      return ok([setDefault(issue.table, issue.column)]);

    // Constraints — missing (actual undefined) vs mismatched (actual defined)
    case 'primary_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('indexIncompatible', 'Primary key issue has no table name'));
      if (isMissing(issue)) return ok([addPrimaryKey(issue.table)]);
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
        return ok([addUnique(issue.table, columns)]);
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
        const columns = issue.expected.split(', ');
        return ok([createIndex(issue.table, columns)]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Index on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'foreign_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('foreignKeyConflict', 'Foreign key issue has no table name'));
      if (isMissing(issue) && issue.expected) {
        const arrowIdx = issue.expected.indexOf(' -> ');
        if (arrowIdx >= 0) {
          const columns = issue.expected.slice(0, arrowIdx).split(', ');
          return ok([addForeignKey(issue.table, columns)]);
        }
      }
      return notOk(
        issueConflict(
          'foreignKeyConflict',
          `Foreign key on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    // Types
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
      // TODO: codec-specific descriptor dispatch should be driven by a registry, not hardcoded prefix checks
      if (typeInstance.codecId.startsWith('pg/enum')) {
        return ok([createEnumType(issue.typeName)]);
      }
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Type "${issue.typeName}" uses codec "${typeInstance.codecId}" — only enum types are supported by the descriptor planner`,
        ),
      );
    }

    case 'type_values_mismatch':
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Type "${issue.typeName ?? 'unknown'}" values differ — type alteration not yet supported by descriptor planner`,
        ),
      );

    // Dependencies
    case 'dependency_missing':
      if (!issue.dependencyId)
        return notOk(
          issueConflict('unsupportedOperation', 'Dependency missing issue has no dependencyId'),
        );
      return ok([createDependency(issue.dependencyId)]);
    default:
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Unhandled issue kind: ${(issue as SchemaIssue).kind}`,
        ),
      );
  }
}

// ============================================================================
// Planner entry point
// ============================================================================

export interface DescriptorPlannerOptions {
  readonly issues: readonly SchemaIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName?: string;
  readonly codecHooks?: ReadonlyMap<
    string,
    import('@prisma-next/family-sql/control').CodecControlHooks
  >;
  readonly storageTypes?: Readonly<
    Record<string, import('@prisma-next/sql-contract/types').StorageTypeInstance>
  >;
  readonly strategies?: readonly MigrationStrategy[];
}

export interface DescriptorPlannerValue {
  readonly descriptors: readonly PostgresMigrationOpDescriptor[];
}

export function planDescriptors(
  options: DescriptorPlannerOptions,
): Result<DescriptorPlannerValue, readonly SqlPlannerConflict[]> {
  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    schemaName: options.schemaName ?? 'public',
    codecHooks: options.codecHooks ?? new Map(),
    storageTypes: options.storageTypes ?? options.toContract.storage.types ?? {},
  };

  const strategies = options.strategies ?? migrationPlanStrategies;

  // Phase 1: Pattern matching — consume recognized issues
  let remaining = options.issues;
  const patternOps: PostgresMigrationOpDescriptor[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      patternOps.push(...result.ops);
    }
  }

  // Phase 2: Sort remaining issues by dependency order
  const sorted = [...remaining].sort((a, b) => issueOrder(a) - issueOrder(b));

  // Phase 3: Map remaining issues to descriptors, collecting conflicts
  const defaultOps: PostgresMigrationOpDescriptor[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapIssue(issue, context);
    if (result.ok) {
      defaultOps.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  // Phase 4: Order descriptors by operation kind
  const depOps = defaultOps.filter(
    (op) =>
      op.kind === 'createDependency' ||
      op.kind === 'createEnumType' ||
      op.kind === 'addEnumValues' ||
      op.kind === 'dropEnumType' ||
      op.kind === 'renameType',
  );
  const dropOps = defaultOps.filter(
    (op) =>
      op.kind === 'dropTable' ||
      op.kind === 'dropColumn' ||
      op.kind === 'dropConstraint' ||
      op.kind === 'dropIndex' ||
      op.kind === 'dropDefault',
  );
  const tableOps = defaultOps.filter((op) => op.kind === 'createTable');
  const columnOps = defaultOps.filter((op) => op.kind === 'addColumn');
  const alterOps = defaultOps.filter(
    (op) =>
      op.kind === 'alterColumnType' ||
      op.kind === 'setNotNull' ||
      op.kind === 'dropNotNull' ||
      op.kind === 'setDefault',
  );
  const constraintOps = defaultOps.filter(
    (op) =>
      op.kind === 'addPrimaryKey' ||
      op.kind === 'addUnique' ||
      op.kind === 'createIndex' ||
      op.kind === 'addForeignKey',
  );

  const descriptors: PostgresMigrationOpDescriptor[] = [
    ...depOps,
    ...dropOps,
    ...tableOps,
    ...columnOps,
    ...patternOps,
    ...alterOps,
    ...constraintOps,
  ];

  return ok({
    descriptors,
  });
}

// ============================================================================
// Class-flow issue planner
// ============================================================================

export interface IssuePlannerOptions {
  readonly issues: readonly SchemaIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<
    string,
    import('@prisma-next/family-sql/control').CodecControlHooks
  >;
  readonly storageTypes: Readonly<
    Record<string, import('@prisma-next/sql-contract/types').StorageTypeInstance>
  >;
  readonly strategies?: readonly CallMigrationStrategy[];
}

export interface IssuePlannerValue {
  readonly calls: readonly PostgresOpFactoryCall[];
}

function toColumnSpec(
  name: string,
  column: import('@prisma-next/sql-contract/types').StorageColumn,
  codecHooks: ReadonlyMap<string, import('@prisma-next/family-sql/control').CodecControlHooks>,
  storageTypes: Readonly<
    Record<string, import('@prisma-next/sql-contract/types').StorageTypeInstance>
  >,
): ColumnSpec {
  return {
    name,
    typeSql: buildColumnTypeSql(
      column,
      codecHooks as Map<string, import('@prisma-next/family-sql/control').CodecControlHooks>,
      storageTypes as Record<string, import('@prisma-next/sql-contract/types').StorageTypeInstance>,
    ),
    defaultSql: buildColumnDefaultSql(column.default, column),
    nullable: column.nullable,
  };
}

function mapIssueToCall(
  issue: SchemaIssue,
  ctx: StrategyContext,
): Result<readonly PostgresOpFactoryCall[], SqlPlannerConflict> {
  const { schemaName, codecHooks, storageTypes } = ctx;

  switch (issue.kind) {
    case 'missing_table': {
      if (!issue.table)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing table issue has no table name'),
        );
      const contractTable = ctx.toContract.storage.tables[issue.table];
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" reported missing but not found in destination contract`,
          ),
        );
      }
      const columns: ColumnSpec[] = Object.entries(contractTable.columns).map(([name, column]) =>
        toColumnSpec(name, column, codecHooks, storageTypes),
      );
      const primaryKey = contractTable.primaryKey
        ? { columns: contractTable.primaryKey.columns }
        : undefined;
      const calls: PostgresOpFactoryCall[] = [
        new CreateTableCall(schemaName, issue.table, columns, primaryKey),
      ];
      for (const index of contractTable.indexes) {
        const indexName = index.name ?? `${issue.table}_${index.columns.join('_')}_idx`;
        calls.push(new CreateIndexCall(schemaName, issue.table, indexName, [...index.columns]));
      }
      const explicitIndexColumnSets = new Set(
        contractTable.indexes.map((idx) => idx.columns.join(',')),
      );
      for (const fk of contractTable.foreignKeys) {
        if (fk.constraint) {
          const fkName = fk.name ?? `${issue.table}_${fk.columns.join('_')}_fkey`;
          const fkSpec: ForeignKeySpec = {
            name: fkName,
            columns: fk.columns,
            references: { table: fk.references.table, columns: fk.references.columns },
            ...(fk.onDelete !== undefined && { onDelete: fk.onDelete }),
            ...(fk.onUpdate !== undefined && { onUpdate: fk.onUpdate }),
          };
          calls.push(new AddForeignKeyCall(schemaName, issue.table, fkSpec));
        }
        if (fk.index && !explicitIndexColumnSets.has(fk.columns.join(','))) {
          const indexName = `${issue.table}_${fk.columns.join('_')}_idx`;
          calls.push(new CreateIndexCall(schemaName, issue.table, indexName, [...fk.columns]));
        }
      }
      for (const unique of contractTable.uniques) {
        const constraintName = unique.name ?? `${issue.table}_${unique.columns.join('_')}_key`;
        calls.push(new AddUniqueCall(schemaName, issue.table, constraintName, [...unique.columns]));
      }
      return ok(calls);
    }

    case 'missing_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing column issue has no table/column name'),
        );
      {
        const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
        if (!column)
          return notOk(
            issueConflict(
              'unsupportedOperation',
              `Column "${issue.table}"."${issue.column}" not in destination contract`,
            ),
          );
        return ok([
          new AddColumnCall(
            schemaName,
            issue.table,
            toColumnSpec(issue.column, column, codecHooks, storageTypes),
          ),
        ]);
      }

    case 'default_missing':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default missing issue has no table/column name'),
        );
      {
        const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
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
        return ok([new SetDefaultCall(schemaName, issue.table, issue.column, defaultSql)]);
      }

    case 'extra_table':
      if (!issue.table)
        return notOk(issueConflict('unsupportedOperation', 'Extra table issue has no table name'));
      return ok([new DropTableCall(schemaName, issue.table)]);

    case 'extra_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra column issue has no table/column name'),
        );
      return ok([new DropColumnCall(schemaName, issue.table, issue.column)]);

    case 'extra_index':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra index issue has no table/index name'),
        );
      return ok([new DropIndexCall(schemaName, issue.table, issue.indexOrConstraint)]);

    case 'extra_unique_constraint':
    case 'extra_foreign_key':
    case 'extra_primary_key':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict(
            'unsupportedOperation',
            'Extra constraint issue has no table/constraint name',
          ),
        );
      {
        const kindMap = {
          extra_unique_constraint: 'unique' as const,
          extra_foreign_key: 'foreignKey' as const,
          extra_primary_key: 'primaryKey' as const,
        };
        return ok([
          new DropConstraintCall(
            schemaName,
            issue.table,
            issue.indexOrConstraint,
            kindMap[issue.kind],
          ),
        ]);
      }

    case 'extra_default':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra default issue has no table/column name'),
        );
      return ok([new DropDefaultCall(schemaName, issue.table, issue.column)]);

    case 'nullability_mismatch': {
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('nullabilityConflict', 'Nullability mismatch has no table/column name'),
        );
      const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
      if (!column)
        return notOk(
          issueConflict(
            'nullabilityConflict',
            `Column "${issue.table}"."${issue.column}" not found in destination contract`,
          ),
        );
      return ok(
        column.nullable
          ? [new DropNotNullCall(schemaName, issue.table, issue.column)]
          : [new SetNotNullCall(schemaName, issue.table, issue.column)],
      );
    }

    case 'type_mismatch':
      if (!issue.table || !issue.column)
        return notOk(issueConflict('typeMismatch', 'Type mismatch has no table/column name'));
      {
        const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
        if (!column)
          return notOk(
            issueConflict(
              'typeMismatch',
              `Column "${issue.table}"."${issue.column}" not in destination contract`,
            ),
          );
        const qualifiedTargetType = buildColumnTypeSql(
          column,
          codecHooks as Map<string, import('@prisma-next/family-sql/control').CodecControlHooks>,
          storageTypes as Record<
            string,
            import('@prisma-next/sql-contract/types').StorageTypeInstance
          >,
          false,
        );
        return ok([
          new AlterColumnTypeCall(schemaName, issue.table, issue.column, {
            qualifiedTargetType,
            formatTypeExpected: qualifiedTargetType,
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
        const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
        if (!column?.default) return ok([]);
        const defaultSql = buildColumnDefaultSql(column.default, column);
        if (!defaultSql) return ok([]);
        return ok([
          new SetDefaultCall(schemaName, issue.table, issue.column, defaultSql, 'widening'),
        ]);
      }

    case 'primary_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('indexIncompatible', 'Primary key issue has no table name'));
      if (isMissing(issue)) {
        const pk = ctx.toContract.storage.tables[issue.table]?.primaryKey;
        if (!pk)
          return notOk(
            issueConflict('indexIncompatible', `No primary key in contract for "${issue.table}"`),
          );
        const constraintName = pk.name ?? `${issue.table}_pkey`;
        return ok([new AddPrimaryKeyCall(schemaName, issue.table, constraintName, pk.columns)]);
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
        return ok([new AddUniqueCall(schemaName, issue.table, constraintName, columns)]);
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
        const columns = issue.expected.split(', ');
        const indexName = `${issue.table}_${columns.join('_')}_idx`;
        return ok([new CreateIndexCall(schemaName, issue.table, indexName, columns)]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Index on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'foreign_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('foreignKeyConflict', 'Foreign key issue has no table name'));
      if (isMissing(issue) && issue.expected) {
        const arrowIdx = issue.expected.indexOf(' -> ');
        if (arrowIdx >= 0) {
          const columns = issue.expected.slice(0, arrowIdx).split(', ');
          const fkName = `${issue.table}_${columns.join('_')}_fkey`;
          const fk = ctx.toContract.storage.tables[issue.table]?.foreignKeys.find(
            (k) => k.columns.join(', ') === columns.join(', '),
          );
          if (fk) {
            const fkSpec: ForeignKeySpec = {
              name: fkName,
              columns: fk.columns,
              references: { table: fk.references.table, columns: fk.references.columns },
              ...(fk.onDelete !== undefined && { onDelete: fk.onDelete }),
              ...(fk.onUpdate !== undefined && { onUpdate: fk.onUpdate }),
            };
            return ok([new AddForeignKeyCall(schemaName, issue.table, fkSpec)]);
          }
          return ok([
            new AddForeignKeyCall(schemaName, issue.table, {
              name: fkName,
              columns,
              references: { table: '', columns: [] },
            }),
          ]);
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
      if (typeInstance.codecId.startsWith('pg/enum')) {
        const values = (typeInstance.typeParams['values'] ?? []) as readonly string[];
        return ok([new CreateEnumTypeCall(schemaName, issue.typeName, values)]);
      }
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Type "${issue.typeName}" uses codec "${typeInstance.codecId}" — only enum types are supported`,
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

    case 'dependency_missing':
      if (!issue.dependencyId)
        return notOk(
          issueConflict('unsupportedOperation', 'Dependency missing issue has no dependencyId'),
        );
      if (issue.dependencyId.startsWith('ext:')) {
        return ok([new CreateExtensionCall(issue.dependencyId.slice(4))]);
      }
      if (issue.dependencyId.startsWith('schema:')) {
        return ok([new CreateSchemaCall(issue.dependencyId.slice(7))]);
      }
      return notOk(
        issueConflict('unsupportedOperation', `Unknown dependency type: ${issue.dependencyId}`),
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
function classifyCall(
  call: PostgresOpFactoryCall,
): 'dep' | 'drop' | 'table' | 'column' | 'alter' | 'constraint' {
  switch (call.factoryName) {
    case 'createExtension':
    case 'createSchema':
    case 'createEnumType':
    case 'addEnumValues':
    case 'dropEnumType':
    case 'renameType':
      return 'dep';
    case 'dropTable':
    case 'dropColumn':
    case 'dropConstraint':
    case 'dropIndex':
    case 'dropDefault':
      return 'drop';
    case 'createTable':
      return 'table';
    case 'addColumn':
      return 'column';
    case 'alterColumnType':
    case 'setNotNull':
    case 'dropNotNull':
    case 'setDefault':
      return 'alter';
    case 'addPrimaryKey':
    case 'addUnique':
    case 'createIndex':
    case 'addForeignKey':
      return 'constraint';
    default:
      return 'alter';
  }
}

export function planIssues(
  options: IssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    schemaName: options.schemaName,
    codecHooks: options.codecHooks,
    storageTypes: options.storageTypes,
  };

  const strategies = options.strategies ?? migrationPlanCallStrategies;

  let remaining = options.issues;
  const patternCalls: PostgresOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      patternCalls.push(...result.calls);
    }
  }

  const sorted = [...remaining].sort((a, b) => issueOrder(a) - issueOrder(b));

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

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  const categoryOrder: Record<string, number> = {
    dep: 0,
    drop: 1,
    table: 2,
    column: 3,
    alter: 4,
    constraint: 5,
  };

  const orderedDefault = [...defaultCalls].sort(
    (a, b) => (categoryOrder[classifyCall(a)] ?? 4) - (categoryOrder[classifyCall(b)] ?? 4),
  );

  const calls: PostgresOpFactoryCall[] = [
    ...orderedDefault.filter((c) => classifyCall(c) === 'dep'),
    ...orderedDefault.filter((c) => classifyCall(c) === 'drop'),
    ...orderedDefault.filter((c) => classifyCall(c) === 'table'),
    ...orderedDefault.filter((c) => classifyCall(c) === 'column'),
    ...patternCalls,
    ...orderedDefault.filter((c) => classifyCall(c) === 'alter'),
    ...orderedDefault.filter((c) => classifyCall(c) === 'constraint'),
  ];

  return ok({ calls });
}
