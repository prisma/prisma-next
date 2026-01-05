import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
  SqlPlannerConflict,
} from '@prisma-next/family-sql/control';
import {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
} from '@prisma-next/family-sql/control';
import {
  arraysEqual,
  isIndexSatisfied,
  isUniqueConstraintSatisfied,
  verifySqlSchema,
} from '@prisma-next/family-sql/schema-verify';
import type {
  ForeignKey,
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageEnum,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { SqlEnumIR, SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

type OperationClass = 'extension' | 'enum' | 'table' | 'unique' | 'index' | 'foreignKey';

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

    const classification = this.classifySchema(options);
    if (classification.kind === 'conflict') {
      return plannerFailure(classification.conflicts);
    }

    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];

    // Build extension operations from component-owned database dependencies
    // Enum operations come before table operations since tables may reference enum types
    const contractEnums = options.contract.storage.enums ?? {};
    const enumNames = new Set(Object.keys(contractEnums));
    operations.push(
      ...this.buildDatabaseDependencyOperations(options),
      ...this.buildEnumOperations(contractEnums, options.schema.enums ?? {}, schemaName),
      ...this.buildTableOperations(
        options.contract.storage.tables,
        options.schema,
        schemaName,
        enumNames,
      ),
      ...this.buildColumnOperations(
        options.contract.storage.tables,
        options.schema,
        schemaName,
        enumNames,
      ),
      ...this.buildPrimaryKeyOperations(
        options.contract.storage.tables,
        options.schema,
        schemaName,
      ),
      ...this.buildUniqueOperations(options.contract.storage.tables, options.schema, schemaName),
      ...this.buildIndexOperations(options.contract.storage.tables, options.schema, schemaName),
      ...this.buildForeignKeyOperations(
        options.contract.storage.tables,
        options.schema,
        schemaName,
      ),
    );

    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      origin: null,
      destination: {
        coreHash: options.contract.coreHash,
        ...(options.contract.profileHash ? { profileHash: options.contract.profileHash } : {}),
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

  private buildEnumOperations(
    contractEnums: Record<string, StorageEnum>,
    schemaEnums: Record<string, SqlEnumIR>,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [enumName, enumDef] of sortedEntries(contractEnums)) {
      const schemaEnum = schemaEnums[enumName];
      if (schemaEnum && arraysEqual(schemaEnum.values, enumDef.values)) {
        // Enum exists and values match exactly - skip
        continue;
      }
      // If schemaEnum exists but values don't match, that's a conflict handled by classifySchema
      // Here we only handle missing enums (additive)
      if (schemaEnum) {
        continue;
      }
      const qualifiedName = `${quoteIdentifier(schemaName)}.${quoteIdentifier(enumName)}`;
      const valuesLiteral = enumDef.values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
      operations.push({
        id: `enum.${enumName}`,
        label: `Create enum type ${enumName}`,
        summary: `Creates enum type ${enumName} with values: ${enumDef.values.join(', ')}`,
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: this.buildTargetDetails('enum', enumName, schemaName),
        },
        precheck: [
          {
            description: `ensure enum type "${enumName}" does not exist`,
            sql: enumTypeExistsCheck({ schema: schemaName, typeName: enumName, exists: false }),
          },
        ],
        execute: [
          {
            description: `create enum type "${enumName}"`,
            sql: `CREATE TYPE ${qualifiedName} AS ENUM (${valuesLiteral})`,
          },
        ],
        postcheck: [
          {
            description: `verify enum type "${enumName}" exists`,
            sql: enumTypeExistsCheck({ schema: schemaName, typeName: enumName }),
          },
        ],
      });
    }
    return operations;
  }

  private buildTableOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
    schemaName: string,
    enumNames?: ReadonlySet<string>,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
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
            sql: buildCreateTableSql(qualified, table, schemaName, enumNames),
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
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
    schemaName: string,
    enumNames?: ReadonlySet<string>,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const schemaTable = schema.tables[tableName];
      if (!schemaTable) {
        continue;
      }
      for (const [columnName, column] of sortedEntries(table.columns)) {
        if (schemaTable.columns[columnName]) {
          continue;
        }
        operations.push(
          this.buildAddColumnOperation(schemaName, tableName, columnName, column, enumNames),
        );
      }
    }
    return operations;
  }

  private buildAddColumnOperation(
    schema: string,
    tableName: string,
    columnName: string,
    column: StorageColumn,
    enumNames?: ReadonlySet<string>,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const qualified = qualifyTableName(schema, tableName);
    const notNull = column.nullable === false;
    const precheck = [
      {
        description: `ensure column "${columnName}" is missing`,
        sql: columnExistsCheck({ schema, table: tableName, column: columnName, exists: false }),
      },
      ...(notNull
        ? [
            {
              description: `ensure table "${tableName}" is empty before adding NOT NULL column`,
              sql: tableIsEmptyCheck(qualified),
            },
          ]
        : []),
    ];
    const execute = [
      {
        description: `add column "${columnName}"`,
        sql: buildAddColumnSql(qualified, columnName, column, schema, enumNames),
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
              sql: columnIsNotNullCheck({ schema, table: tableName, column: columnName }),
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
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
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
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const schemaTable = schema.tables[tableName];
      for (const unique of table.uniques) {
        if (schemaTable && hasUniqueConstraint(schemaTable, unique.columns)) {
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
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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

  private buildForeignKeyOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const schemaTable = schema.tables[tableName];
      for (const foreignKey of table.foreignKeys) {
        if (schemaTable && hasForeignKey(schemaTable, foreignKey)) {
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
    return {
      schema,
      objectType,
      name,
      ...(table ? { table } : {}),
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
        return this.buildConflict('indexIncompatible', issue);
      case 'unique_constraint_mismatch':
        return this.buildConflict('indexIncompatible', issue);
      case 'index_mismatch':
        return this.buildConflict('indexIncompatible', issue);
      case 'foreign_key_mismatch':
        return this.buildConflict('foreignKeyConflict', issue);
      case 'enum_values_mismatch':
        return this.buildEnumConflict(issue);
      default:
        return null;
    }
  }

  private buildEnumConflict(issue: SchemaIssue): SqlPlannerConflict {
    const meta =
      issue.expected || issue.actual
        ? Object.freeze({
            ...(issue.expected ? { expected: issue.expected } : {}),
            ...(issue.actual ? { actual: issue.actual } : {}),
          })
        : undefined;

    return {
      kind: 'enumValuesMismatch',
      summary: issue.message,
      ...(issue.enumName ? { location: { enum: issue.enumName } } : {}),
      ...(meta ? { meta } : {}),
    };
  }

  private buildConflict(kind: SqlPlannerConflict['kind'], issue: SchemaIssue): SqlPlannerConflict {
    const location = buildConflictLocation(issue);
    const meta =
      issue.expected || issue.actual
        ? Object.freeze({
            ...(issue.expected ? { expected: issue.expected } : {}),
            ...(issue.actual ? { actual: issue.actual } : {}),
          })
        : undefined;

    return {
      kind,
      summary: issue.message,
      ...(location ? { location } : {}),
      ...(meta ? { meta } : {}),
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

function buildCreateTableSql(
  qualifiedTableName: string,
  table: StorageTable,
  schemaName: string,
  enumNames?: ReadonlySet<string>,
): string {
  const columnDefinitions = Object.entries(table.columns).map(
    ([columnName, column]: [string, StorageColumn]) => {
      // If nativeType is an enum, use schema-qualified and quoted reference
      const typeRef = enumNames?.has(column.nativeType)
        ? `${quoteIdentifier(schemaName)}.${quoteIdentifier(column.nativeType)}`
        : column.nativeType;
      const parts = [
        quoteIdentifier(columnName),
        typeRef,
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

function qualifyTableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function toRegclassLiteral(schema: string, name: string): string {
  const regclass = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  return `'${escapeLiteral(regclass)}'`;
}

/** Escapes and quotes a SQL identifier (table, column, schema name). */
function quoteIdentifier(identifier: string): string {
  // TypeScript enforces string type - no runtime check needed for internal callers
  return `"${identifier.replace(/"/g, '""')}"`;
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}

function constraintExistsCheck({
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

function enumTypeExistsCheck({
  schema,
  typeName,
  exists = true,
}: {
  schema: string;
  typeName: string;
  exists?: boolean;
}): string {
  const existsClause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${existsClause} (
  SELECT 1 FROM pg_type t
  JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE t.typname = '${escapeLiteral(typeName)}'
  AND n.nspname = '${escapeLiteral(schema)}'
  AND t.typtype = 'e'
)`;
}

function columnExistsCheck({
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

function columnIsNotNullCheck({
  schema,
  table,
  column,
}: {
  schema: string;
  table: string;
  column: string;
}): string {
  return `SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = '${escapeLiteral(schema)}'
    AND table_name = '${escapeLiteral(table)}'
    AND column_name = '${escapeLiteral(column)}'
    AND is_nullable = 'NO'
)`;
}

function tableIsEmptyCheck(qualifiedTableName: string): string {
  return `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedTableName} LIMIT 1)`;
}

function buildAddColumnSql(
  qualifiedTableName: string,
  columnName: string,
  column: StorageColumn,
  schemaName: string,
  enumNames?: ReadonlySet<string>,
): string {
  // If nativeType is an enum, use schema-qualified and quoted reference
  const typeRef = enumNames?.has(column.nativeType)
    ? `${quoteIdentifier(schemaName)}.${quoteIdentifier(column.nativeType)}`
    : column.nativeType;
  const parts = [
    `ALTER TABLE ${qualifiedTableName}`,
    `ADD COLUMN ${quoteIdentifier(columnName)} ${typeRef}`,
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
 * Checks if table has a unique constraint satisfied by the given columns.
 * Uses shared semantic satisfaction predicate from verify-helpers.
 */
function hasUniqueConstraint(
  table: SqlSchemaIR['tables'][string],
  columns: readonly string[],
): boolean {
  return isUniqueConstraintSatisfied(table.uniques, table.indexes, columns);
}

/**
 * Checks if table has an index satisfied by the given columns.
 * Uses shared semantic satisfaction predicate from verify-helpers.
 */
function hasIndex(table: SqlSchemaIR['tables'][string], columns: readonly string[]): boolean {
  return isIndexSatisfied(table.indexes, table.uniques, columns);
}

function hasForeignKey(table: SqlSchemaIR['tables'][string], fk: ForeignKey): boolean {
  return table.foreignKeys.some(
    (candidate) =>
      arraysEqual(candidate.columns, fk.columns) &&
      candidate.referencedTable === fk.references.table &&
      arraysEqual(candidate.referencedColumns, fk.references.columns),
  );
}

function isAdditiveIssue(issue: SchemaIssue): boolean {
  switch (issue.kind) {
    case 'missing_table':
    case 'missing_column':
    case 'extension_missing':
    case 'enum_missing':
      return true;
    case 'primary_key_mismatch':
      return issue.actual === undefined;
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'foreign_key_mismatch':
      return issue.indexOrConstraint === undefined;
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
