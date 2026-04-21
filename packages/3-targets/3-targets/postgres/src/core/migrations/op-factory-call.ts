/**
 * Postgres class-flow IR: one concrete `*Call` class per pure factory in
 * `op-factories.ts`, plus a shared `PostgresOpFactoryCallNode` abstract base.
 *
 * Every call class carries the literal arguments its backing factory would
 * receive, computes a human-readable `label` in its constructor, and
 * implements three polymorphic hooks:
 *
 * - `toOp()` — converts the IR node to a runtime `SqlMigrationPlanOperation`
 *   by delegating to the matching pure factory in `op-factories.ts`.
 * - `renderTypeScript()` / `importRequirements()` — used by
 *   `renderCallsToTypeScript` to emit the call as a TypeScript expression
 *   inside the scaffolded `migration.ts`.
 * - `accept(visitor)` — retained for future exhaustive walks.
 *
 * The abstract base and all concrete classes are package-private. External
 * consumers see only the framework-level `OpFactoryCall` interface and the
 * `PostgresOpFactoryCall` union.
 */

import { placeholder } from '@prisma-next/errors/migration';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@prisma-next/framework-components/control';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@prisma-next/ts-render';
import type { ColumnSpec, ForeignKeySpec } from './op-factories';
import {
  addColumn,
  addEnumValues,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  alterColumnType,
  createEnumType,
  createIndex,
  createTable,
  dropColumn,
  dropConstraint,
  dropDefault,
  dropEnumType,
  dropIndex,
  dropNotNull,
  dropTable,
  renameType,
  setDefault,
  setNotNull,
} from './op-factories';
import { PlaceholderExpression } from './placeholder-expression';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

const TARGET_MIGRATION_MODULE = '@prisma-next/target-postgres/migration';

/**
 * Converts a `TsExpression` body into a closure for runtime use.
 * `PlaceholderExpression` yields a closure that throws `PN-MIG-2001`
 * when invoked — the designed failure mode for unfilled slots.
 */
function bodyToClosure(expr: TsExpression): () => never {
  if (expr instanceof PlaceholderExpression) {
    return () => placeholder(expr.slot);
  }
  throw new Error(`bodyToClosure: unsupported TsExpression variant: ${expr.constructor.name}`);
}

export interface PostgresOpFactoryCallVisitor<R> {
  createTable(call: CreateTableCall): R;
  dropTable(call: DropTableCall): R;
  addColumn(call: AddColumnCall): R;
  dropColumn(call: DropColumnCall): R;
  alterColumnType(call: AlterColumnTypeCall): R;
  setNotNull(call: SetNotNullCall): R;
  dropNotNull(call: DropNotNullCall): R;
  setDefault(call: SetDefaultCall): R;
  dropDefault(call: DropDefaultCall): R;
  addPrimaryKey(call: AddPrimaryKeyCall): R;
  addForeignKey(call: AddForeignKeyCall): R;
  addUnique(call: AddUniqueCall): R;
  createIndex(call: CreateIndexCall): R;
  dropIndex(call: DropIndexCall): R;
  dropConstraint(call: DropConstraintCall): R;
  createEnumType(call: CreateEnumTypeCall): R;
  addEnumValues(call: AddEnumValuesCall): R;
  dropEnumType(call: DropEnumTypeCall): R;
  renameType(call: RenameTypeCall): R;
  dataTransform(call: DataTransformCall): R;
}

abstract class PostgresOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R;
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

export interface CreateTablePrimaryKey {
  readonly columns: readonly string[];
}

