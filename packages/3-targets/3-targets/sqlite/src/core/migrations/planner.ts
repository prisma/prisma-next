import {
  normalizeSqliteNativeType,
  parseSqliteDefault,
  quoteIdentifier,
} from '@prisma-next/adapter-sqlite/control';
import type {
  CodecControlHooks,
  MigrationOperationClass,
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
  SqlPlannerConflict,
} from '@prisma-next/family-sql/control';
import {
  createMigrationPlan,
  extractCodecControlHooks,
  plannerFailure,
  plannerSuccess,
} from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { StorageTable, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildCreateIndexSql,
  buildCreateTableSql,
  buildDropIndexSql,
} from './planner-ddl-builders';
import { buildTargetDetails, type SqlitePlanTargetDetails } from './planner-target-details';

export function createSqliteMigrationPlanner(): SqlMigrationPlanner<SqlitePlanTargetDetails> {
  return new SqliteMigrationPlanner();
}

class SqliteMigrationPlanner implements SqlMigrationPlanner<SqlitePlanTargetDetails> {
  plan(options: SqlMigrationPlannerPlanOptions) {
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    const policy = resolvePlanningMode(options.policy);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    const storageTypes = options.contract.storage.types ?? {};
    const sortedTables = sortedEntries(options.contract.storage.tables);
    const contractTableNames = new Set(sortedTables.map(([name]) => name));
    const schemaIndexSets = buildSchemaIndexLookup(options.schema);

    // Additive operations — things in contract but not in schema
    operations.push(
      ...this.buildTableOperations(sortedTables, options.schema, codecHooks, storageTypes),
      ...this.buildColumnOperations(sortedTables, options.schema, codecHooks, storageTypes),
      ...this.buildIndexOperations(sortedTables, schemaIndexSets),
      ...this.buildFkBackingIndexOperations(sortedTables, schemaIndexSets),
    );

    // Reconciliation — detect all schema mismatches and extras via verifySqlSchema
    const schemaIssues = this.collectSchemaIssues(options, policy);
    const classifiedIssues = classifyRecreateTableIssues(schemaIssues);
    const recreateOps = this.buildRecreateTableOperations(
      classifiedIssues,
      options.contract.storage.tables,
      codecHooks,
      storageTypes,
      options.schema,
    );

    // Destructive operations — tables, columns, and indexes in schema but not in contract
    const dropColumnOps = this.buildDropColumnOperations(schemaIssues);
    const dropIndexOps = this.buildDropIndexOperations(sortedTables, options.schema);
    const dropTableOps = this.buildDropTableOperations(options.schema, contractTableNames);
    const destructiveOps = [...dropColumnOps, ...dropIndexOps, ...dropTableOps];

    // Policy enforcement — collect conflicts for operations the policy doesn't allow
    const conflicts: SqlPlannerConflict[] = [];

    for (const [tableName, classified] of classifiedIssues) {
      const op = recreateOps.find((o) => o.target.details?.name === tableName);
      if (op && policy.allowedClasses.has(op.operationClass)) {
        operations.push(op);
      } else {
        conflicts.push(...issueConflicts(classified.issues));
      }
    }

    for (const op of destructiveOps) {
      if (policy.allowDestructive) {
        operations.push(op);
      } else {
        const table = op.target.details?.table ?? op.target.details?.name;
        conflicts.push({
          kind: 'missingButNonAdditive',
          summary: `${op.label} requires "destructive" operation class which is not allowed by policy`,
          ...(table ? { location: { table } } : {}),
        });
      }
    }

    if (conflicts.length > 0) {
      return plannerFailure(conflicts);
    }

    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: {
        storageHash: options.contract.storage.storageHash,
        ...ifDefined('profileHash', options.contract.profileHash),
      },
      operations,
    });

    return plannerSuccess(plan);
  }

  private ensureAdditivePolicy(policy: MigrationOperationPolicy) {
    if (!policy.allowedOperationClasses.includes('additive')) {
      return plannerFailure([
        {
          kind: 'unsupportedOperation',
          summary: 'Migration planner requires additive operations be allowed',
          why: 'The planner requires the "additive" operation class to be allowed in the policy.',
        },
      ]);
    }
    return null;
  }

  private collectSchemaIssues(
    options: SqlMigrationPlannerPlanOptions,
    policy: PlanningMode,
  ): readonly SchemaIssue[] {
    const verifyResult = verifySqlSchema({
      contract: options.contract,
      schema: options.schema,
      strict: policy.allowDestructive || policy.allowWidening,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
      normalizeDefault: parseSqliteDefault,
      normalizeNativeType: normalizeSqliteNativeType,
    });
    return verifyResult.schema.issues;
  }

  // ---------------------------------------------------------------------------
  // Additive operations
  // ---------------------------------------------------------------------------

  private buildTableOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      if (schema.tables[tableName]) continue;
      operations.push({
        id: `table.${tableName}`,
        label: `Create table ${tableName}`,
        summary: `Creates table ${tableName} with required columns`,
        operationClass: 'additive',
        target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
        precheck: [
          {
            description: `ensure table "${tableName}" does not exist`,
            sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
          },
        ],
        execute: [
          {
            description: `create table "${tableName}"`,
            sql: buildCreateTableSql(tableName, table, codecHooks, storageTypes),
          },
        ],
        postcheck: [
          {
            description: `verify table "${tableName}" exists`,
            sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
          },
        ],
      });
    }
    return operations;
  }

  private buildColumnOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const schemaTable = schema.tables[tableName];
      if (!schemaTable) continue;
      for (const [columnName, column] of sortedEntries(table.columns)) {
        if (schemaTable.columns[columnName]) continue;
        operations.push({
          id: `column.${tableName}.${columnName}`,
          label: `Add column ${columnName} on ${tableName}`,
          summary: `Adds column ${columnName} on ${tableName}`,
          operationClass: 'additive',
          target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
          precheck: [
            {
              description: `ensure column "${columnName}" is missing`,
              sql: `SELECT COUNT(*) = 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
            },
          ],
          execute: [
            {
              description: `add column "${columnName}"`,
              sql: buildAddColumnSql(tableName, columnName, column, codecHooks, storageTypes),
            },
          ],
          postcheck: [
            {
              description: `verify column "${columnName}" exists`,
              sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildIndexOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaIndexSets: Map<string, Set<string>>,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const existingIndexes = schemaIndexSets.get(tableName);
      for (const index of table.indexes) {
        const indexKey = index.columns.join(',');
        if (existingIndexes?.has(indexKey)) continue;
        const indexName = index.name ?? defaultIndexName(tableName, index.columns);
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create index ${indexName} on ${tableName}`,
          summary: `Creates index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
            },
          ],
          execute: [
            {
              description: `create index "${indexName}"`,
              sql: buildCreateIndexSql(tableName, indexName, index.columns),
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildFkBackingIndexOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaIndexSets: Map<string, Set<string>>,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const existingIndexes = schemaIndexSets.get(tableName);
      const declaredIndexColumns = new Set(table.indexes.map((idx) => idx.columns.join(',')));
      for (const fk of table.foreignKeys) {
        if (fk.index === false) continue;
        const fkColKey = fk.columns.join(',');
        if (declaredIndexColumns.has(fkColKey)) continue;
        if (existingIndexes?.has(fkColKey)) continue;
        const indexName = defaultIndexName(tableName, fk.columns);
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create FK-backing index ${indexName} on ${tableName}`,
          summary: `Creates FK-backing index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
            },
          ],
          execute: [
            {
              description: `create FK-backing index "${indexName}"`,
              sql: buildCreateIndexSql(tableName, indexName, fk.columns),
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
            },
          ],
        });
      }
    }
    return operations;
  }

  // ---------------------------------------------------------------------------
  // Recreate-table operations (widening + destructive column/constraint changes)
  // ---------------------------------------------------------------------------

  private buildRecreateTableOperations(
    classifiedByTable: Map<string, ClassifiedTableIssues>,
    contractTables: Readonly<Record<string, StorageTable>>,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
    schema: SqlSchemaIR,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];

    for (const [tableName, classified] of classifiedByTable) {
      const contractTable = contractTables[tableName];
      const schemaTable = schema.tables[tableName];
      if (!contractTable || !schemaTable) continue;

      const tempName = `_prisma_new_${tableName}`;
      const sharedColumns = Object.keys(contractTable.columns).filter(
        (col) => schemaTable.columns[col] !== undefined,
      );
      const columnList = sharedColumns.map(quoteIdentifier).join(', ');
      const issueDescriptions = classified.issues.map((i) => i.message).join('; ');

      const indexStatements: Array<{ description: string; sql: string }> = [];
      const declaredIndexColumnKeys = new Set<string>();
      for (const idx of contractTable.indexes) {
        const indexName = idx.name ?? defaultIndexName(tableName, idx.columns);
        declaredIndexColumnKeys.add(idx.columns.join(','));
        indexStatements.push({
          description: `recreate index "${indexName}" on "${tableName}"`,
          sql: buildCreateIndexSql(tableName, indexName, idx.columns),
        });
      }
      for (const fk of contractTable.foreignKeys) {
        if (fk.index === false) continue;
        if (declaredIndexColumnKeys.has(fk.columns.join(','))) continue;
        const indexName = defaultIndexName(tableName, fk.columns);
        indexStatements.push({
          description: `recreate FK-backing index "${indexName}" on "${tableName}"`,
          sql: buildCreateIndexSql(tableName, indexName, fk.columns),
        });
      }

      operations.push({
        id: `recreateTable.${tableName}`,
        label: `Recreate table ${tableName}`,
        summary: `Recreates table ${tableName} to apply schema changes: ${issueDescriptions}`,
        operationClass: classified.operationClass,
        target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
        precheck: [
          {
            description: `ensure table "${tableName}" exists`,
            sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
          },
          {
            description: `ensure temp table "${tempName}" does not exist`,
            sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tempName)}'`,
          },
        ],
        execute: [
          {
            description: `create new table "${tempName}" with desired schema`,
            sql: buildCreateTableSql(tempName, contractTable, codecHooks, storageTypes),
          },
          {
            description: `copy data from "${tableName}" to "${tempName}"`,
            sql: `INSERT INTO ${quoteIdentifier(tempName)} (${columnList}) SELECT ${columnList} FROM ${quoteIdentifier(tableName)}`,
          },
          {
            description: `drop old table "${tableName}"`,
            sql: `DROP TABLE ${quoteIdentifier(tableName)}`,
          },
          {
            description: `rename "${tempName}" to "${tableName}"`,
            sql: `ALTER TABLE ${quoteIdentifier(tempName)} RENAME TO ${quoteIdentifier(tableName)}`,
          },
          ...indexStatements,
        ],
        postcheck: [
          {
            description: `verify table "${tableName}" exists`,
            sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
          },
          {
            description: `verify temp table "${tempName}" is gone`,
            sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tempName)}'`,
          },
          ...buildIssuePostchecks(tableName, classified.issues, contractTable),
        ],
      });
    }

    return operations;
  }

  // ---------------------------------------------------------------------------
  // Destructive operations (drop table / drop column / drop index)
  // ---------------------------------------------------------------------------

  private buildDropColumnOperations(
    schemaIssues: readonly SchemaIssue[],
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const issue of schemaIssues) {
      if (issue.kind !== 'extra_column' || !issue.table || !issue.column) continue;
      const tableName = issue.table;
      const columnName = issue.column;
      operations.push({
        id: `dropColumn.${tableName}.${columnName}`,
        label: `Drop column ${columnName} on ${tableName}`,
        summary: `Drops column ${columnName} on ${tableName} which is not in the contract`,
        operationClass: 'destructive',
        target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
        precheck: [
          {
            description: `ensure column "${columnName}" exists on "${tableName}"`,
            sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
          },
        ],
        execute: [
          {
            description: `drop column "${columnName}" from "${tableName}"`,
            sql: `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`,
          },
        ],
        postcheck: [
          {
            description: `verify column "${columnName}" is gone from "${tableName}"`,
            sql: `SELECT COUNT(*) = 0 FROM pragma_table_info('${esc(tableName)}') WHERE name = '${esc(columnName)}'`,
          },
        ],
      });
    }
    return operations;
  }

  private buildDropTableOperations(
    schema: SqlSchemaIR,
    contractTableNames: Set<string>,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const tableName of Object.keys(schema.tables)) {
      if (contractTableNames.has(tableName)) continue;
      if (tableName.startsWith('_prisma_')) continue;
      operations.push({
        id: `dropTable.${tableName}`,
        label: `Drop table ${tableName}`,
        summary: `Drops table ${tableName} which is not in the contract`,
        operationClass: 'destructive',
        target: { id: 'sqlite', details: buildTargetDetails('table', tableName) },
        precheck: [
          {
            description: `ensure table "${tableName}" exists`,
            sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
          },
        ],
        execute: [
          {
            description: `drop table "${tableName}"`,
            sql: `DROP TABLE ${quoteIdentifier(tableName)}`,
          },
        ],
        postcheck: [
          {
            description: `verify table "${tableName}" is gone`,
            sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${esc(tableName)}'`,
          },
        ],
      });
    }
    return operations;
  }

  private buildDropIndexOperations(
    contractTables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    const contractIndexKeys = new Map<string, Set<string>>();
    for (const [tableName, table] of contractTables) {
      const keys = new Set<string>();
      for (const idx of table.indexes) keys.add(idx.columns.join(','));
      for (const fk of table.foreignKeys) {
        if (fk.index !== false) keys.add(fk.columns.join(','));
      }
      contractIndexKeys.set(tableName, keys);
    }
    for (const [tableName, schemaTable] of Object.entries(schema.tables)) {
      if (tableName.startsWith('_prisma_')) continue;
      const desiredKeys = contractIndexKeys.get(tableName);
      if (!desiredKeys) continue;
      for (const idx of schemaTable.indexes) {
        const colKey = idx.columns.join(',');
        if (desiredKeys.has(colKey)) continue;
        const indexName = idx.name ?? defaultIndexName(tableName, [...idx.columns]);
        operations.push({
          id: `dropIndex.${tableName}.${indexName}`,
          label: `Drop index ${indexName} on ${tableName}`,
          summary: `Drops index ${indexName} on ${tableName} which is not in the contract`,
          operationClass: 'destructive',
          target: { id: 'sqlite', details: buildTargetDetails('index', indexName, tableName) },
          precheck: [
            {
              description: `ensure index "${indexName}" exists`,
              sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
            },
          ],
          execute: [
            {
              description: `drop index "${indexName}"`,
              sql: buildDropIndexSql(indexName),
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" is gone`,
              sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${esc(indexName)}'`,
            },
          ],
        });
      }
    }
    return operations;
  }
}

