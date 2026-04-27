/**
 * SQLite migration IR: one concrete `*Call` class per pure factory under
 * `operations/`, plus a shared `SqliteOpFactoryCallNode` abstract base.
 *
 * Each call class carries fully-resolved literal arguments (flat
 * `SqliteColumnSpec` / `SqliteTableSpec` etc.) — codec / `typeRef` / default
 * expansion happens upstream in the issue-planner / strategies, mirroring
 * the Postgres `ColumnSpec` pattern. As a result, `toOp()` and
 * `renderTypeScript()` both pass the same flat data through; the rendered
 * TypeScript scaffold is fully self-contained and does not need access to a
 * `storageTypes` map at runtime.
 */

import { errorUnfilledPlaceholder } from '@prisma-next/errors/migration';
import type {
  MigrationOperationClass,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@prisma-next/ts-render';
import { addColumn, dropColumn } from './operations/columns';
import { createIndex, dropIndex } from './operations/indexes';
import type { SqliteColumnSpec, SqliteIndexSpec, SqliteTableSpec } from './operations/shared';
import { createTable, dropTable, recreateTable } from './operations/tables';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

const TARGET_MIGRATION_MODULE = '@prisma-next/target-sqlite/migration';

abstract class SqliteOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): Op;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

// ============================================================================
// Table
// ============================================================================

export class CreateTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly tableName: string;
  readonly spec: SqliteTableSpec;
  readonly label: string;

  constructor(tableName: string, spec: SqliteTableSpec) {
    super();
    this.tableName = tableName;
    this.spec = spec;
    this.label = `Create table ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return createTable(this.tableName, this.spec);
  }

  renderTypeScript(): string {
    return `createTable(${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.spec)})`;
  }
}

export class DropTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dropTable' as const;
  readonly operationClass = 'destructive' as const;
  readonly tableName: string;
  readonly label: string;

  constructor(tableName: string) {
    super();
    this.tableName = tableName;
    this.label = `Drop table ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return dropTable(this.tableName);
  }

  renderTypeScript(): string {
    return `dropTable(${jsonToTsSource(this.tableName)})`;
  }
}

export class RecreateTableCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'recreateTable' as const;
  readonly operationClass: MigrationOperationClass;
  readonly tableName: string;
  readonly contractTable: SqliteTableSpec;
  readonly schemaColumnNames: readonly string[];
  readonly indexes: readonly SqliteIndexSpec[];
  readonly issues: readonly SchemaIssue[];
  readonly label: string;

  constructor(args: {
    tableName: string;
    contractTable: SqliteTableSpec;
    schemaColumnNames: readonly string[];
    indexes: readonly SqliteIndexSpec[];
    issues: readonly SchemaIssue[];
    operationClass: MigrationOperationClass;
  }) {
    super();
    this.tableName = args.tableName;
    this.contractTable = args.contractTable;
    this.schemaColumnNames = args.schemaColumnNames;
    this.indexes = args.indexes;
    this.issues = args.issues;
    this.operationClass = args.operationClass;
    this.label = `Recreate table ${args.tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return recreateTable({
      tableName: this.tableName,
      contractTable: this.contractTable,
      schemaColumnNames: this.schemaColumnNames,
      indexes: this.indexes,
      issues: this.issues,
      operationClass: this.operationClass,
    });
  }

  renderTypeScript(): string {
    const args = {
      tableName: this.tableName,
      contractTable: this.contractTable,
      schemaColumnNames: this.schemaColumnNames,
      indexes: this.indexes,
      issues: this.issues,
      operationClass: this.operationClass,
    };
    return `recreateTable(${jsonToTsSource(args)})`;
  }
}

// ============================================================================
// Column
// ============================================================================

export class AddColumnCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'addColumn' as const;
  readonly operationClass = 'additive' as const;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: SqliteColumnSpec;
  readonly label: string;

  constructor(tableName: string, column: SqliteColumnSpec) {
    super();
    this.tableName = tableName;
    this.columnName = column.name;
    this.column = column;
    this.label = `Add column ${column.name} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return addColumn(this.tableName, this.column);
  }

  renderTypeScript(): string {
    return `addColumn(${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.column)})`;
  }
}

export class DropColumnCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dropColumn' as const;
  readonly operationClass = 'destructive' as const;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(tableName: string, columnName: string) {
    super();
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop column ${columnName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return dropColumn(this.tableName, this.columnName);
  }

  renderTypeScript(): string {
    return `dropColumn(${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.columnName)})`;
  }
}

// ============================================================================
// Index
// ============================================================================

export class CreateIndexCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly tableName: string;
  readonly indexName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(tableName: string, indexName: string, columns: readonly string[]) {
    super();
    this.tableName = tableName;
    this.indexName = indexName;
    this.columns = columns;
    this.label = `Create index ${indexName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return createIndex(this.tableName, this.indexName, this.columns);
  }

  renderTypeScript(): string {
    return `createIndex(${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.indexName)}, ${jsonToTsSource(this.columns)})`;
  }
}

export class DropIndexCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dropIndex' as const;
  readonly operationClass = 'destructive' as const;
  readonly tableName: string;
  readonly indexName: string;
  readonly label: string;

  constructor(tableName: string, indexName: string) {
    super();
    this.tableName = tableName;
    this.indexName = indexName;
    this.label = `Drop index ${indexName} on ${tableName}`;
    this.freeze();
  }

  toOp(): Op {
    return dropIndex(this.tableName, this.indexName);
  }

  renderTypeScript(): string {
    return `dropIndex(${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.indexName)})`;
  }
}

// ============================================================================
// Data transform
// ============================================================================

/**
 * A planner-generated data-transform stub. Emitted by
 * `nullabilityTighteningBackfillStrategy` when the policy allows `'data'`
 * and the contract tightens a column's nullability — the user must fill in
 * the backfill before the subsequent recreate-table op copies data into the
 * NOT NULL-constrained temp table.
 *
 * `toOp()` always throws `PN-MIG-2001`: the planner cannot lower a stubbed
 * transform to a runtime op — the user must edit the rendered
 * `migration.ts` and re-emit.
 */
export class DataTransformCall extends SqliteOpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass = 'data' as const;
  readonly id: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(tableName: string, columnName: string) {
    super();
    this.id = `data_migration.backfill-${tableName}-${columnName}`;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Backfill NULLs in "${tableName}"."${columnName}" before NOT NULL tightening`;
    this.freeze();
  }

  toOp(): Op {
    throw errorUnfilledPlaceholder(this.label);
  }

  renderTypeScript(): string {
    const slot = `${this.tableName}-${this.columnName}-backfill-sql`;
    return [
      'dataTransform({',
      `  id: ${jsonToTsSource(this.id)},`,
      `  label: ${jsonToTsSource(this.label)},`,
      `  table: ${jsonToTsSource(this.tableName)},`,
      `  description: ${jsonToTsSource(`Backfill NULL ${this.columnName} values in ${this.tableName}`)},`,
      `  run: () => placeholder(${jsonToTsSource(slot)}),`,
      '})',
    ].join('\n');
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: this.factoryName },
      { moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: 'placeholder' },
    ];
  }
}

// ============================================================================
// Union
// ============================================================================

export type SqliteOpFactoryCall =
  | CreateTableCall
  | DropTableCall
  | RecreateTableCall
  | AddColumnCall
  | DropColumnCall
  | CreateIndexCall
  | DropIndexCall
  | DataTransformCall;
