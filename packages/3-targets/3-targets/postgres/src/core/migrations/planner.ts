import type {
  ComponentDatabaseDependency,
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
} from '@prisma-next/family-sql/control';
import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';

type OperationClass = 'extension' | 'table' | 'unique' | 'index' | 'foreignKey';

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

    const existingTables = Object.keys(options.schema.tables);
    if (existingTables.length > 0) {
      const tableList = existingTables.sort().join(', ');
      return plannerFailure([
        {
          kind: 'unsupportedOperation',
          summary: `The Postgres migration planner currently supports only empty databases. Found ${existingTables.length} existing table(s): ${tableList}`,
          why: 'Remove existing tables or use a future planner mode that handles subsets/supersets.',
        },
      ]);
    }

    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];

    // Build extension operations from component-owned database dependencies
    operations.push(
      ...this.buildDatabaseDependencyOperations(options),
      ...this.buildTableOperations(options.contract.storage.tables, schemaName),
      ...this.buildUniqueOperations(options.contract.storage.tables, schemaName),
      ...this.buildIndexOperations(options.contract.storage.tables, schemaName),
      ...this.buildForeignKeyOperations(options.contract.storage.tables, schemaName),
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
    options: SqlMigrationPlannerPlanOptions,
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
    options: SqlMigrationPlannerPlanOptions,
  ): ReadonlyArray<ComponentDatabaseDependency<unknown>> {
    const components = options.frameworkComponents;
    if (components.length === 0) {
      return [];
    }
    const deps: ComponentDatabaseDependency<unknown>[] = [];
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
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      const qualified = qualifyTableName(schema, tableName);
      operations.push({
        id: `table.${tableName}`,
        label: `Create table ${tableName}`,
        summary: `Creates table ${tableName} with required columns`,
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: this.buildTargetDetails('table', tableName, schema),
        },
        precheck: [
          {
            description: `ensure table "${tableName}" does not exist`,
            sql: `SELECT to_regclass(${toRegclassLiteral(schema, tableName)}) IS NULL`,
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
            sql: `SELECT to_regclass(${toRegclassLiteral(schema, tableName)}) IS NOT NULL`,
          },
        ],
      });
    }
    return operations;
  }

  private buildUniqueOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      for (const unique of table.uniques) {
        const constraintName = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
        operations.push({
          id: `unique.${tableName}.${constraintName}`,
          label: `Add unique constraint ${constraintName} on ${tableName}`,
          summary: `Adds unique constraint ${constraintName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('unique', constraintName, schema, tableName),
          },
          precheck: [
            {
              description: `ensure unique constraint "${constraintName}" is missing`,
              sql: constraintExistsCheck({ constraintName, schema, exists: false }),
            },
          ],
          execute: [
            {
              description: `add unique constraint "${constraintName}"`,
              sql: `ALTER TABLE ${qualifyTableName(schema, tableName)}
ADD CONSTRAINT ${quoteIdentifier(constraintName)}
UNIQUE (${unique.columns.map(quoteIdentifier).join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify unique constraint "${constraintName}" exists`,
              sql: constraintExistsCheck({ constraintName, schema }),
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildIndexOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      for (const index of table.indexes) {
        const indexName = index.name ?? `${tableName}_${index.columns.join('_')}_idx`;
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create index ${indexName} on ${tableName}`,
          summary: `Creates index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('index', indexName, schema, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT to_regclass(${toRegclassLiteral(schema, indexName)}) IS NULL`,
            },
          ],
          execute: [
            {
              description: `create index "${indexName}"`,
              sql: `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualifyTableName(
                schema,
                tableName,
              )} (${index.columns.map(quoteIdentifier).join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify index "${indexName}" exists`,
              sql: `SELECT to_regclass(${toRegclassLiteral(schema, indexName)}) IS NOT NULL`,
            },
          ],
        });
      }
    }
    return operations;
  }

  private buildForeignKeyOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: string,
  ): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
    for (const [tableName, table] of sortedEntries(tables)) {
      for (const foreignKey of table.foreignKeys) {
        const fkName = foreignKey.name ?? `${tableName}_${foreignKey.columns.join('_')}_fkey`;
        operations.push({
          id: `foreignKey.${tableName}.${fkName}`,
          label: `Add foreign key ${fkName} on ${tableName}`,
          summary: `Adds foreign key ${fkName} referencing ${foreignKey.references.table}`,
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: this.buildTargetDetails('foreignKey', fkName, schema, tableName),
          },
          precheck: [
            {
              description: `ensure foreign key "${fkName}" is missing`,
              sql: constraintExistsCheck({ constraintName: fkName, schema, exists: false }),
            },
          ],
          execute: [
            {
              description: `add foreign key "${fkName}"`,
              sql: `ALTER TABLE ${qualifyTableName(schema, tableName)}
ADD CONSTRAINT ${quoteIdentifier(fkName)}
FOREIGN KEY (${foreignKey.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${qualifyTableName(schema, foreignKey.references.table)} (${foreignKey.references.columns
                .map(quoteIdentifier)
                .join(', ')})`,
            },
          ],
          postcheck: [
            {
              description: `verify foreign key "${fkName}" exists`,
              sql: constraintExistsCheck({ constraintName: fkName, schema }),
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
}

function isSqlDependencyProvider(component: unknown): component is {
  readonly databaseDependencies?: {
    readonly init?: readonly ComponentDatabaseDependency<unknown>[];
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
  dependencies: ReadonlyArray<ComponentDatabaseDependency<unknown>>,
): ReadonlyArray<ComponentDatabaseDependency<unknown>> {
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
        column.nativeType,
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

function quoteIdentifier(identifier: string): string {
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
