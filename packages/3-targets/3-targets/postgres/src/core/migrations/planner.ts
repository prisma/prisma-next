import {
  escapeLiteral,
  expandParameterizedNativeType,
  normalizeSchemaNativeType,
  parsePostgresDefault,
  quoteIdentifier,
} from '@prisma-next/adapter-postgres/control';
import { isTaggedBigInt } from '@prisma-next/contract/types';
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
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { ForeignKey, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresColumnDefault } from '../types';
import { buildLossyPlan } from './planner-lossy';

export type OperationClass =
  | 'extension'
  | 'type'
  | 'table'
  | 'column'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey';

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
  readonly install: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
  readonly verifyDatabaseDependencyInstalled: (schema: SqlSchemaIR) => readonly SchemaIssue[];
};

export interface PostgresPlanTargetDetails {
  readonly schema: string;
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

interface PlannerConfig {
  readonly defaultSchema: string;
}

export interface PlanningMode {
  readonly includeExtraObjects: boolean;
  readonly allowWidening: boolean;
  readonly allowDestructive: boolean;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  defaultSchema: 'public',
};

export function createPostgresMigrationPlanner(
  config: Partial<PlannerConfig> = {},
): SqlMigrationPlanner<PostgresPlanTargetDetails> {
  return new PostgresMigrationPlanner({
    ...DEFAULT_PLANNER_CONFIG,
    ...config,
  });
}

class PostgresMigrationPlanner implements SqlMigrationPlanner<PostgresPlanTargetDetails> {
  constructor(private readonly config: PlannerConfig) {}

  plan(options: SqlMigrationPlannerPlanOptions) {
    const schemaName = options.schemaName ?? this.config.defaultSchema;
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    const planningMode = this.resolvePlanningMode(options.policy);
    const schemaIssues = this.collectSchemaIssues(options, planningMode.includeExtraObjects);

    // Extract codec control hooks once at entry point for reuse across all operations.
    // This avoids repeated iteration over frameworkComponents for each method that needs hooks.
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);

    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];

    const lossyPlan = buildLossyPlan({
      contract: options.contract,
      issues: schemaIssues,
      schemaName,
      mode: planningMode,
      policy: options.policy,
    });
    if (lossyPlan.conflicts.length > 0) {
      return plannerFailure(lossyPlan.conflicts);
    }

    const storageTypePlan = this.buildStorageTypeOperations(options, schemaName, codecHooks);
    if (storageTypePlan.conflicts.length > 0) {
      return plannerFailure(storageTypePlan.conflicts);
    }

    // Sort table entries once for reuse across all additive operation builders.
    const sortedTables = sortedEntries(options.contract.storage.tables);

    // Pre-compute constraint lookups once per schema table for O(1) checks across all builders.
    const schemaLookups = buildSchemaLookupMap(options.schema);

    // Build extension operations from component-owned database dependencies
    operations.push(
      ...this.buildDatabaseDependencyOperations(options),
      ...storageTypePlan.operations,
      ...lossyPlan.operations,
      ...this.buildTableOperations(sortedTables, options.schema, schemaName),
      ...this.buildColumnOperations(sortedTables, options.schema, schemaName),
      ...this.buildPrimaryKeyOperations(sortedTables, options.schema, schemaName),
      ...this.buildUniqueOperations(sortedTables, schemaLookups, schemaName),
      ...this.buildIndexOperations(sortedTables, schemaLookups, schemaName),
      ...this.buildFkBackingIndexOperations(sortedTables, schemaLookups, schemaName),
      ...this.buildForeignKeyOperations(sortedTables, schemaLookups, schemaName),
    );

    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      origin: null,
      destination: {
        storageHash: options.contract.storageHash,
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

  /**
   * Builds migration operations from component-owned database dependencies.
   * These operations install database-side persistence structures declared by components.
   */
  private buildDatabaseDependencyOperations(
    options: PlannerOptionsWithComponents,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const dependencies = this.collectDependencies(options);
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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
        // SQL family components are expected to provide compatible target details. This would be better if
        // the type system could enforce it but it's not likely to occur in practice.
        operations.push(installOp as SqlMigrationPlanOperation<PostgresPlanTargetDetails>);
      }
    }

