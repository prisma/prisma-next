import { quoteIdentifier } from '@prisma-next/adapter-sqlite/control';
import type { CodecControlHooks, MigrationOperationClass } from '@prisma-next/family-sql/control';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { StorageTable, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import {
  buildColumnDefaultSql,
  buildCreateIndexSql,
  buildCreateTableSql,
} from '../planner-ddl-builders';
import { buildTargetDetails } from '../planner-target-details';
import { esc, type Op, step } from './shared';

export function createTable(
  tableName: string,
  table: StorageTable,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance>,
): Op {
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
    execute: [
      step(
        `create table "${tableName}"`,
        buildCreateTableSql(tableName, table, codecHooks, storageTypes),
      ),
    ],
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
  readonly contractTable: StorageTable;
  readonly schemaTable: SqlTableIR;
  readonly issues: readonly SchemaIssue[];
  readonly operationClass: MigrationOperationClass;
  readonly codecHooks: Map<string, CodecControlHooks>;
  readonly storageTypes: Record<string, StorageTypeInstance>;
}

export function recreateTable(args: RecreateTableArgs): Op {
  const {
    tableName,
    contractTable,
    schemaTable,
    issues,
    operationClass,
    codecHooks,
    storageTypes,
  } = args;
  const tempName = `_prisma_new_${tableName}`;
  const sharedColumns = Object.keys(contractTable.columns).filter(
    (col) => schemaTable.columns[col] !== undefined,
  );
  const columnList = sharedColumns.map(quoteIdentifier).join(', ');
  const issueDescriptions = issues.map((i) => i.message).join('; ');

  // FK-backing indexes are folded in alongside explicit indexes — same DDL,
  // same recreate-step description. Dedup on column-set so an explicit index
  // covering the same columns as an `index: true` FK isn't emitted twice.
  const indexStatements: Array<{ description: string; sql: string }> = [];
  const seenIndexColumnKeys = new Set<string>();
  const recreateableIndexes: Array<{ name: string; columns: readonly string[] }> = [
    ...contractTable.indexes.map((idx) => ({
      name: idx.name ?? defaultIndexName(tableName, idx.columns),
      columns: idx.columns,
    })),
    ...contractTable.foreignKeys
      .filter((fk) => fk.index !== false)
      .map((fk) => ({
        name: defaultIndexName(tableName, fk.columns),
        columns: fk.columns,
      })),
  ];
  for (const idx of recreateableIndexes) {
    const key = idx.columns.join(',');
    if (seenIndexColumnKeys.has(key)) continue;
    seenIndexColumnKeys.add(key);
    indexStatements.push({
      description: `recreate index "${idx.name}" on "${tableName}"`,
      sql: buildCreateIndexSql(tableName, idx.name, idx.columns),
    });
  }

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
        buildCreateTableSql(tempName, contractTable, codecHooks, storageTypes),
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
      ...buildIssuePostchecks(tableName, issues, contractTable),
    ],
  };
}

function buildIssuePostchecks(
  tableName: string,
  issues: readonly SchemaIssue[],
  contractTable: StorageTable,
): Array<{ description: string; sql: string }> {
  const checks: Array<{ description: string; sql: string }> = [];
  const t = esc(tableName);

  for (const issue of issues) {
    if (issue.kind === 'enum_values_changed') continue;
    if (issue.column) {
      const c = esc(issue.column);
      if (issue.kind === 'nullability_mismatch') {
        const wantNotNull = issue.expected !== 'true';
        checks.push({
          description: `verify "${issue.column}" nullability on "${tableName}"`,
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND "notnull" = ${wantNotNull ? 1 : 0}`,
        });
      }
      if (issue.kind === 'default_mismatch' || issue.kind === 'default_missing') {
        const contractColumn = contractTable.columns[issue.column];
        const rendered = contractColumn
          ? buildColumnDefaultSql(contractColumn.default, contractColumn)
          : '';
        const expectedRaw = rendered.startsWith('DEFAULT ')
          ? rendered.slice('DEFAULT '.length)
          : null;
        if (expectedRaw) {
          checks.push({
            description: `verify "${issue.column}" default on "${tableName}"`,
            sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND dflt_value = '${esc(expectedRaw)}'`,
          });
        }
      }
      if (issue.kind === 'type_mismatch') {
        const contractColumn = contractTable.columns[issue.column];
        if (contractColumn) {
          checks.push({
            description: `verify "${issue.column}" type on "${tableName}"`,
            sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${t}') WHERE name = '${c}' AND LOWER(type) = '${esc(contractColumn.nativeType.toLowerCase())}'`,
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
  }
  return checks;
}