export class CreateTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columns: readonly ColumnSpec[];
  readonly primaryKey: CreateTablePrimaryKey | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columns: readonly ColumnSpec[],
    primaryKey?: CreateTablePrimaryKey,
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columns = columns;
    this.primaryKey = primaryKey;
    this.label = `Create table "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.createTable(this);
  }

  toOp(): Op {
    return createTable(this.schemaName, this.tableName, this.columns, this.primaryKey);
  }

  renderTypeScript(): string {
    const args = [
      jsonToTsSource(this.schemaName),
      jsonToTsSource(this.tableName),
      jsonToTsSource(this.columns),
    ];
    if (this.primaryKey) args.push(jsonToTsSource(this.primaryKey));
    return `createTable(${args.join(', ')})`;
  }
}

export class DropTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropTable' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.label = `Drop table "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropTable(this);
  }

  toOp(): Op {
    return dropTable(this.schemaName, this.tableName);
  }

  renderTypeScript(): string {
    return `dropTable(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)})`;
  }
}

// ============================================================================
// Column
// ============================================================================

export class AddColumnCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addColumn' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly column: ColumnSpec;
  readonly label: string;

  constructor(schemaName: string, tableName: string, column: ColumnSpec) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.column = column;
    this.label = `Add column "${column.name}" to "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.addColumn(this);
  }

  toOp(): Op {
    return addColumn(this.schemaName, this.tableName, this.column);
  }

  renderTypeScript(): string {
    return `addColumn(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.column)})`;
  }
}

export class DropColumnCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropColumn' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop column "${columnName}" from "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropColumn(this);
  }

  toOp(): Op {
    return dropColumn(this.schemaName, this.tableName, this.columnName);
  }

  renderTypeScript(): string {
    return `dropColumn(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.columnName)})`;
  }
}

export interface AlterColumnTypeOptions {
  readonly qualifiedTargetType: string;
  readonly formatTypeExpected: string;
  readonly rawTargetTypeForLabel: string;
  readonly using?: string;
}

export class AlterColumnTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'alterColumnType' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly options: AlterColumnTypeOptions;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    options: AlterColumnTypeOptions,
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.options = options;
    this.label = `Alter type of "${tableName}"."${columnName}" to ${options.rawTargetTypeForLabel}`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.alterColumnType(this);
  }

  toOp(): Op {
    return alterColumnType(this.schemaName, this.tableName, this.columnName, this.options);
  }

  renderTypeScript(): string {
    return `alterColumnType(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.columnName)}, ${jsonToTsSource(this.options)})`;
  }
}

export class SetNotNullCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setNotNull' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Set NOT NULL on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.setNotNull(this);
  }

  toOp(): Op {
    return setNotNull(this.schemaName, this.tableName, this.columnName);
  }

  renderTypeScript(): string {
    return `setNotNull(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.columnName)})`;
  }
}

export class DropNotNullCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropNotNull' as const;
  readonly operationClass = 'widening' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop NOT NULL on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropNotNull(this);
  }

  toOp(): Op {
    return dropNotNull(this.schemaName, this.tableName, this.columnName);
  }

  renderTypeScript(): string {
    return `dropNotNull(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.columnName)})`;
  }
}

export class SetDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'setDefault' as const;
  readonly operationClass: 'additive' | 'widening';
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly defaultSql: string;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columnName: string,
    defaultSql: string,
    operationClass: 'additive' | 'widening' = 'additive',
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.defaultSql = defaultSql;
    this.operationClass = operationClass;
    this.label = `Set default on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.setDefault(this);
  }

  toOp(): Op {
    return setDefault(
      this.schemaName,
      this.tableName,
      this.columnName,
      this.defaultSql,
      this.operationClass,
    );
  }

  renderTypeScript(): string {
    const args = [
      jsonToTsSource(this.schemaName),
      jsonToTsSource(this.tableName),
      jsonToTsSource(this.columnName),
      jsonToTsSource(this.defaultSql),
    ];
    if (this.operationClass !== 'additive') {
      args.push(jsonToTsSource(this.operationClass));
    }
    return `setDefault(${args.join(', ')})`;
  }
}