    return operations;
  }

  private buildStorageTypeOperations(
    options: PlannerOptionsWithComponents,
    schemaName: string,
    codecHooks: Map<string, CodecControlHooks>,
  ): {
    readonly operations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
    readonly conflicts: readonly SqlPlannerConflict[];
  } {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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
            details: this.buildTargetDetails('type', typeName, schemaName),
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
        deps.push(...initDeps);
      }
    }
    return sortDependencies(deps);
  }

  private buildTableOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      if (schema.tables[tableName]) {
        continue;
      }
      const qualified = qualifyTableName(schemaName, tableName);
      operations.push({
        id: `table.${tableName}`,
        label: `Create table ${tableName}`,
        summary: `Creates table ${tableName} with required columns`,
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: this.buildTargetDetails('table', tableName, schemaName),
        },
        precheck: [
          {
            description: `ensure table "${tableName}" does not exist`,
            sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
          },
        ],
        execute: [
          {
            description: `create table "${tableName}"`,
            sql: buildCreateTableSql(qualified, table),
          },
        ],
        postcheck: [
          {
            description: `verify table "${tableName}" exists`,
            sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
          },
        ],
      });
    }
    return operations;
  }

  private buildColumnOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const schemaTable = schema.tables[tableName];
      if (!schemaTable) {
        continue;
      }
      for (const [columnName, column] of sortedEntries(table.columns)) {
        if (schemaTable.columns[columnName]) {
          continue;
        }
        operations.push(this.buildAddColumnOperation(schemaName, tableName, columnName, column));
      }
    }
    return operations;
  }

  private buildAddColumnOperation(
    schema: string,
    tableName: string,
    columnName: string,
    column: StorageColumn,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const qualified = qualifyTableName(schema, tableName);
    const notNull = column.nullable === false;
    const hasDefault = column.default !== undefined;
    // Only require empty table for NOT NULL columns WITHOUT defaults.
    // PostgreSQL allows adding NOT NULL columns with defaults to non-empty tables
    // because the default value is applied to existing rows.
    const requiresEmptyTable = notNull && !hasDefault;
    const precheck = [
      {
        description: `ensure column "${columnName}" is missing`,
        sql: columnExistsCheck({ schema, table: tableName, column: columnName, exists: false }),
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
        sql: columnExistsCheck({ schema, table: tableName, column: columnName }),
      },
      ...(notNull
        ? [
            {
              description: `verify column "${columnName}" is NOT NULL`,
              sql: columnNullabilityCheck({
                schema,
                table: tableName,
                column: columnName,
                nullable: false,
              }),
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
        id: 'postgres',
        details: this.buildTargetDetails('table', tableName, schema),
      },
      precheck,
      execute,
      postcheck,
    };
  }

  private buildPrimaryKeyOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      if (!table.primaryKey) {
        continue;
      }
      const schemaTable = schema.tables[tableName];
      if (!schemaTable || schemaTable.primaryKey) {
        continue;
      }
      const constraintName = table.primaryKey.name ?? `${tableName}_pkey`;
      operations.push({
        id: `primaryKey.${tableName}.${constraintName}`,
        label: `Add primary key ${constraintName} on ${tableName}`,
        summary: `Adds primary key ${constraintName} on ${tableName}`,
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: this.buildTargetDetails('table', tableName, schemaName),
        },
        precheck: [
          {
            description: `ensure primary key does not exist on "${tableName}"`,
            sql: tableHasPrimaryKeyCheck(schemaName, tableName, false),
          },
        ],
        execute: [
          {
            description: `add primary key "${constraintName}"`,
            sql: `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ADD CONSTRAINT ${quoteIdentifier(constraintName)}
PRIMARY KEY (${table.primaryKey.columns.map(quoteIdentifier).join(', ')})`,
          },
        ],
        postcheck: [
          {
            description: `verify primary key "${constraintName}" exists`,
            sql: tableHasPrimaryKeyCheck(schemaName, tableName, true, constraintName),
          },
        ],
      });
    }
    return operations;
  }

  private buildUniqueOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      for (const unique of table.uniques) {
        if (lookup && hasUniqueConstraint(lookup, unique.columns)) {
          continue;
        }
        const constraintName = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
        operations.push({
          id: `unique.${tableName}.${constraintName}`,
          label: `Add unique constraint ${constraintName} on ${tableName}`,
          summary: `Adds unique constraint ${constraintName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('unique', constraintName, schemaName, tableName),
          },
          precheck: [
            {
              description: `ensure unique constraint "${constraintName}" is missing`,
              sql: constraintExistsCheck({ constraintName, schema: schemaName, exists: false }),
            },
          ],
          execute: [
            {
              description: `add unique constraint "${constraintName}"`,
              sql: `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ADD CONSTRAINT ${quoteIdentifier(constraintName)}
UNIQUE (${unique.columns.map(quoteIdentifier).join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify unique constraint "${constraintName}" exists`,
              sql: constraintExistsCheck({ constraintName, schema: schemaName }),
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildIndexOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      for (const index of table.indexes) {
        if (lookup && hasIndex(lookup, index.columns)) {
          continue;
        }
        const indexName = index.name ?? `${tableName}_${index.columns.join('_')}_idx`;
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create index ${indexName} on ${tableName}`,
          summary: `Creates index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('index', indexName, schemaName, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
            },
          ],
          execute: [
            {
              description: `create index "${indexName}"`,
              sql: `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualifyTableName(
                schemaName,
                tableName,
              )} (${index.columns.map(quoteIdentifier).join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
            },
          ],
        });
      }
    }
    return operations;
  }

  /**
   * Generates FK-backing index operations for FKs with `index: true`,
   * but only when no matching user-declared index exists in `contractTable.indexes`.
   */
  private buildFkBackingIndexOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      // Collect column sets of user-declared indexes to avoid duplicates
      const declaredIndexColumns = new Set(table.indexes.map((idx) => idx.columns.join(',')));

      for (const fk of table.foreignKeys) {
        if (fk.index === false) continue;
        // Skip if user already declared an index with these columns
        if (declaredIndexColumns.has(fk.columns.join(','))) continue;
        // Skip if the index already exists in the database
        if (lookup && hasIndex(lookup, fk.columns)) continue;

        const indexName = `${tableName}_${fk.columns.join('_')}_idx`;
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create FK-backing index ${indexName} on ${tableName}`,
          summary: `Creates FK-backing index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('index', indexName, schemaName, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
            },
          ],
          execute: [
            {
              description: `create FK-backing index "${indexName}"`,
              sql: `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualifyTableName(
                schemaName,
                tableName,
              )} (${fk.columns.map(quoteIdentifier).join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildForeignKeyOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      for (const foreignKey of table.foreignKeys) {
        if (foreignKey.constraint === false) continue;
        if (lookup && hasForeignKey(lookup, foreignKey)) {
          continue;
        }
        const fkName = foreignKey.name ?? `${tableName}_${foreignKey.columns.join('_')}_fkey`;
        operations.push({
          id: `foreignKey.${tableName}.${fkName}`,
          label: `Add foreign key ${fkName} on ${tableName}`,
          summary: `Adds foreign key ${fkName} referencing ${foreignKey.references.table}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('foreignKey', fkName, schemaName, tableName),
          },
          precheck: [
            {
              description: `ensure foreign key "${fkName}" is missing`,
              sql: constraintExistsCheck({
                constraintName: fkName,
                schema: schemaName,
                exists: false,
              }),
            },
          ],
          execute: [
            {
              description: `add foreign key "${fkName}"`,
              sql: `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ADD CONSTRAINT ${quoteIdentifier(fkName)}
FOREIGN KEY (${foreignKey.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${qualifyTableName(schemaName, foreignKey.references.table)} (${foreignKey.references.columns
                .map(quoteIdentifier)
                .join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify foreign key "${fkName}" exists`,
              sql: constraintExistsCheck({ constraintName: fkName, schema: schemaName }),
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
    schema: string,
    table?: string,
  ): PostgresPlanTargetDetails {
    return buildTargetDetails(objectType, name, schema, table);
  }

  private resolvePlanningMode(policy: MigrationOperationPolicy): PlanningMode {
    const allowWidening = policy.allowedOperationClasses.includes('widening');
    const allowDestructive = policy.allowedOperationClasses.includes('destructive');
    // `db init` uses additive-only policy and intentionally ignores extras.
    // Any lossy-capable policy should inspect extras to reconcile strict equality.
    const includeExtraObjects = allowWidening || allowDestructive;
    return { includeExtraObjects, allowWidening, allowDestructive };
  }

  private collectSchemaIssues(
    options: PlannerOptionsWithComponents,
    strict: boolean,
  ): readonly SchemaIssue[] {
    const verifyOptions: VerifySqlSchemaOptionsWithComponents = {
      contract: options.contract,
      schema: options.schema,
      strict,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
      normalizeDefault: parsePostgresDefault,
      normalizeNativeType: normalizeSchemaNativeType,
    };
    const verifyResult = verifySqlSchema(verifyOptions);
    return verifyResult.schema.issues;
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

  // If present, enforce familyId match to avoid mixing families at runtime.
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

function buildCreateTableSql(qualifiedTableName: string, table: StorageTable): string {
  const columnDefinitions = Object.entries(table.columns).map(
    ([columnName, column]: [string, StorageColumn]) => {
      const parts = [
        quoteIdentifier(columnName),
        buildColumnTypeSql(column),
        buildColumnDefaultSql(column.default, column),
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

  const allDefinitions = [...columnDefinitions, ...constraintDefinitions];
  return `CREATE TABLE ${qualifiedTableName} (\n  ${allDefinitions.join(',\n  ')}\n)`;
}

/**
 * Pattern for safe PostgreSQL type names.
 * Allows letters, digits, underscores, spaces (for "double precision", "character varying"),
 * and trailing [] for array types.
 */
const SAFE_NATIVE_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_ ]*(\[\])?$/;

function assertSafeNativeType(nativeType: string): void {
  if (!SAFE_NATIVE_TYPE_PATTERN.test(nativeType)) {
    throw new Error(
      `Unsafe native type name in contract: "${nativeType}". ` +
        'Native type names must match /^[a-zA-Z][a-zA-Z0-9_ ]*(\\[\\])?$/',
    );
  }
}

/**
 * Sanity check against accidental SQL injection from malformed contract files.
 * Rejects semicolons, SQL comment tokens, and dollar-quoting.
 * Not a comprehensive security boundary — the contract is developer-authored.
 */
function assertSafeDefaultExpression(expression: string): void {
  if (expression.includes(';') || /--|\/\*|\$\$/.test(expression)) {
    throw new Error(
      `Unsafe default expression in contract: "${expression}". ` +
        'Default expressions must not contain semicolons, SQL comment tokens, or dollar-quoting.',
    );
  }
}

/**
 * Builds the column type SQL, handling autoincrement as a special case.
 * For autoincrement on int4/int8, we use SERIAL/BIGSERIAL types.
 */
export function buildColumnTypeSql(column: StorageColumn): string {
  const columnDefault = column.default;

  // For autoincrement, use SERIAL/BIGSERIAL types instead of int4/int8
  if (columnDefault?.kind === 'function' && columnDefault.expression === 'autoincrement()') {
    if (column.nativeType === 'int4' || column.nativeType === 'integer') {
      return 'SERIAL';
    }
    if (column.nativeType === 'int8' || column.nativeType === 'bigint') {
      return 'BIGSERIAL';
    }
    if (column.nativeType === 'int2' || column.nativeType === 'smallint') {
      return 'SMALLSERIAL';
    }
  }

  if (column.typeRef) {
    return quoteIdentifier(column.nativeType);
  }

  // Validate nativeType before using it unquoted in DDL
  assertSafeNativeType(column.nativeType);
  return renderParameterizedTypeSql(column) ?? column.nativeType;
}

/**
 * Renders parameterized type SQL for a column, returning null if no expansion is needed.
 *
 * Uses the shared expandParameterizedNativeType utility from the postgres adapter.
 * Returns null when the column has no typeParams, allowing the caller to fall back
 * to the base nativeType.
 */
function renderParameterizedTypeSql(column: StorageColumn): string | null {
  if (!column.typeParams) {
    return null;
  }

  const expanded = expandParameterizedNativeType({
    nativeType: column.nativeType,
    codecId: column.codecId,
    typeParams: column.typeParams,
  });

  // If no expansion happened (returned the same base type), return null
  // so caller can decide whether to use nativeType directly
  return expanded !== column.nativeType ? expanded : null;
}

/**
 * Builds the DEFAULT clause for a column definition.
 * Returns empty string if no default is defined.
 *
 * Note: autoincrement is handled specially via SERIAL types, so we skip it here.
 */
function buildColumnDefaultSql(
  columnDefault: PostgresColumnDefault | undefined,
  column?: StorageColumn,
): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${renderDefaultLiteral(columnDefault.value, column)}`;
    case 'function': {
      // autoincrement is handled by SERIAL type, no explicit DEFAULT needed
      if (columnDefault.expression === 'autoincrement()') {
        return '';
      }
      assertSafeDefaultExpression(columnDefault.expression);
      return `DEFAULT (${columnDefault.expression})`;
    }
    case 'sequence':
      // Sequence names use quoteIdentifier for safe identifier handling
      return `DEFAULT nextval(${quoteIdentifier(columnDefault.name)}::regclass)`;
  }
}

function renderDefaultLiteral(value: unknown, column?: StorageColumn): string {
  const isJsonColumn = column?.nativeType === 'json' || column?.nativeType === 'jsonb';

  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
  }
  if (!isJsonColumn && isTaggedBigInt(value)) {
    if (!/^-?\d+$/.test(value.value)) {
      throw new Error(`Invalid tagged bigint value: "${value.value}" is not a valid integer`);
    }
    return value.value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return `'${escapeLiteral(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'NULL';
  }
  const json = JSON.stringify(value);
  if (isJsonColumn) {
    return `'${escapeLiteral(json)}'::${column.nativeType}`;
  }
  return `'${escapeLiteral(json)}'`;
}

export function buildTargetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): PostgresPlanTargetDetails {
  return {
    schema,
    objectType,
    name,
    ...ifDefined('table', table),
  };
}

export function qualifyTableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function toRegclassLiteral(schema: string, name: string): string {
  const regclass = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  return `'${escapeLiteral(regclass)}'`;
}

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}

export function constraintExistsCheck({
  constraintName,
  schema,
  exists = true,
}: {
  constraintName: string;
  schema: string;
  exists?: boolean;
}): string {
  const existsClause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${existsClause} (
  SELECT 1 FROM pg_constraint c
  JOIN pg_namespace n ON c.connamespace = n.oid
  WHERE c.conname = '${escapeLiteral(constraintName)}'
  AND n.nspname = '${escapeLiteral(schema)}'
)`;
}

export function columnExistsCheck({
  schema,
  table,
  column,
  exists = true,
}: {
  schema: string;
  table: string;
  column: string;
  exists?: boolean;
}): string {
  const existsClause = exists ? '' : 'NOT ';
  return `SELECT ${existsClause}EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = '${escapeLiteral(schema)}'
    AND table_name = '${escapeLiteral(table)}'
    AND column_name = '${escapeLiteral(column)}'
)`;
}

export function columnNullabilityCheck({
  schema,
  table,
  column,
  nullable,
}: {
  schema: string;
  table: string;
  column: string;
  nullable: boolean;
}): string {
  const expected = nullable ? 'YES' : 'NO';
  return `SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = '${escapeLiteral(schema)}'
    AND table_name = '${escapeLiteral(table)}'
    AND column_name = '${escapeLiteral(column)}'
    AND is_nullable = '${expected}'
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
  const defaultSql = buildColumnDefaultSql(column.default, column);
  const parts = [
    `ALTER TABLE ${qualifiedTableName}`,
    `ADD COLUMN ${quoteIdentifier(columnName)} ${typeSql}`,
    defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

function tableHasPrimaryKeyCheck(
  schema: string,
  table: string,
  exists: boolean,
  constraintName?: string,
): string {
  const comparison = exists ? '' : 'NOT ';
  const constraintFilter = constraintName
    ? `AND c2.relname = '${escapeLiteral(constraintName)}'`
    : '';
  return `SELECT ${comparison}EXISTS (
  SELECT 1
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_class c2 ON c2.oid = i.indexrelid
  WHERE n.nspname = '${escapeLiteral(schema)}'
    AND c.relname = '${escapeLiteral(table)}'
    AND i.indisprimary
    ${constraintFilter}
)`;
}

/**
 * Pre-computed lookup sets for a schema table's constraints.
 * Converts O(n*m) linear scans to O(1) Set lookups per constraint check.
 */
interface SchemaTableLookup {
  readonly uniqueKeys: Set<string>;
  readonly indexKeys: Set<string>;
  readonly uniqueIndexKeys: Set<string>;
  readonly fkKeys: Set<string>;
}

function buildSchemaLookupMap(schema: SqlSchemaIR): ReadonlyMap<string, SchemaTableLookup> {
  const map = new Map<string, SchemaTableLookup>();
  for (const [tableName, table] of Object.entries(schema.tables)) {
    map.set(tableName, buildSchemaTableLookup(table));
  }
  return map;
}

function buildSchemaTableLookup(table: SqlSchemaIR['tables'][string]): SchemaTableLookup {
  const uniqueKeys = new Set(table.uniques.map((u) => u.columns.join(',')));
  const indexKeys = new Set(table.indexes.map((i) => i.columns.join(',')));
  const uniqueIndexKeys = new Set(
    table.indexes.filter((i) => i.unique).map((i) => i.columns.join(',')),
  );
  const fkKeys = new Set(
    table.foreignKeys.map(
      (fk) => `${fk.columns.join(',')}|${fk.referencedTable}|${fk.referencedColumns.join(',')}`,
    ),
  );
  return { uniqueKeys, indexKeys, uniqueIndexKeys, fkKeys };
}

function hasUniqueConstraint(lookup: SchemaTableLookup, columns: readonly string[]): boolean {
  const key = columns.join(',');
  return lookup.uniqueKeys.has(key) || lookup.uniqueIndexKeys.has(key);
}

function hasIndex(lookup: SchemaTableLookup, columns: readonly string[]): boolean {
  const key = columns.join(',');
  return lookup.indexKeys.has(key) || lookup.uniqueKeys.has(key);
}

function hasForeignKey(lookup: SchemaTableLookup, fk: ForeignKey): boolean {
  return lookup.fkKeys.has(
    `${fk.columns.join(',')}|${fk.references.table}|${fk.references.columns.join(',')}`,
  );
}
