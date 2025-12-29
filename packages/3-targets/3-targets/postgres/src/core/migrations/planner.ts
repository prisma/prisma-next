import type {
  MigrationPlanner,
  MigrationPlannerPlanOptions,
  MigrationPlanOperation,
  MigrationPolicy,
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

const PG_EXTENSION_SQL: Record<string, string> = {
  pgvector: 'CREATE EXTENSION IF NOT EXISTS vector',
};

export function createPostgresMigrationPlanner(
  config: Partial<PlannerConfig> = {},
): MigrationPlanner<PostgresPlanTargetDetails> {
  return new PostgresMigrationPlanner({
    ...DEFAULT_PLANNER_CONFIG,
    ...config,
  });
}

class PostgresMigrationPlanner implements MigrationPlanner<PostgresPlanTargetDetails> {
  constructor(private readonly config: PlannerConfig) {}

  plan(options: MigrationPlannerPlanOptions) {
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

    const operations: MigrationPlanOperation<PostgresPlanTargetDetails>[] = [];

    operations.push(
      ...this.buildExtensionOperations(options.contract, schemaName),
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

  private ensureAdditivePolicy(policy: MigrationPolicy) {
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

  private buildExtensionOperations(
    contract: SqlContract<SqlStorage>,
    schema: string,
  ): readonly MigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const extensions = contract.extensions ?? {};
    const extensionNames = Object.keys(extensions);
    const operations: MigrationPlanOperation<PostgresPlanTargetDetails>[] = [];

    // Check for unsupported extensions and fail fast
    const unsupportedExtensions = extensionNames.filter(
      (extensionName) => !PG_EXTENSION_SQL[extensionName],
    );
    if (unsupportedExtensions.length > 0) {
      const supportedExtensions = Object.keys(PG_EXTENSION_SQL).join(', ');
      const unsupportedList = unsupportedExtensions.join(', ');
      throw new Error(
        `Unsupported PostgreSQL extensions in contract: ${unsupportedList}. ` +
          `The Postgres migration planner currently only supports the following extensions: ${supportedExtensions}. ` +
          'Extensions are defined in contract.extensions.',
      );
    }

    for (const extensionName of extensionNames) {
      const sql = PG_EXTENSION_SQL[extensionName];
      if (!sql) {
        // This should never happen since we validate extensions above, but TypeScript requires this check
        throw new Error(`Extension SQL not found for ${extensionName}`);
      }
      const details = this.buildTargetDetails('extension', extensionName, schema);
      operations.push({
        id: `extension.${extensionName}`,
        label: `Enable extension "${extensionName}"`,
        summary: `Ensures the ${extensionName} extension is available`,
        operationClass: 'additive',
        target: { id: 'postgres', details },
        precheck: [
          {
            description: `verify extension "${extensionName}" is not already enabled`,
            sql: `SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = '${escapeLiteral(
              this.extensionDatabaseName(extensionName),
            )}')`,
          },
        ],
        execute: [
          {
            description: `create extension "${extensionName}"`,
            sql,
          },
        ],
        postcheck: [
          {
            description: `confirm extension "${extensionName}" is enabled`,
            sql: `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = '${escapeLiteral(
              this.extensionDatabaseName(extensionName),
            )}')`,
          },
        ],
      });
    }

    return operations;
  }

  private extensionDatabaseName(extensionName: string): string {
    if (extensionName === 'pgvector') {
      return 'vector';
    }
    return extensionName;
  }

  private buildTableOperations(
    tables: SqlContract<SqlStorage>['storage']['tables'],
    schema: string,
  ): readonly MigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: MigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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
  ): readonly MigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: MigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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
  ): readonly MigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: MigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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
  ): readonly MigrationPlanOperation<PostgresPlanTargetDetails>[] {
    const operations: MigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
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
