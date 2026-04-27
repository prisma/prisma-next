import type { MigrationOperationClass } from '@prisma-next/family-sql/control';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { quoteIdentifier } from '../../sql-utils';
import { buildCreateIndexSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import {
  esc,
  type Op,
  renderColumnDefinition,
  renderForeignKeyClause,
  type SqliteColumnSpec,
  type SqliteIndexSpec,
  type SqliteTableSpec,
  step,
} from './shared';

/**
 * Renders the body of a `CREATE TABLE <name> ( … )` statement from a flat
 * `SqliteTableSpec`. SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT` form is
 * inline on the column; the table-level PRIMARY KEY clause is emitted only
 * when no column carries `inlineAutoincrementPrimaryKey`.
 */
function renderCreateTableSql(tableName: string, spec: SqliteTableSpec): string {
  const columnDefs = spec.columns.map(renderColumnDefinition);

  const constraintDefs: string[] = [];
  const hasInlinePk = spec.columns.some((c) => c.inlineAutoincrementPrimaryKey);
  if (spec.primaryKey && !hasInlinePk) {
    constraintDefs.push(`PRIMARY KEY (${spec.primaryKey.columns.map(quoteIdentifier).join(', ')})`);
  }

  for (const u of spec.uniques ?? []) {
    const name = u.name ? `CONSTRAINT ${quoteIdentifier(u.name)} ` : '';
    constraintDefs.push(`${name}UNIQUE (${u.columns.map(quoteIdentifier).join(', ')})`);
  }

  for (const fk of spec.foreignKeys ?? []) {
    const clause = renderForeignKeyClause(fk);
    if (clause) constraintDefs.push(clause);
  }

  const allDefs = [...columnDefs, ...constraintDefs];
  return `CREATE TABLE ${quoteIdentifier(tableName)} (\n  ${allDefs.join(',\n  ')}\n)`;
}

export function createTable(tableName: string, spec: SqliteTableSpec): Op {
  return {
    id: `table.${tableName}`,
    label: `Create table ${tableName}`,
    summary: `Creates table ${tableName} with required columns`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [
      step(
        `ensure table "${tableName}" does not exist`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
      ),
    ],
    execute: [step(`create table "${tableName}"`, renderCreateTableSql(tableName, spec))],
    postcheck: [
      step(
        `verify table "${tableName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
      ),
    ],
  };
}

export function dropTable(tableName: string): Op {
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table ${tableName}`,
    summary: `Drops table ${tableName} which is not in the contract`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [
      step(
        `ensure table "${tableName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
      ),
    ],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${quoteIdentifier(tableName)}`)],
    postcheck: [
      step(
        `verify table "${tableName}" is gone`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
      ),
    ],
  };
}

export interface RecreateTableArgs {
  readonly tableName: string;
  /** New (post-recreate) shape of the table. Same flat spec as `createTable`. */
  readonly contractTable: SqliteTableSpec;
  /**
   * Names of columns that exist in the live (pre-recreate) schema. Used to
   * compute the `INSERT INTO temp ... SELECT ... FROM old` column list — only
   * shared columns are copied, so dropped columns are left behind and added
   * columns come from defaults.
   */
  readonly schemaColumnNames: readonly string[];
  /**
   * Indexes (declared + FK-backing, deduped by column-set) to recreate after
   * the table has been replaced. The planner pre-merges these.
   */
  readonly indexes: readonly SqliteIndexSpec[];
  readonly issues: readonly SchemaIssue[];
  readonly operationClass: MigrationOperationClass;
}

export function recreateTable(args: RecreateTableArgs): Op {
  const { tableName, contractTable, schemaColumnNames, indexes, issues, operationClass } = args;
  const tempName = `_prisma_new_${tableName}`;
  const liveSet = new Set(schemaColumnNames);
  const sharedColumns = contractTable.columns.filter((c) => liveSet.has(c.name)).map((c) => c.name);
  const columnList = sharedColumns.map(quoteIdentifier).join(', ');
  const issueDescriptions = issues.map((i) => i.message).join('; ');

  const indexStatements = indexes.map((idx) => ({
    description: `recreate index "${idx.name}" on "${tableName}"`,
    sql: buildCreateIndexSql(tableName, idx.name, idx.columns),
  }));

  return {
    id: `recreateTable.${tableName}`,
    label: `Recreate table ${tableName}`,
    summary: `Recreates table ${tableName} to apply schema changes: ${issueDescriptions}`,
    operationClass,
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [
      step(
        `ensure table "${tableName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
      ),
      step(
        `ensure temp table "${tempName}" does not exist`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tempName)}'`,
      ),
    ],
    execute: [
      step(
        `create new table "${tempName}" with desired schema`,
        renderCreateTableSql(tempName, contractTable),
      ),
      step(
        `copy data from "${tableName}" to "${tempName}"`,
        `INSERT INTO ${quoteIdentifier(tempName)} (${columnList}) SELECT ${columnList} FROM ${quoteIdentifier(tableName)}`,
      ),
      step(`drop old table "${tableName}"`, `DROP TABLE ${quoteIdentifier(tableName)}`),
      step(
        `rename "${tempName}" to "${tableName}"`,
        `ALTER TABLE ${quoteIdentifier(tempName)} RENAME TO ${quoteIdentifier(tableName)}`,
      ),
      ...indexStatements,
    ],
    postcheck: [
      step(
        `verify table "${tableName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
      ),
      step(
        `verify temp table "${tempName}" is gone`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tempName)}'`,
      ),
      ...buildIssuePostchecks(tableName, issues, contractTable.columns),
    ],
  };
}

/**
 * Per-issue postchecks verifying the recreated table's column shape. Reads
 * expectations from the flat `SqliteColumnSpec`s embedded in the spec —
 * `typeSql` is the upper-cased native type and `defaultSql` is the
 * pre-rendered DEFAULT clause.
 */
function buildIssuePostchecks(
  tableName: string,
  issues: readonly SchemaIssue[],
  columns: readonly SqliteColumnSpec[],
): Array<{ description: string; sql: string }> {
  const checks: Array<{ description: string; sql: string }> = [];
  const t = esc(tableName);
  const byName = new Map(columns.map((c) => [c.name, c]));

  for (const issue of issues) {
    if (issue.kind === 'enum_values_changed') continue;
    if (!issue.column) continue;
    const c = esc(issue.column);
    if (issue.kind === 'nullability_mismatch') {
      const wantNotNull = issue.expected !== 'true';
      checks.push({
        description: `verify "${issue.column}" nullability on "${tableName}"`,
        sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND "notnull" = ${wantNotNull ? 1 : 0}`,
      });
    }
    if (issue.kind === 'default_mismatch' || issue.kind === 'default_missing') {
      const spec = byName.get(issue.column);
      const expectedRaw = spec?.defaultSql.startsWith('DEFAULT ')
        ? spec.defaultSql.slice('DEFAULT '.length)
        : null;
      if (expectedRaw) {
        checks.push({
          description: `verify "${issue.column}" default on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND dflt_value = '${esc(expectedRaw)}'`,
        });
      }
    }
    if (issue.kind === 'type_mismatch') {
      const spec = byName.get(issue.column);
      if (spec) {
        checks.push({
          description: `verify "${issue.column}" type on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND LOWER(type) = '${esc(spec.typeSql.toLowerCase())}'`,
        });
      }
    }
    if (issue.kind === 'extra_default') {
      checks.push({
        description: `verify "${issue.column}" has no default on "${tableName}"`,
        sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND dflt_value IS NULL`,
      });
    }
  }
  return checks;
}