// ---------------------------------------------------------------------------
// Issue classification
// ---------------------------------------------------------------------------

interface ClassifiedTableIssues {
  readonly issues: readonly SchemaIssue[];
  readonly operationClass: MigrationOperationClass;
}

const WIDENING_ISSUE_KINDS = new Set<SchemaIssue['kind']>(['default_mismatch', 'default_missing']);

const DESTRUCTIVE_ISSUE_KINDS = new Set<SchemaIssue['kind']>([
  'extra_default',
  'type_mismatch',
  'primary_key_mismatch',
  'foreign_key_mismatch',
  'unique_constraint_mismatch',
  'extra_foreign_key',
  'extra_unique_constraint',
  'extra_primary_key',
]);

function classifyRecreateTableIssues(
  issues: readonly SchemaIssue[],
): Map<string, ClassifiedTableIssues> {
  const byTable = new Map<string, { issues: SchemaIssue[]; hasDestructive: boolean }>();

  for (const issue of issues) {
    if (issue.kind === 'enum_values_changed') continue;
    if (!issue.table) continue;

    let opClass: 'widening' | 'destructive' | null = null;

    if (issue.kind === 'nullability_mismatch') {
      // Relaxing (NOT NULL → nullable) is widening; tightening (nullable → NOT NULL) is destructive
      opClass = issue.expected === 'true' ? 'widening' : 'destructive';
    } else if (WIDENING_ISSUE_KINDS.has(issue.kind)) {
      opClass = 'widening';
    } else if (DESTRUCTIVE_ISSUE_KINDS.has(issue.kind)) {
      opClass = 'destructive';
    }

    if (!opClass) continue;

    const entry = byTable.get(issue.table);
    if (entry) {
      entry.issues.push(issue);
      if (opClass === 'destructive') entry.hasDestructive = true;
    } else {
      byTable.set(issue.table, {
        issues: [issue],
        hasDestructive: opClass === 'destructive',
      });
    }
  }

  const result = new Map<string, ClassifiedTableIssues>();
  for (const [tableName, entry] of byTable) {
    result.set(tableName, {
      issues: entry.issues,
      operationClass: entry.hasDestructive ? 'destructive' : 'widening',
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Postcheck builders for recreate-table idempotency
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function issueConflictKind(issue: SchemaIssue): SqlPlannerConflict['kind'] {
  switch (issue.kind) {
    case 'type_mismatch':
      return 'typeMismatch';
    case 'nullability_mismatch':
      return 'nullabilityConflict';
    case 'primary_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'extra_primary_key':
    case 'extra_unique_constraint':
      return 'indexIncompatible';
    case 'foreign_key_mismatch':
    case 'extra_foreign_key':
      return 'foreignKeyConflict';
    default:
      return 'missingButNonAdditive';
  }
}

function issueConflicts(issues: readonly SchemaIssue[]): SqlPlannerConflict[] {
  return issues.map((issue) => ({
    kind: issueConflictKind(issue),
    summary: issue.message,
    location:
      issue.kind === 'enum_values_changed'
        ? {}
        : {
            ...(issue.table ? { table: issue.table } : {}),
            ...(issue.column ? { column: issue.column } : {}),
            ...(issue.indexOrConstraint ? { constraint: issue.indexOrConstraint } : {}),
          },
  }));
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

function buildSchemaIndexLookup(schema: SqlSchemaIR): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const indexSet = new Set<string>();
    for (const idx of table.indexes) indexSet.add(idx.columns.join(','));
    map.set(tableName, indexSet);
  }
  return map;
}

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}

interface PlanningMode {
  readonly allowWidening: boolean;
  readonly allowDestructive: boolean;
  readonly allowedClasses: ReadonlySet<MigrationOperationClass>;
}

function resolvePlanningMode(policy: MigrationOperationPolicy): PlanningMode {
  return {
    allowWidening: policy.allowedOperationClasses.includes('widening'),
    allowDestructive: policy.allowedOperationClasses.includes('destructive'),
    allowedClasses: new Set(policy.allowedOperationClasses),
  };
}
