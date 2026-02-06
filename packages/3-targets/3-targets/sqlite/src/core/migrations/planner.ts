import {
  escapeLiteral,
  parseSqliteDefault,
  quoteIdentifier,
} from '@prisma-next/adapter-sqlite/control';
import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type {
  CodecControlHooks,
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
import {
  isIndexSatisfied,
  isUniqueConstraintSatisfied,
  verifySqlSchema,
} from '@prisma-next/family-sql/schema-verify';
import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';

type OperationClass = 'extension' | 'type' | 'table' | 'unique' | 'index' | 'foreignKey';

type PlannerFrameworkComponents = SqlMigrationPlannerPlanOptions extends {
  readonly frameworkComponents: infer T;
}
  ? T
  : ReadonlyArray<unknown>;

type PlannerOptionsWithComponents = SqlMigrationPlannerPlanOptions & {
  readonly frameworkComponents: PlannerFrameworkComponents;
};

type VerifySqlSchemaOptionsWithComponents = Parameters<typeof verifySqlSchema>[0] & {
  readonly frameworkComponents: PlannerFrameworkComponents;
};

type PlannerDatabaseDependency = {
  readonly id: string;
  readonly label: string;
  readonly install: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
  readonly verifyDatabaseDependencyInstalled: (schema: SqlSchemaIR) => readonly SchemaIssue[];
};

export interface SqlitePlanTargetDetails {
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

interface PlannerConfig {
  /**
   * SQLite doesn't have schemas in the Postgres sense, but some shared hooks accept a schemaName
   * parameter. We pass a stable identifier (`main`) by default.
   */
  readonly defaultSchemaName: string;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  defaultSchemaName: 'main',
};

export function createSqliteMigrationPlanner(
  config: Partial<PlannerConfig> = {},
): SqlMigrationPlanner<SqlitePlanTargetDetails> {
  return new SqliteMigrationPlanner({
    ...DEFAULT_PLANNER_CONFIG,
    ...config,
  });
}

class SqliteMigrationPlanner implements SqlMigrationPlanner<SqlitePlanTargetDetails> {
  constructor(private readonly config: PlannerConfig) {}

  plan(options: SqlMigrationPlannerPlanOptions) {
    const schemaName = options.schemaName ?? this.config.defaultSchemaName;
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    const classification = this.classifySchema(options);
    if (classification.kind === 'conflict') {
      return plannerFailure(classification.conflicts);
    }

    // Extract codec control hooks once at entry point for reuse across all operations.
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);

    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];

    const storageTypePlan = this.buildStorageTypeOperations(options, schemaName, codecHooks);
    if (storageTypePlan.conflicts.length > 0) {
      return plannerFailure(storageTypePlan.conflicts);
    }

    operations.push(
      ...this.buildDatabaseDependencyOperations(options),
      ...storageTypePlan.operations,
      ...this.buildTableOperations(options.contract.storage.tables, options.schema),
      ...this.buildColumnOperations(options.contract.storage.tables, options.schema),
      ...this.buildUniqueOperations(options.contract.storage.tables, options.schema),
      ...this.buildIndexOperations(options.contract.storage.tables, options.schema),
    );

    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      origin: null,
      destination: {
        coreHash: options.contract.coreHash,
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
          summary: 'Init planner requires additive operations be allowed',
          why: 'The init planner only emits additive operations. Update the policy to include "additive".',
        },
      ]);
    }
    return null;
  }

  /**
   * Builds migration operations from component-owned database dependencies.
   * These operations install database-side persistence structures declared by components.
   */
  private buildDatabaseDependencyOperations(
    options: PlannerOptionsWithComponents,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const dependencies = this.collectDependencies(options);
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    const seenDependencyIds = new Set<string>();
    const seenOperationIds = new Set<string>();

    for (const dependency of dependencies) {
      if (seenDependencyIds.has(dependency.id)) {
        continue;
      }
      seenDependencyIds.add(dependency.id);

      const issues = dependency.verifyDatabaseDependencyInstalled(options.schema);
      if (issues.length === 0) {
        continue;
      }

      for (const installOp of dependency.install) {
        if (seenOperationIds.has(installOp.id)) {
          continue;
        }
        seenOperationIds.add(installOp.id);
        operations.push(installOp);
      }
    }

    return operations;
  }

  private buildStorageTypeOperations(
    options: PlannerOptionsWithComponents,
    schemaName: string,
    codecHooks: Map<string, CodecControlHooks>,
  ): {
    readonly operations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
    readonly conflicts: readonly SqlPlannerConflict[];
  } {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    const conflicts: SqlPlannerConflict[] = [];
    const storageTypes = options.contract.storage.types ?? {};

    for (const [typeName, typeInstance] of sortedEntries(storageTypes)) {
      const hook = codecHooks.get(typeInstance.codecId);
      const planResult = hook?.planTypeOperations?.({
        typeName,
        typeInstance,
        contract: options.contract,
        schema: options.schema,
        schemaName,
        policy: options.policy,
      });
      if (!planResult) {
        continue;
      }
      for (const operation of planResult.operations) {
        if (!options.policy.allowedOperationClasses.includes(operation.operationClass)) {
          conflicts.push({
            kind: 'missingButNonAdditive',
            summary: `Storage type "${typeName}" requires "${operation.operationClass}" operation "${operation.id}"`,
            location: {
              type: typeName,
            },
          });
          continue;
        }
        operations.push({
          ...operation,
          target: {
            id: operation.target.id,
            details: this.buildTargetDetails('type', typeName, undefined),
          },
        });
      }
    }

    return { operations, conflicts };
  }

  private collectDependencies(
    options: PlannerOptionsWithComponents,
  ): ReadonlyArray<PlannerDatabaseDependency> {
    const components = options.frameworkComponents;
    if (components.length === 0) {
      return [];
    }
    const deps: PlannerDatabaseDependency[] = [];
    for (const component of components) {
      if (!isSqlDependencyProvider(component)) {
        continue;
      }
      const initDeps = component.databaseDependencies?.init;
      if (initDeps && initDeps.length > 0) {
        deps.push(...(initDeps as readonly PlannerDatabaseDependency[]));
      }
    }
    return sortDependencies(deps);
  }

  private buildTableOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      if (schema.tables[tableName]) {
        continue;
      }
      operations.push({
        id: `table.${tableName}`,
        label: `Create table ${tableName}`,
        summary: `Creates table ${tableName} with required columns and constraints`,
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: this.buildTargetDetails('table', tableName, tableName),
        },
        precheck: [
          {
            description: `ensure table "${tableName}" does not exist`,
            sql: tableExistsCheck({ table: tableName, exists: false }),
          },
        ],
        execute: [
          {
            description: `create table "${tableName}"`,
            sql: buildCreateTableSql(tableName, table),
          },
        ],
        postcheck: [
          {
            description: `verify table "${tableName}" exists`,
            sql: tableExistsCheck({ table: tableName, exists: true }),
          },
        ],
      });
    }
    return operations;
  }

  private buildColumnOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const schemaTable = schema.tables[tableName];
      if (!schemaTable) {
        continue;
      }
      for (const [columnName, column] of sortedEntries(table.columns)) {
        if (schemaTable.columns[columnName]) {
          continue;
        }
        operations.push(this.buildAddColumnOperation(tableName, columnName, column));
      }
    }
    return operations;
  }

  private buildAddColumnOperation(
    tableName: string,
    columnName: string,
    column: StorageColumn,
  ): SqlMigrationPlanOperation<SqlitePlanTargetDetails> {
    const qualified = quoteIdentifier(tableName);
    const notNull = column.nullable === false;
    const hasDefault = column.default !== undefined;
    // SQLite allows adding NOT NULL columns without default only if table is empty.
    const requiresEmptyTable = notNull && !hasDefault;
    const precheck = [
      {
        description: `ensure column "${columnName}" is missing`,
        sql: columnExistsCheck({ table: tableName, column: columnName, exists: false }),
      },
      ...(requiresEmptyTable
        ? [
            {
              description: `ensure table "${tableName}" is empty before adding NOT NULL column without default`,
              sql: tableIsEmptyCheck(qualified),
            },
          ]
        : []),
    ];
    const execute = [
      {
        description: `add column "${columnName}"`,
        sql: buildAddColumnSql(qualified, columnName, column),
      },
    ];
    const postcheck = [
      {
        description: `verify column "${columnName}" exists`,
        sql: columnExistsCheck({ table: tableName, column: columnName, exists: true }),
      },
      ...(notNull
        ? [
            {
              description: `verify column "${columnName}" is NOT NULL`,
              sql: columnIsNotNullCheck({ table: tableName, column: columnName }),
            },
          ]
        : []),
    ];

    return {
      id: `column.${tableName}.${columnName}`,
      label: `Add column ${columnName} to ${tableName}`,
      summary: `Adds column ${columnName} to table ${tableName}`,
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: this.buildTargetDetails('table', tableName, tableName),
      },
      precheck,
      execute,
      postcheck,
    };
  }

  private buildUniqueOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const schemaTable = schema.tables[tableName];
      for (const unique of table.uniques) {
        if (schemaTable && hasUniqueConstraint(schemaTable, unique.columns)) {
          continue;
        }
        const indexName = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
        operations.push({
          id: `unique.${tableName}.${indexName}`,
          label: `Create unique index ${indexName} on ${tableName}`,
          summary: `Creates unique index ${indexName} on ${tableName} to satisfy unique constraint`,
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: this.buildTargetDetails('unique', indexName, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: indexExistsCheck({ index: indexName, exists: false }),
            },
          ],
          execute: [
            {
              description: `create unique index "${indexName}"`,
              sql: `CREATE UNIQUE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(
                tableName,
              )} (${unique.columns.map(quoteIdentifier).join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: indexExistsCheck({ index: indexName, exists: true }),
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildIndexOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const schemaTable = schema.tables[tableName];
      for (const index of table.indexes) {
        if (schemaTable && hasIndex(schemaTable, index.columns)) {
          continue;
        }
        const indexName = index.name ?? `${tableName}_${index.columns.join('_')}_idx`;
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create index ${indexName} on ${tableName}`,
          summary: `Creates index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: this.buildTargetDetails('index', indexName, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: indexExistsCheck({ index: indexName, exists: false }),
            },
          ],
          execute: [
            {
              description: `create index "${indexName}"`,
              sql: `CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${index.columns
                .map(quoteIdentifier)
                .join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: indexExistsCheck({ index: indexName, exists: true }),
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildTargetDetails(
    objectType: OperationClass,
    name: string,
    table?: string,
  ): SqlitePlanTargetDetails {
    return {
      objectType,
      name,
      ...ifDefined('table', table),
    };
  }

  private classifySchema(options: PlannerOptionsWithComponents):
    | { kind: 'ok' }
    | {
        kind: 'conflict';
        conflicts: SqlPlannerConflict[];
      } {
    const verifyOptions: VerifySqlSchemaOptionsWithComponents = {
      contract: options.contract,
      schema: options.schema,
      strict: false,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
      normalizeDefault: parseSqliteDefault,
    };
    const verifyResult = verifySqlSchema(verifyOptions);

    const conflicts = this.extractConflicts(verifyResult.schema.issues);
    if (conflicts.length > 0) {
      return { kind: 'conflict', conflicts };
    }
    return { kind: 'ok' };
  }

  private extractConflicts(issues: readonly SchemaIssue[]): SqlPlannerConflict[] {
    const conflicts: SqlPlannerConflict[] = [];
    for (const issue of issues) {
      if (isAdditiveIssue(issue)) {
        continue;
      }
      const conflict = this.convertIssueToConflict(issue);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
    return conflicts.sort(conflictComparator);
  }

  private convertIssueToConflict(issue: SchemaIssue): SqlPlannerConflict | null {
    switch (issue.kind) {
      case 'type_mismatch':
        return this.buildConflict('typeMismatch', issue);
      case 'nullability_mismatch':
        return this.buildConflict('nullabilityConflict', issue);
      case 'primary_key_mismatch':
        // SQLite cannot add primary keys to existing tables additively.
        return this.buildConflict('indexIncompatible', issue);
      case 'foreign_key_mismatch':
        // SQLite cannot add foreign keys to existing tables additively.
        return this.buildConflict('foreignKeyConflict', issue);
      case 'unique_constraint_mismatch':
      case 'index_mismatch':
        // These are additive (create indexes), so they should have been filtered already.
        return this.buildConflict('indexIncompatible', issue);
      default:
        return null;
    }
  }

  private buildConflict(kind: SqlPlannerConflict['kind'], issue: SchemaIssue): SqlPlannerConflict {
    const location = buildConflictLocation(issue);
    const meta =
      issue.expected || issue.actual
        ? Object.freeze({
            ...ifDefined('expected', issue.expected),
            ...ifDefined('actual', issue.actual),
          })
        : undefined;

    return {
      kind,
      summary: issue.message,
      ...ifDefined('location', location),
      ...ifDefined('meta', meta),
    };
  }
}

function isSqlDependencyProvider(component: unknown): component is {
  readonly databaseDependencies?: {
    readonly init?: readonly PlannerDatabaseDependency[];
  };
} {
  if (typeof component !== 'object' || component === null) {
    return false;
  }
  const record = component as Record<string, unknown>;

  if (Object.hasOwn(record, 'familyId') && record['familyId'] !== 'sql') {
    return false;
  }

  if (!Object.hasOwn(record, 'databaseDependencies')) {
    return false;
  }
  const deps = record['databaseDependencies'];
  return deps === undefined || (typeof deps === 'object' && deps !== null);
}

function sortDependencies(
  dependencies: ReadonlyArray<PlannerDatabaseDependency>,
): ReadonlyArray<PlannerDatabaseDependency> {
  if (dependencies.length <= 1) {
    return dependencies;
  }
  return [...dependencies].sort((a, b) => a.id.localeCompare(b.id));
}

function buildCreateTableSql(tableName: string, table: StorageTable): string {
  const columnDefinitions = Object.entries(table.columns).map(
    ([columnName, column]: [string, StorageColumn]) => {
      const parts = [
        quoteIdentifier(columnName),
        buildColumnTypeSql(column),
        buildColumnDefaultSql(column.default),
        column.nullable ? '' : 'NOT NULL',
      ].filter(Boolean);
      return parts.join(' ');
    },
  );

  const constraintDefinitions: string[] = [];
  if (table.primaryKey) {
    constraintDefinitions.push(
      `PRIMARY KEY (${table.primaryKey.columns.map(quoteIdentifier).join(', ')})`,
    );
  }

  // SQLite cannot add FKs after table creation; include them in CREATE TABLE.
  for (const foreignKey of table.foreignKeys) {
    const fkName = foreignKey.name ?? `${tableName}_${foreignKey.columns.join('_')}_fkey`;
    const constraintPrefix = foreignKey.name ? `CONSTRAINT ${quoteIdentifier(fkName)} ` : '';
    constraintDefinitions.push(
      `${constraintPrefix}FOREIGN KEY (${foreignKey.columns
        .map(quoteIdentifier)
        .join(', ')}) REFERENCES ${quoteIdentifier(
        foreignKey.references.table,
      )} (${foreignKey.references.columns.map(quoteIdentifier).join(', ')})`,
    );
  }

  const allDefinitions = [...columnDefinitions, ...constraintDefinitions];
  return `CREATE TABLE ${quoteIdentifier(tableName)} (\n  ${allDefinitions.join(',\n  ')}\n)`;
}

function buildColumnTypeSql(column: StorageColumn): string {
  return column.nativeType;
}

function buildColumnDefaultSql(columnDefault: ColumnDefault | undefined): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${columnDefault.expression}`;
    case 'function': {
      if (columnDefault.expression === 'autoincrement()') {
        // SQLite has implicit rowid autoincrement semantics for INTEGER PRIMARY KEY columns.
        // We treat this as "no explicit default".
        return '';
      }
      if (columnDefault.expression === 'now()') {
        return 'DEFAULT (CURRENT_TIMESTAMP)';
      }
      return `DEFAULT ${columnDefault.expression}`;
    }
  }
}

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}

function tableExistsCheck({ table, exists = true }: { table: string; exists?: boolean }): string {
  const existsClause = exists ? '' : 'NOT ';
  return `SELECT ${existsClause}EXISTS (
  SELECT 1
  FROM sqlite_master
  WHERE type = 'table'
    AND name = '${escapeLiteral(table)}'
)`;
}

function indexExistsCheck({ index, exists = true }: { index: string; exists?: boolean }): string {
  const existsClause = exists ? '' : 'NOT ';
  return `SELECT ${existsClause}EXISTS (
  SELECT 1
  FROM sqlite_master
  WHERE type = 'index'
    AND name = '${escapeLiteral(index)}'
)`;
}

function columnExistsCheck({
  table,
  column,
  exists = true,
}: {
  table: string;
  column: string;
  exists?: boolean;
}): string {
  const existsClause = exists ? '' : 'NOT ';
  return `SELECT ${existsClause}EXISTS (
  SELECT 1
  FROM pragma_table_info('${escapeLiteral(table)}')
  WHERE name = '${escapeLiteral(column)}'
)`;
}

function columnIsNotNullCheck({ table, column }: { table: string; column: string }): string {
  // pragma_table_info returns notnull=0 for INTEGER PRIMARY KEY columns, but they are not nullable.
  return `SELECT EXISTS (
  SELECT 1
  FROM pragma_table_info('${escapeLiteral(table)}')
  WHERE name = '${escapeLiteral(column)}'
    AND ("notnull" = 1 OR pk > 0)
)`;
}

function tableIsEmptyCheck(qualifiedTableName: string): string {
  return `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedTableName} LIMIT 1)`;
}

function buildAddColumnSql(
  qualifiedTableName: string,
  columnName: string,
  column: StorageColumn,
): string {
  const typeSql = buildColumnTypeSql(column);
  const defaultSql = buildColumnDefaultSql(column.default);
  const parts = [
    `ALTER TABLE ${qualifiedTableName}`,
    `ADD COLUMN ${quoteIdentifier(columnName)} ${typeSql}`,
    defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

function hasUniqueConstraint(
  table: SqlSchemaIR['tables'][string],
  columns: readonly string[],
): boolean {
  return isUniqueConstraintSatisfied(table.uniques, table.indexes, columns);
}

function hasIndex(table: SqlSchemaIR['tables'][string], columns: readonly string[]): boolean {
  return isIndexSatisfied(table.indexes, table.uniques, columns);
}

function isAdditiveIssue(issue: SchemaIssue): boolean {
  switch (issue.kind) {
    case 'type_missing':
    case 'type_values_mismatch':
    case 'missing_table':
    case 'missing_column':
    case 'extension_missing':
      return true;
    // SQLite cannot add PKs or FKs to existing tables additively, so these are conflicts.
    case 'primary_key_mismatch':
    case 'foreign_key_mismatch':
      return false;
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
      return true;
    default:
      return false;
  }
}

function buildConflictLocation(issue: SchemaIssue) {
  const location: {
    table?: string;
    column?: string;
    constraint?: string;
  } = {};
  if (issue.table) {
    location.table = issue.table;
  }
  if (issue.column) {
    location.column = issue.column;
  }
  if (issue.indexOrConstraint) {
    location.constraint = issue.indexOrConstraint;
  }
  return Object.keys(location).length > 0 ? location : undefined;
}

function conflictComparator(a: SqlPlannerConflict, b: SqlPlannerConflict): number {
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  const aLocation = a.location ?? {};
  const bLocation = b.location ?? {};
  const tableCompare = compareStrings(aLocation.table, bLocation.table);
  if (tableCompare !== 0) {
    return tableCompare;
  }
  const columnCompare = compareStrings(aLocation.column, bLocation.column);
  if (columnCompare !== 0) {
    return columnCompare;
  }
  const constraintCompare = compareStrings(aLocation.constraint, bLocation.constraint);
  if (constraintCompare !== 0) {
    return constraintCompare;
  }
  return compareStrings(a.summary, b.summary);
}

function compareStrings(a?: string, b?: string): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined) {
    return -1;
  }
  if (b === undefined) {
    return 1;
  }
  return a < b ? -1 : 1;
}