export class DropDefaultCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropDefault' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, columnName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columnName = columnName;
    this.label = `Drop default on "${tableName}"."${columnName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropDefault(this);
  }

  toOp(): Op {
    return dropDefault(this.schemaName, this.tableName, this.columnName);
  }

  renderTypeScript(): string {
    return `dropDefault(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.columnName)})`;
  }
}

// ============================================================================
// Constraints
// ============================================================================

export class AddPrimaryKeyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addPrimaryKey' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    columns: readonly string[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.columns = columns;
    this.label = `Add primary key on "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.addPrimaryKey(this);
  }

  toOp(): Op {
    return addPrimaryKey(this.schemaName, this.tableName, this.constraintName, this.columns);
  }

  renderTypeScript(): string {
    return `addPrimaryKey(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.constraintName)}, ${jsonToTsSource(this.columns)})`;
  }
}

export class AddUniqueCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addUnique' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    columns: readonly string[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.columns = columns;
    this.label = `Add unique constraint on "${tableName}" (${columns.join(', ')})`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.addUnique(this);
  }

  toOp(): Op {
    return addUnique(this.schemaName, this.tableName, this.constraintName, this.columns);
  }

  renderTypeScript(): string {
    return `addUnique(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.constraintName)}, ${jsonToTsSource(this.columns)})`;
  }
}

export class AddForeignKeyCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addForeignKey' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly fk: ForeignKeySpec;
  readonly label: string;

  constructor(schemaName: string, tableName: string, fk: ForeignKeySpec) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.fk = fk;
    this.label = `Add foreign key "${fk.name}" on "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.addForeignKey(this);
  }

  toOp(): Op {
    return addForeignKey(this.schemaName, this.tableName, this.fk);
  }

  renderTypeScript(): string {
    return `addForeignKey(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.fk)})`;
  }
}

export class DropConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropConstraint' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly kind: 'foreignKey' | 'unique' | 'primaryKey';
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    kind: 'foreignKey' | 'unique' | 'primaryKey' = 'unique',
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.kind = kind;
    this.label = `Drop constraint "${constraintName}" on "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropConstraint(this);
  }

  toOp(): Op {
    return dropConstraint(this.schemaName, this.tableName, this.constraintName, this.kind);
  }

  renderTypeScript(): string {
    const args = [
      jsonToTsSource(this.schemaName),
      jsonToTsSource(this.tableName),
      jsonToTsSource(this.constraintName),
    ];
    if (this.kind !== 'unique') {
      args.push(jsonToTsSource(this.kind));
    }
    return `dropConstraint(${args.join(', ')})`;
  }
}

// ============================================================================
// Indexes
// ============================================================================

export class CreateIndexCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  readonly columns: readonly string[];
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    indexName: string,
    columns: readonly string[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.indexName = indexName;
    this.columns = columns;
    this.label = `Create index "${indexName}" on "${tableName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.createIndex(this);
  }

  toOp(): Op {
    return createIndex(this.schemaName, this.tableName, this.indexName, this.columns);
  }

  renderTypeScript(): string {
    return `createIndex(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.indexName)}, ${jsonToTsSource(this.columns)})`;
  }
}

export class DropIndexCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropIndex' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, indexName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.indexName = indexName;
    this.label = `Drop index "${indexName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropIndex(this);
  }

  toOp(): Op {
    return dropIndex(this.schemaName, this.tableName, this.indexName);
  }

  renderTypeScript(): string {
    return `dropIndex(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.indexName)})`;
  }
}

// ============================================================================
// Enum types
// ============================================================================

