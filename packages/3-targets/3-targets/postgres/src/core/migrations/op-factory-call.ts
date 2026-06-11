/**
 * Postgres migration IR: one concrete `*Call` class per pure factory under
 * `operations/`, plus a shared `PostgresOpFactoryCallNode` abstract base.
 *
 * Every call class carries the literal arguments its backing factory would
 * receive, computes a human-readable `label` in its constructor, and
 * implements two polymorphic hooks:
 *
 * - `toOp()` — converts the IR node to a runtime
 *   `SqlMigrationPlanOperation` by delegating to the matching pure factory
 *   under `operations/`. `DataTransformCall.toOp()` always throws
 *   `PN-MIG-2001` because a planner-generated data transform is an
 *   unfilled authoring stub by construction.
 * - `renderTypeScript()` / `importRequirements()` — inherited from
 *   `TsExpression`. Used by `renderCallsToTypeScript` to emit the call as
 *   a TypeScript expression inside the scaffolded `migration.ts`.
 *
 * The abstract base and all concrete classes are package-private. External
 * consumers see only the framework-level `OpFactoryCall` interface and the
 * `PostgresOpFactoryCall` union.
 */

import { errorUnfilledPlaceholder } from '@prisma-next/errors/migration';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer, Lowerer } from '@prisma-next/family-sql/control-adapter';
import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  AnyDdlColumnDefault,
  DdlColumn,
  DdlTableConstraint,
} from '@prisma-next/sql-relational-core/ast';
import { FunctionColumnDefault, LiteralColumnDefault } from '@prisma-next/sql-relational-core/ast';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@prisma-next/ts-render';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import * as contractFreeDdl from '../../contract-free/ddl';
import { escapeLiteral, quoteIdentifier } from '../sql-utils';
import type { PostgresColumnDefault } from '../types';
import {
  alterColumnType,
  dropColumn,
  dropDefault,
  dropNotNull,
  setDefault,
  setNotNull,
} from './operations/columns';
import {
  addCheckConstraint,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  dropCheckConstraint,
  dropConstraint,
} from './operations/constraints';
import { createExtension } from './operations/dependencies';
import { createIndex, dropIndex } from './operations/indexes';
import type { ForeignKeySpec } from './operations/shared';
import { step, targetDetails } from './operations/shared';
import { dropTable } from './operations/tables';
import { columnExistsCheck, toRegclassLiteral } from './planner-sql-checks';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

// Single module specifier emitted in user-edited `migration.ts` imports. The
// Postgres migration facade re-exports both the `*Call` factory names
// (createTable / addColumn / …) and the contract-free DDL builders
// (col / lit / fn / primaryKey / foreignKey / unique) from
// sql-relational-core/contract-free. We emit imports against the facade,
// not against the underlying sql-relational-core subpath, because user
// projects depend on `@prisma-next/postgres` (a runtime dep of every
// init-scaffolded project) — they do not depend on the internal
// `@prisma-next/sql-relational-core` package, so an emitted
// `import … from '@prisma-next/sql-relational-core/contract-free'` fails
// ESM resolution at runtime in user migrations even though pnpm has the
// transitive package on disk.
const POSTGRES_MIGRATION_FACADE = '@prisma-next/postgres/migration';

function boundSchema(schemaName: string): string | undefined {
  return schemaName === UNBOUND_NAMESPACE_ID ? undefined : schemaName;
}

abstract class PostgresOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(lowerer?: Lowerer): Op | Promise<Op>;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

// ============================================================================
// Table
// ============================================================================

