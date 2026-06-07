import type { MigrationOperationClass } from '@prisma-next/family-sql/control';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { stripOuterParens } from '../../default-normalizer';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { buildCreateIndexSql } from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import {
  type Op,
  renderColumnDefinition,
  renderForeignKeyClause,
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
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}'`,
      ),
    ],
    execute: [step(`create table "${tableName}"`, renderCreateTableSql(tableName, spec))],
    postcheck: [
      step(
        `verify table "${tableName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}'`,
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
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}'`,
      ),
    ],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${quoteIdentifier(tableName)}`)],
    postcheck: [
      step(
        `verify table "${tableName}" is gone`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}'`,
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
  /** Human-readable summary of the change, built by the planner from issues. */
  readonly summary: string;
  /**
   * Per-issue postcheck steps appended after the structural postchecks. The
   * planner pre-builds these via `buildRecreatePostchecks` so the call IR
   * carries flat, serializable data only — no `SchemaIssue` references.
   */
  readonly postchecks: readonly { readonly description: string; readonly sql: string }[];
  readonly operationClass: MigrationOperationClass;
}

export function recreateTable(args: RecreateTableArgs): Op {
  const {
    tableName,
    contractTable,
    schemaColumnNames,
    indexes,
    summary,
    postchecks,
    operationClass,
  } = args;
  const tempName = `_prisma_new_${tableName}`;
  const liveSet = new Set(schemaColumnNames);
  const sharedColumns = contractTable.columns.filter((c) => liveSet.has(c.name)).map((c) => c.name);
  const columnList = sharedColumns.map(quoteIdentifier).join(', ');

  const indexStatements = indexes.map((idx) => ({
    description: `recreate index "${idx.name}" on "${tableName}"`,
    sql: buildCreateIndexSql(tableName, idx.name, idx.columns),
  }));

  // If the contract retains no columns from the live table, an `INSERT INTO
  // tmp () SELECT FROM old` is invalid SQL — and would also be a no-op since
  // there's nothing to copy. Skip the copy step in that case; the new
  // (empty) table replaces the old one directly.
  const copyStep =
    sharedColumns.length > 0
      ? [
          step(
            `copy data from "${tableName}" to "${tempName}"`,
            `INSERT INTO ${quoteIdentifier(tempName)} (${columnList}) SELECT ${columnList} FROM ${quoteIdentifier(tableName)}`,
          ),
        ]
      : [];

  return {
    id: `recreateTable.${tableName}`,
    label: `Recreate table ${tableName}`,
    summary,
    operationClass,
    target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
    precheck: [
      step(
        `ensure table "${tableName}" exists`,
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}'`,
      ),
      step(
        `ensure temp table "${tempName}" does not exist`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tempName)}'`,
      ),
    ],
    execute: [
      step(
        `create new table "${tempName}" with desired schema`,
        renderCreateTableSql(tempName, contractTable),
      ),
      ...copyStep,
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
        `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tableName)}'`,
      ),
      step(
        `verify temp table "${tempName}" is gone`,
        `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeLiteral(tempName)}'`,
      ),
      ...postchecks,
    ],
  };
}

/**
 * Build a one-line summary of a recreate-table operation from the schema
 * issues that triggered it. Lives next to `recreateTable` so the planner
 * (which has the issues) can produce the same description the factory
 * used to build inline. Keeping the formatting target-side keeps
 * `RecreateTableCall` issue-free at the IR layer.
 */
export function buildRecreateSummary(tableName: string, issues: readonly SchemaIssue[]): string {
  const messages = issues.map((i) => i.message).join('; ');
  return `Recreates table ${tableName} to apply schema changes: ${messages}`;
}

const COLUMN_LEVEL_ISSUE_KINDS = new Set<SchemaIssue['kind']>([
  'nullability_mismatch',
  'default_mismatch',
  'default_missing',
  'extra_default',
  'type_mismatch',
]);

const PK_ISSUE_KINDS = new Set<SchemaIssue['kind']>(['primary_key_mismatch', 'extra_primary_key']);

const UNIQUE_ISSUE_KINDS = new Set<SchemaIssue['kind']>([
  'unique_constraint_mismatch',
  'extra_unique_constraint',
]);

const FK_ISSUE_KINDS = new Set<SchemaIssue['kind']>(['foreign_key_mismatch', 'extra_foreign_key']);

/**
 * Returns the columns the contract expects as the table's primary key. Picks
 * up SQLite's inline `INTEGER PRIMARY KEY AUTOINCREMENT` form when no
 * explicit `primaryKey` clause is set on the spec.
 */
function expectedPrimaryKeyColumns(spec: SqliteTableSpec): readonly string[] {
  if (spec.primaryKey) return spec.primaryKey.columns;
  const inlinePk = spec.columns.find((c) => c.inlineAutoincrementPrimaryKey);
  return inlinePk ? [inlinePk.name] : [];
}

function quoteSqlList(values: readonly string[]): string {
  return values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
}

/**
 * Per-issue postchecks verifying the recreated table's shape against the
 * contract spec. Column-level issues (`nullability_mismatch`,
 * `default_mismatch`, …) emit one targeted check each; constraint-level
 * issues (`primary_key_mismatch`, `unique_constraint_mismatch`,
 * `foreign_key_mismatch`, plus their `extra_*` siblings) emit one
 * `pragma_*`-driven check per declared constraint in the contract spec, so
 * a recreated table with the right columns but the wrong PK / unique / FK
 * shape fails the postcheck instead of passing silently. Exported so the
 * planner can pre-build the list at construction time and
 * `RecreateTableCall` doesn't have to carry `SchemaIssue` objects through
 * to render time.
 */
