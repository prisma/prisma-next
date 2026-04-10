import { normalizeSqliteNativeType, parseSqliteDefault } from '@prisma-next/adapter-sqlite/control';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import {
  createMigrationPlan,
  extractCodecControlHooks,
  plannerFailure,
  plannerSuccess,
} from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  buildAddColumnSql,
  buildCreateIndexSql,
  buildCreateTableSql,
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

    const schemaIssues = this.collectSchemaIssues(options);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    const storageTypes = options.contract.storage.types ?? {};
    const sortedTables = sortedEntries(options.contract.storage.tables);

    const schemaIndexSets = buildSchemaIndexLookup(options.schema);

    void schemaIssues;

    operations.push(
      ...this.buildTableOperations(sortedTables, options.schema, codecHooks, storageTypes),
      ...this.buildColumnOperations(sortedTables, options.schema, codecHooks, storageTypes),
      ...this.buildIndexOperations(sortedTables, schemaIndexSets),
      ...this.buildFkBackingIndexOperations(sortedTables, schemaIndexSets),
    );

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

  private buildTableOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
  ): readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] {
    const operations: SqlMigrationPlanOperation<SqlitePlanTargetDetails>[] = [];
    for (const [tableName, table] of tables) {
      if (schema.tables[tableName]) {
        continue;
      }
      operations.push({
        id: `table.${tableName}`,
        label: `Create table ${tableName}`,
        summary: `Creates table ${tableName} with required columns`,
        operationClass: 'additive',
        target: {
          id: 'sqlite',
          details: buildTargetDetails('table', tableName),
        },
        precheck: [
          {
            description: `ensure table "${tableName}" does not exist`,
            sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeSqliteLiteral(tableName)}'`,
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
            sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '${escapeSqliteLiteral(tableName)}'`,
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
      if (!schemaTable) {
        continue;
      }
      for (const [columnName, column] of sortedEntries(table.columns)) {
        if (schemaTable.columns[columnName]) {
          continue;
        }
        operations.push(
          this.buildAddColumnOperation(tableName, columnName, column, codecHooks, storageTypes),
        );
      }
    }
    return operations;
  }

  private buildAddColumnOperation(
    tableName: string,
    columnName: string,
    column: StorageColumn,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
  ): SqlMigrationPlanOperation<SqlitePlanTargetDetails> {
    return {
      id: `column.${tableName}.${columnName}`,
      label: `Add column ${columnName} on ${tableName}`,
      summary: `Adds column ${columnName} on ${tableName}`,
      operationClass: 'additive',
      target: {
        id: 'sqlite',
        details: buildTargetDetails('column', columnName, tableName),
      },
      precheck: [
        {
          description: `ensure column "${columnName}" is missing`,
          sql: `SELECT COUNT(*) = 0 FROM pragma_table_info('${escapeSqliteLiteral(tableName)}') WHERE name = '${escapeSqliteLiteral(columnName)}'`,
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
          sql: `SELECT COUNT(*) > 0 FROM pragma_table_info('${escapeSqliteLiteral(tableName)}') WHERE name = '${escapeSqliteLiteral(columnName)}'`,
        },
      ],
    };
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
        if (existingIndexes?.has(indexKey)) {
          continue;
        }
        const indexName = index.name ?? defaultIndexName(tableName, index.columns);
        operations.push({
          id: `index.${tableName}.${indexName}`,
          label: `Create index ${indexName} on ${tableName}`,
          summary: `Creates index ${indexName} on ${tableName}`,
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: buildTargetDetails('index', indexName, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${escapeSqliteLiteral(indexName)}'`,
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
              sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${escapeSqliteLiteral(indexName)}'`,
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
          target: {
            id: 'sqlite',
            details: buildTargetDetails('index', indexName, tableName),
          },
          precheck: [
            {
              description: `ensure index "${indexName}" is missing`,
              sql: `SELECT COUNT(*) = 0 FROM sqlite_master WHERE type = 'index' AND name = '${escapeSqliteLiteral(indexName)}'`,
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
              sql: `SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'index' AND name = '${escapeSqliteLiteral(indexName)}'`,
            },
          ],
        });
      }
    }
    return operations;
  }

  private collectSchemaIssues(options: SqlMigrationPlannerPlanOptions): readonly SchemaIssue[] {
    const verifyResult = verifySqlSchema({
      contract: options.contract,
      schema: options.schema,
      strict: false,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
      normalizeDefault: parseSqliteDefault,
      normalizeNativeType: normalizeSqliteNativeType,
    });
    return verifyResult.schema.issues;
  }
}

function escapeSqliteLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildSchemaIndexLookup(schema: SqlSchemaIR): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const indexSet = new Set<string>();
    for (const idx of table.indexes) {
      indexSet.add(idx.columns.join(','));
    }
    map.set(tableName, indexSet);
  }
  return map;
}

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}