export function postgresDefaultToDdlColumnDefault(
  columnDefault: PostgresColumnDefault | undefined,
): DdlColumn['default'] {
  if (!columnDefault) return undefined;
  switch (columnDefault.kind) {
    case 'literal':
      return new LiteralColumnDefault(columnDefault.value);
    case 'function':
      if (columnDefault.expression === 'autoincrement()') return undefined;
      return new FunctionColumnDefault(columnDefault.expression);
    case 'sequence':
      return new FunctionColumnDefault(
        `nextval('${escapeLiteral(quoteIdentifier(columnDefault.name))}'::regclass)`,
      );
    default: {
      const exhaustive: never = columnDefault;
      throw new Error(
        `postgresDefaultToDdlColumnDefault: unhandled kind "${blindCast<{ kind: string }, 'exhaustiveness: surface the unhandled default kind'>(exhaustive).kind}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// TypeScript rendering helpers for DdlColumn / DdlTableConstraint
// ---------------------------------------------------------------------------

function renderDdlColumnDefault(def: AnyDdlColumnDefault | undefined): string {
  if (!def) return '';
  if (def.kind === 'literal') {
    return `lit(${jsonToTsSource(def.value)})`;
  }
  return `fn(${jsonToTsSource(def.expression)})`;
}

function renderDdlColumnAsTsCall(col: DdlColumn): string {
  const opts: string[] = [];
  if (col.notNull) opts.push('notNull: true');
  if (col.primaryKey) opts.push('primaryKey: true');
  if (col.default) opts.push(`default: ${renderDdlColumnDefault(col.default)}`);
  const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
  return `col(${jsonToTsSource(col.name)}, ${jsonToTsSource(col.type)}${optsStr})`;
}

function renderDdlConstraintAsTsCall(constraint: DdlTableConstraint): string {
  switch (constraint.kind) {
    case 'primary-key': {
      const nameOpt = constraint.name ? `, { name: ${jsonToTsSource(constraint.name)} }` : '';
      return `primaryKey(${jsonToTsSource(constraint.columns)}${nameOpt})`;
    }
    case 'foreign-key': {
      const opts: string[] = [];
      if (constraint.name) opts.push(`name: ${jsonToTsSource(constraint.name)}`);
      if (constraint.onDelete) opts.push(`onDelete: ${jsonToTsSource(constraint.onDelete)}`);
      if (constraint.onUpdate) opts.push(`onUpdate: ${jsonToTsSource(constraint.onUpdate)}`);
      const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
      return `foreignKey(${jsonToTsSource(constraint.columns)}, ${jsonToTsSource(constraint.refTable)}, ${jsonToTsSource(constraint.refColumns)}${optsStr})`;
    }
    case 'unique': {
      const nameOpt = constraint.name ? `, { name: ${jsonToTsSource(constraint.name)} }` : '';
      return `unique(${jsonToTsSource(constraint.columns)}${nameOpt})`;
    }
  }
}

function needsColOrConstraintImport(columns: readonly DdlColumn[]): boolean {
  return columns.length > 0;
}

function constraintImportSymbols(constraints: readonly DdlTableConstraint[] | undefined): string[] {
  if (!constraints || constraints.length === 0) return [];
  const symbols = new Set<string>();
  for (const c of constraints) {
    if (c.kind === 'primary-key') symbols.add('primaryKey');
    else if (c.kind === 'foreign-key') symbols.add('foreignKey');
    else if (c.kind === 'unique') symbols.add('unique');
  }
  return [...symbols];
}

function defaultImportSymbols(columns: readonly DdlColumn[]): string[] {
  const symbols = new Set<string>();
  for (const col of columns) {
    if (col.default?.kind === 'literal') symbols.add('lit');
    else if (col.default?.kind === 'function') symbols.add('fn');
  }
  return [...symbols];
}

export class CreateTableCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createTable' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly columns: readonly DdlColumn[];
  readonly constraints: readonly DdlTableConstraint[] | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    columns: readonly DdlColumn[],
    constraints?: readonly DdlTableConstraint[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.columns = Object.freeze([...columns]);
    this.constraints = constraints ? Object.freeze([...constraints]) : undefined;
    this.label = `Create table "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw new Error(
        `CreateTableCall.toOp: a DDL lowerer is required on the Postgres planner path (table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
      );
    }
    const ddlNode = contractFreeDdl.createTable({
      ...ifDefined('schema', boundSchema(this.schemaName)),
      table: this.tableName,
      columns: this.columns,
      ...ifDefined('constraints', this.constraints),
    });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const schemaName = this.schemaName;
    const tableName = this.tableName;
    return {
      id: `table.${tableName}`,
      label: `Create table "${tableName}"`,
      summary: `Creates table "${tableName}"`,
      operationClass: 'additive',
      target: targetDetails('table', tableName, schemaName),
      precheck: [
        step(
          `ensure table "${tableName}" does not exist`,
          `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
        ),
      ],
      execute: [
        {
          description: `create table "${tableName}"`,
          sql: statement.sql,
          params: statement.params ?? [],
        },
      ],
      postcheck: [
        step(
          `verify table "${tableName}" exists`,
          `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
        ),
      ],
    };
  }

  renderTypeScript(): string {
    const columnsList = this.columns.map(renderDdlColumnAsTsCall).join(', ');
    const constraintsList = this.constraints
      ? this.constraints.map(renderDdlConstraintAsTsCall).join(', ')
      : undefined;

    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`columns: [${columnsList}]`);
    if (constraintsList) opts.push(`constraints: [${constraintsList}]`);

    return `this.createTable({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    const req: ImportRequirement[] = [];
    if (needsColOrConstraintImport(this.columns)) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'col' });
      for (const sym of defaultImportSymbols(this.columns)) {
        req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
      }
    }
    for (const sym of constraintImportSymbols(this.constraints)) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
    }
    return req;
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
  readonly column: DdlColumn;
  readonly label: string;

  constructor(schemaName: string, tableName: string, column: DdlColumn) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.column = column;
    this.label = `Add column "${column.name}" to "${tableName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw new Error(
        `AddColumnCall.toOp: a DDL lowerer is required on the Postgres planner path (column "${this.column.name}" on table "${this.tableName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
      );
    }
    const ddlNode = contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(this.schemaName)),
      table: this.tableName,
      actions: [contractFreeDdl.addColumnAction(this.column)],
    });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const schemaName = this.schemaName;
    const tableName = this.tableName;
    const columnName = this.column.name;
    return {
      id: `column.${tableName}.${columnName}`,
      label: `Add column "${columnName}" to "${tableName}"`,
      operationClass: 'additive',
      target: targetDetails('column', columnName, schemaName, tableName),
      precheck: [
        step(
          `ensure column "${columnName}" is missing`,
          columnExistsCheck({
            schema: schemaName,
            table: tableName,
            column: columnName,
            exists: false,
          }),
        ),
      ],
      execute: [step(`add column "${columnName}"`, statement.sql)],
      postcheck: [
        step(
          `verify column "${columnName}" exists`,
          columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
        ),
      ],
    };
  }

  renderTypeScript(): string {
    const opts: string[] = [];
    if (this.schemaName !== UNBOUND_NAMESPACE_ID) {
      opts.push(`schema: ${jsonToTsSource(this.schemaName)}`);
    }
    opts.push(`table: ${jsonToTsSource(this.tableName)}`);
    opts.push(`column: ${renderDdlColumnAsTsCall(this.column)}`);
    return `this.addColumn({ ${opts.join(', ')} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    const req: ImportRequirement[] = [
      { moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'col' },
    ];
    for (const sym of defaultImportSymbols([this.column])) {
      req.push({ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: sym });
    }
    return req;
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

export class AddCheckConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'addCheckConstraint' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly column: string;
  readonly values: readonly string[];
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    constraintName: string,
    column: string,
    values: readonly string[],
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.column = column;
    this.values = values;
    this.label = `Add check constraint "${constraintName}" on "${tableName}"."${column}"`;
    this.freeze();
  }

  toOp(): Op {
    return addCheckConstraint(
      this.schemaName,
      this.tableName,
      this.constraintName,
      this.column,
      this.values,
    );
  }

  renderTypeScript(): string {
    return `addCheckConstraint(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.constraintName)}, ${jsonToTsSource(this.column)}, ${jsonToTsSource(this.values)})`;
  }
}

export class DropCheckConstraintCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dropCheckConstraint' as const;
  readonly operationClass = 'destructive' as const;
  readonly schemaName: string;
  readonly tableName: string;
  readonly constraintName: string;
  readonly label: string;

  constructor(schemaName: string, tableName: string, constraintName: string) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.constraintName = constraintName;
    this.label = `Drop check constraint "${constraintName}" on "${tableName}"`;
    this.freeze();
  }

  toOp(): Op {
    return dropCheckConstraint(this.schemaName, this.tableName, this.constraintName);
  }

  renderTypeScript(): string {
    return `dropCheckConstraint(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.constraintName)})`;
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
  // Named indexType (not typeName) to avoid collision with CreateEnumTypeCall.typeName,
  // which identifies a CREATE TYPE target and is read by `locationForCall` in issue-planner.ts.
  readonly indexType: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  readonly label: string;

  constructor(
    schemaName: string,
    tableName: string,
    indexName: string,
    columns: readonly string[],
    extras?: { readonly type?: string; readonly options?: Record<string, unknown> },
  ) {
    super();
    this.schemaName = schemaName;
    this.tableName = tableName;
    this.indexName = indexName;
    this.columns = columns;
    this.indexType = extras?.type;
    this.options = extras?.options;
    this.label = `Create index "${indexName}" on "${tableName}"`;
    this.freeze();
  }

  toOp(): Op {
    const extras: { type?: string; options?: Record<string, unknown> } = {};
    if (this.indexType !== undefined) extras.type = this.indexType;
    if (this.options !== undefined) extras.options = this.options;
    return createIndex(this.schemaName, this.tableName, this.indexName, this.columns, extras);
  }

  renderTypeScript(): string {
    const args = [
      jsonToTsSource(this.schemaName),
      jsonToTsSource(this.tableName),
      jsonToTsSource(this.indexName),
      jsonToTsSource(this.columns),
    ];
    if (this.indexType !== undefined || this.options !== undefined) {
      const extrasParts: string[] = [];
      if (this.indexType !== undefined) extrasParts.push(`type: ${jsonToTsSource(this.indexType)}`);
      if (this.options !== undefined) extrasParts.push(`options: ${jsonToTsSource(this.options)}`);
      args.push(`{ ${extrasParts.join(', ')} }`);
    }
    return `createIndex(${args.join(', ')})`;
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

  toOp(): Op {
    return dropIndex(this.schemaName, this.tableName, this.indexName);
  }

  renderTypeScript(): string {
    return `dropIndex(${jsonToTsSource(this.schemaName)}, ${jsonToTsSource(this.tableName)}, ${jsonToTsSource(this.indexName)})`;
  }
}

// ============================================================================
// Raw SQL
// ============================================================================

/**
 * Laundered pre-built operation.
 *
 * Wraps an already-materialized `SqlMigrationPlanOperation` — typically one
 * produced by a SQL-family method or a codec control hook — so the planner
 * can carry it alongside IR nodes without reverse-engineering it into a
 * structured call class. Doubles as the user-facing escape hatch for raw
 * migrations: authors can pass a full op shape to `rawSql({...})`.
 *
 * `toOp()` returns the stored op unchanged. `renderTypeScript()` emits
 * `rawSql({...})` with the op serialized as a JSON literal — round-tripping
 * requires every field on the op to be JSON-serializable (no closures).
 */
export class RawSqlCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'rawSql' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly op: Op;

  constructor(op: Op) {
    super();
    this.op = op;
    this.label = op.label;
    this.operationClass = op.operationClass;
    this.freeze();
  }

  toOp(): Op {
    return this.op;
  }

  renderTypeScript(): string {
    return `rawSql(${jsonToTsSource(this.op)})`;
  }
}

// ============================================================================
// Database dependencies (structured DDL)
// ============================================================================

export class CreateExtensionCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createExtension' as const;
  readonly operationClass = 'additive' as const;
  readonly extensionName: string;
  readonly label: string;

  constructor(extensionName: string) {
    super();
    this.extensionName = extensionName;
    this.label = `Create extension "${extensionName}"`;
    this.freeze();
  }

  toOp(): Op {
    return createExtension(this.extensionName);
  }

  renderTypeScript(): string {
    return `createExtension(${jsonToTsSource(this.extensionName)})`;
  }
}

export class CreateSchemaCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'createSchema' as const;
  readonly operationClass = 'additive' as const;
  readonly schemaName: string;
  readonly label: string;

  constructor(schemaName: string) {
    super();
    this.schemaName = schemaName;
    this.label = `Create schema "${schemaName}"`;
    this.freeze();
  }

  async toOp(lowerer?: ExecuteRequestLowerer): Promise<Op> {
    if (lowerer === undefined) {
      throw new Error(
        `CreateSchemaCall.toOp: a DDL lowerer is required on the Postgres planner path (schema "${this.schemaName}"). Pass the control adapter to createPostgresMigrationPlanner.`,
      );
    }
    const ddlNode = contractFreeDdl.createSchema({ schema: this.schemaName, ifNotExists: true });
    const statement = await lowerer.lowerToExecuteRequest(ddlNode);
    const schemaName = this.schemaName;
    return {
      id: `schema.${schemaName}`,
      label: `Create schema "${schemaName}"`,
      operationClass: 'additive',
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `Create schema "${schemaName}"`,
          sql: statement.sql,
          params: statement.params ?? [],
        },
      ],
      postcheck: [],
    };
  }

  renderTypeScript(): string {
    return `this.createSchema({ schema: ${jsonToTsSource(this.schemaName)} })`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

// ============================================================================
// Data transform
// ============================================================================

/**
 * A planner-generated data-transform stub. `checkSlot` and `runSlot` name
 * the unfilled authoring slots that the rendered `migration.ts` will expose
 * to the user via `placeholder("…")` calls. `toOp()` always throws
 * `PN-MIG-2001`: the planner cannot lower a stubbed transform to a runtime
 * op — the user must fill the rendered `migration.ts` and re-emit.
 */
export class DataTransformCall extends PostgresOpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  readonly checkSlot: string;
  readonly runSlot: string;

  constructor(
    label: string,
    checkSlot: string,
    runSlot: string,
    operationClass: MigrationOperationClass = 'data',
  ) {
    super();
    this.label = label;
    this.checkSlot = checkSlot;
    this.runSlot = runSlot;
    this.operationClass = operationClass;
    this.freeze();
  }

  toOp(): Op {
    throw errorUnfilledPlaceholder(this.label);
  }

  renderTypeScript(): string {
    return [
      `this.dataTransform(endContract, ${jsonToTsSource(this.label)}, {`,
      `  check: () => placeholder(${jsonToTsSource(this.checkSlot)}),`,
      `  run: () => placeholder(${jsonToTsSource(this.runSlot)}),`,
      '})',
    ].join('\n');
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: 'placeholder' },
      {
        moduleSpecifier: './end-contract.json',
        symbol: 'endContract',
        kind: 'default',
        attributes: { type: 'json' },
      },
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
  | AddCheckConstraintCall
  | DropCheckConstraintCall
  | CreateIndexCall
  | DropIndexCall
  | DropConstraintCall
  | RawSqlCall
  | CreateExtensionCall
  | CreateSchemaCall
  | DataTransformCall;