export function buildRecreatePostchecks(
  tableName: string,
  issues: readonly SchemaIssue[],
  spec: SqliteTableSpec,
): Array<{ description: string; sql: string }> {
  const checks: Array<{ description: string; sql: string }> = [];
  const t = escapeLiteral(tableName);
  const byName = new Map(spec.columns.map((c) => [c.name, c]));

  for (const issue of issues) {
    if (issue.kind === 'enum_values_changed') continue;
    if (!COLUMN_LEVEL_ISSUE_KINDS.has(issue.kind)) continue;
    if (!issue.column) continue;
    const c = escapeLiteral(issue.column);
    if (issue.kind === 'nullability_mismatch') {
      // `expected` carries the contract's nullable flag as a string. We only
      // emit a postcheck when the value is recognized — anything else
      // (case-folded, numeric coding, etc.) is left to the structural
      // verifier so a typo here can't silently invert the meaning.
      let wantNotNull: boolean | undefined;
      if (issue.expected === 'false') wantNotNull = true;
      else if (issue.expected === 'true') wantNotNull = false;
      if (wantNotNull !== undefined) {
        checks.push({
          description: `verify "${issue.column}" nullability on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND "notnull" = ${wantNotNull ? 1 : 0}`,
        });
      }
    }
    if (issue.kind === 'default_mismatch' || issue.kind === 'default_missing') {
      const colSpec = byName.get(issue.column);
      const expectedRaw = colSpec?.defaultSql.startsWith('DEFAULT ')
        ? // SQLite's pragma_table_info.dflt_value strips outer parens for
          // expression defaults (per the SQLite docs), so `(datetime('now'))`
          // is stored as `datetime('now')`. Strip them here so the postcheck
          // matches.
          stripOuterParens(colSpec.defaultSql.slice('DEFAULT '.length))
        : null;
      if (expectedRaw) {
        checks.push({
          description: `verify "${issue.column}" default on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND dflt_value = '${escapeLiteral(expectedRaw)}'`,
        });
      }
    }
    if (issue.kind === 'type_mismatch') {
      const colSpec = byName.get(issue.column);
      if (colSpec) {
        checks.push({
          description: `verify "${issue.column}" type on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND LOWER(type) = '${escapeLiteral(colSpec.typeSql.toLowerCase())}'`,
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

  // Constraint-level issues — emit one postcheck per declared constraint in
  // the contract spec when *any* issue of that kind fires, since recreate
  // rebuilds the entire table at once.
  const hasPkIssue = issues.some((i) => PK_ISSUE_KINDS.has(i.kind));
  const hasUniqueIssue = issues.some((i) => UNIQUE_ISSUE_KINDS.has(i.kind));
  const hasFkIssue = issues.some((i) => FK_ISSUE_KINDS.has(i.kind));

  if (hasPkIssue) {
    const pkColumns = expectedPrimaryKeyColumns(spec);
    // Verify pragma_table_info reports exactly these columns as PK members
    // (count + named membership); zero columns expected ⇒ no PK at all.
    const colCount = pkColumns.length;
    if (colCount === 0) {
      checks.push({
        description: `verify "${tableName}" has no primary key`,
        sql: `SELECT (SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE pk > 0) = 0`,
      });
    } else {
      checks.push({
        description: `verify primary key on "${tableName}"`,
        sql:
          `SELECT (SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE pk > 0) = ${colCount}` +
          ` AND (SELECT COUNT(*) FROM pragma_table_info('${t}') WHERE pk > 0 AND name IN (${quoteSqlList(pkColumns)})) = ${colCount}`,
      });
    }
  }

  if (hasUniqueIssue) {
    for (const u of spec.uniques ?? []) {
      const colCount = u.columns.length;
      const description = u.name
        ? `verify unique constraint "${u.name}" on "${tableName}"`
        : `verify unique constraint (${u.columns.join(', ')}) on "${tableName}"`;
      // Match any unique index whose covered columns are exactly the expected
      // set. Order is intentionally not checked — SQLite's unique-index
      // identity is column-set, not column-sequence.
      checks.push({
        description,
        sql:
          `SELECT EXISTS (SELECT 1 FROM pragma_index_list('${t}') l` +
          ` WHERE l."unique" = 1` +
          ` AND (SELECT COUNT(*) FROM pragma_index_info(l.name)) = ${colCount}` +
          ` AND (SELECT COUNT(*) FROM pragma_index_info(l.name) WHERE name IN (${quoteSqlList(u.columns)})) = ${colCount})`,
      });
    }
  }

  if (hasFkIssue) {
    for (const fk of spec.foreignKeys ?? []) {
      const refTable = escapeLiteral(fk.references.table);
      const colCount = fk.columns.length;
      // Build a `SUM(CASE WHEN ("from","to") IN ((…)) …)` so the check works
      // for both single- and multi-column FKs without depending on FK row
      // ordering inside `pragma_foreign_key_list`.
      const tuples = fk.columns
        .map((from, i) => {
          const to = fk.references.columns[i] ?? from;
          return `('${escapeLiteral(from)}', '${escapeLiteral(to)}')`;
        })
        .join(', ');
      const description = `verify foreign key (${fk.columns.join(', ')}) → ${fk.references.table}(${fk.references.columns.join(', ')}) on "${tableName}"`;
      checks.push({
        description,
        sql:
          `SELECT EXISTS (SELECT 1 FROM pragma_foreign_key_list('${t}') f` +
          ` WHERE f."table" = '${refTable}'` +
          ' GROUP BY f.id' +
          ` HAVING COUNT(*) = ${colCount}` +
          ` AND SUM(CASE WHEN (f."from", f."to") IN (${tuples}) THEN 1 ELSE 0 END) = ${colCount})`,
      });
    }
  }

  return checks;
}