export class CreateEnumTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createEnumType' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly typeName: string;
  readonly values: readonly string[];
  readonly label: string;

  constructor(schemaName: string, typeName: string, values: readonly string[]) {
    super();
    this.schemaName = schemaName;
    this.typeName = typeName;
    this.values = values;
    this.label = `Create enum type "${typeName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.createEnumType(this);
  }

  toOp(): Op {
    return createEnumType(this.schemaName, this.typeName, this.values);
  }

  renderTypeScript(): string {
    return `createEnumType(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.typeName)}, ${jsonToTsSource(this.values)})`;
  }
}

export class AddEnumValuesCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addEnumValues' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly typeName: string;
  readonly nativeType: string;
  readonly values: readonly string[];
  readonly label: string;

  constructor(schemaName: string, typeName: string, nativeType: string, values: readonly string[]) {
    super();
    this.schemaName = schemaName;
    this.typeName = typeName;
    this.nativeType = nativeType;
    this.values = values;
    this.label = `Add values to enum type "${typeName}": ${values.join(', ')}`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.addEnumValues(this);
  }

  toOp(): Op {
    return addEnumValues(this.schemaName, this.typeName, this.nativeType, this.values);
  }

  renderTypeScript(): string {
    return `addEnumValues(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.typeName)}, ${jsonToTsSource(this.nativeType)}, ${jsonToTsSource(this.values)})`;
  }
}

export class DropEnumTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropEnumType' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly typeName: string;
  readonly label: string;

  constructor(schemaName: string, typeName: string) {
    super();
    this.schemaName = schemaName;
    this.typeName = typeName;
    this.label = `Drop enum type "${typeName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dropEnumType(this);
  }

  toOp(): Op {
    return dropEnumType(this.schemaName, this.typeName);
  }

  renderTypeScript(): string {
    return `dropEnumType(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.typeName)})`;
  }
}

export class RenameTypeCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'renameType' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly fromName: string;
  readonly toName: string;
  readonly label: string;

  constructor(schemaName: string, fromName: string, toName: string) {
    super();
    this.schemaName = schemaName;
    this.fromName = fromName;
    this.toName = toName;
    this.label = `Rename type "${fromName}" to "${toName}"`;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.renameType(this);
  }

  toOp(): Op {
    return renameType(this.schemaName, this.fromName, this.toName);
  }

  renderTypeScript(): string {
    return `renameType(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.fromName)}, ${jsonToTsSource(this.toName)})`;
  }
}

// ============================================================================
// Data transform
// ============================================================================

/**
 * `check` and `run` accept any `TsExpression` — today that's
 * `PlaceholderExpression`, tomorrow it could be e.g. a pre-computed closure
 * expression. `toOp()` converts each body via `bodyToClosure`; anything it
 * doesn't recognize surfaces as a planner bug.
 *
 * When either body is a `PlaceholderExpression`, `toOp()` throws
 * `PN-MIG-2001` — the designed failure mode for unfilled slots.
 */
export class DataTransformCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly check: TsExpression;
  readonly run: TsExpression;

  constructor(
    label: string,
    check: TsExpression,
    run: TsExpression,
    operationClass: MigrationOperationClass = 'data',
  ) {
    super();
    this.label = label;
    this.check = check;
    this.run = run;
    this.operationClass = operationClass;
    this.freeze();
  }

  accept<R>(visitor: PostgresOpFactoryCallVisitor<R>): R {
    return visitor.dataTransform(this);
  }

  toOp(): Op {
    // Both calls throw for PlaceholderExpression bodies (PN-MIG-2001).
    // Future non-placeholder expressions would produce ops instead of throwing.
    return bodyToClosure(this.check)();
  }

  renderTypeScript(): string {
    return `dataTransform(${JSON.stringify(this.label)}, () => ${this.check.renderTypeScript()}, () => ${this.run.renderTypeScript()})`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: this.factoryName },
      ...this.check.importRequirements(),
      ...this.run.importRequirements(),
    ];
  }
}

export type PostgresOpFactoryCall =
  | CreateTableCall
  | DropTableCall
  | AddColumnCall
  | DropColumnCall
  | AlterColumnTypeCall
  | SetNotNullCall
  | DropNotNullCall
  | SetDefaultCall
  | DropDefaultCall
  | AddPrimaryKeyCall
  | AddForeignKeyCall
  | AddUniqueCall
  | CreateIndexCall
  | DropIndexCall
  | DropConstraintCall
  | CreateEnumTypeCall
  | AddEnumValuesCall
  | DropEnumTypeCall
  | RenameTypeCall
  | DataTransformCall;
