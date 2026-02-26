import {
  escapeLiteral,
  expandParameterizedNativeType,
  quoteIdentifier,
} from '@prisma-next/adapter-postgres/control';
import type {
  EmitAddColumnInput,
  EmitAddForeignKeyInput,
  EmitAddPrimaryKeyInput,
  EmitAddUniqueConstraintInput,
  EmitCreateIndexInput,
  EmitCreateStorageTypeInput,
  EmitCreateTableInput,
  EmitEnableExtensionInput,
  SqlEmitter,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresColumnDefault } from '../types';
import type { PostgresPlanTargetDetails } from './planner';

type OperationClass = 'extension' | 'type' | 'table' | 'unique' | 'index' | 'foreignKey';

interface PostgresSqlEmitterConfig {
  readonly defaultSchema: string;
}

const DEFAULT_CONFIG: PostgresSqlEmitterConfig = {
  defaultSchema: 'public',
};

export function createPostgresSqlEmitter(
  config: Partial<PostgresSqlEmitterConfig> = {},
): SqlEmitter {
  const cfg: PostgresSqlEmitterConfig = { ...DEFAULT_CONFIG, ...config };
  return new PostgresSqlEmitterImpl(cfg);
}

class PostgresSqlEmitterImpl implements SqlEmitter {
  constructor(private readonly config: PostgresSqlEmitterConfig) {}

  private get schema(): string {
    return this.config.defaultSchema;
  }

  emitCreateTable(
    input: EmitCreateTableInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { tableName, table } = input;
    const qualified = this.qualifyTable(tableName);

    return {
      id: `table.${tableName}`,
      label: `Create table ${tableName}`,
      summary: `Creates table ${tableName} with required columns`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('table', tableName),
      },
      precheck: [
        {
          description: `ensure table "${tableName}" does not exist`,
          sql: `SELECT to_regclass(${this.toRegclassLiteral(tableName)}) IS NULL`,
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
          sql: `SELECT to_regclass(${this.toRegclassLiteral(tableName)}) IS NOT NULL`,
        },
      ],
    };
  }

  emitAddColumn(input: EmitAddColumnInput): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { tableName, columnName, column } = input;
    const qualified = this.qualifyTable(tableName);
    const notNull = !column.nullable;
    const hasDefault = column.default !== undefined;
    const requiresEmptyTable = notNull && !hasDefault;

    const precheck = [
      {
        description: `ensure column "${columnName}" is missing`,
        sql: columnExistsCheck({
          schema: this.schema,
          table: tableName,
          column: columnName,
          exists: false,
        }),
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

    const postcheck = [
      {
        description: `verify column "${columnName}" exists`,
        sql: columnExistsCheck({ schema: this.schema, table: tableName, column: columnName }),
      },
      ...(notNull
        ? [
            {
              description: `verify column "${columnName}" is NOT NULL`,
              sql: columnIsNotNullCheck({
                schema: this.schema,
                table: tableName,
                column: columnName,
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
        details: this.targetDetails('table', tableName),
      },
      precheck,
      execute: [
        {
          description: `add column "${columnName}"`,
          sql: buildAddColumnSql(qualified, columnName, column),
        },
      ],
      postcheck,
    };
  }

  emitAddPrimaryKey(
    input: EmitAddPrimaryKeyInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { tableName, constraintName, columns } = input;

    return {
      id: `primaryKey.${tableName}.${constraintName}`,
      label: `Add primary key ${constraintName} on ${tableName}`,
      summary: `Adds primary key ${constraintName} on ${tableName}`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('table', tableName),
      },
      precheck: [
        {
          description: `ensure primary key does not exist on "${tableName}"`,
          sql: tableHasPrimaryKeyCheck(this.schema, tableName, false),
        },
      ],
      execute: [
        {
          description: `add primary key "${constraintName}"`,
          sql: `ALTER TABLE ${this.qualifyTable(tableName)}\nADD CONSTRAINT ${quoteIdentifier(constraintName)}\nPRIMARY KEY (${columns.map(quoteIdentifier).join(', ')})`,
        },
      ],
      postcheck: [
        {
          description: `verify primary key "${constraintName}" exists`,
          sql: tableHasPrimaryKeyCheck(this.schema, tableName, true, constraintName),
        },
      ],
    };
  }

  emitAddUniqueConstraint(
    input: EmitAddUniqueConstraintInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { tableName, constraintName, columns } = input;

    return {
      id: `unique.${tableName}.${constraintName}`,
      label: `Add unique constraint ${constraintName} on ${tableName}`,
      summary: `Adds unique constraint ${constraintName} on ${tableName}`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('unique', constraintName, tableName),
      },
      precheck: [
        {
          description: `ensure unique constraint "${constraintName}" is missing`,
          sql: constraintExistsCheck({ constraintName, schema: this.schema, exists: false }),
        },
      ],
      execute: [
        {
          description: `add unique constraint "${constraintName}"`,
          sql: `ALTER TABLE ${this.qualifyTable(tableName)}\nADD CONSTRAINT ${quoteIdentifier(constraintName)}\nUNIQUE (${columns.map(quoteIdentifier).join(', ')})`,
        },
      ],
      postcheck: [
        {
          description: `verify unique constraint "${constraintName}" exists`,
          sql: constraintExistsCheck({ constraintName, schema: this.schema }),
        },
      ],
    };
  }

  emitCreateIndex(
    input: EmitCreateIndexInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { tableName, indexName, columns } = input;

    return {
      id: `index.${tableName}.${indexName}`,
      label: `Create index ${indexName} on ${tableName}`,
      summary: `Creates index ${indexName} on ${tableName}`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('index', indexName, tableName),
      },
      precheck: [
        {
          description: `ensure index "${indexName}" is missing`,
          sql: `SELECT to_regclass(${this.toRegclassLiteral(indexName)}) IS NULL`,
        },
      ],
      execute: [
        {
          description: `create index "${indexName}"`,
          sql: `CREATE INDEX ${quoteIdentifier(indexName)} ON ${this.qualifyTable(tableName)} (${columns.map(quoteIdentifier).join(', ')})`,
        },
      ],
      postcheck: [
        {
          description: `verify index "${indexName}" exists`,
          sql: `SELECT to_regclass(${this.toRegclassLiteral(indexName)}) IS NOT NULL`,
        },
      ],
    };
  }

  emitAddForeignKey(
    input: EmitAddForeignKeyInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { tableName, constraintName, foreignKey } = input;

    return {
      id: `foreignKey.${tableName}.${constraintName}`,
      label: `Add foreign key ${constraintName} on ${tableName}`,
      summary: `Adds foreign key ${constraintName} referencing ${foreignKey.references.table}`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('foreignKey', constraintName, tableName),
      },
      precheck: [
        {
          description: `ensure foreign key "${constraintName}" is missing`,
          sql: constraintExistsCheck({ constraintName, schema: this.schema, exists: false }),
        },
      ],
      execute: [
        {
          description: `add foreign key "${constraintName}"`,
          sql: `ALTER TABLE ${this.qualifyTable(tableName)}\nADD CONSTRAINT ${quoteIdentifier(constraintName)}\nFOREIGN KEY (${foreignKey.columns.map(quoteIdentifier).join(', ')})\nREFERENCES ${this.qualifyTable(foreignKey.references.table)} (${foreignKey.references.columns.map(quoteIdentifier).join(', ')})`,
        },
      ],
      postcheck: [
        {
          description: `verify foreign key "${constraintName}" exists`,
          sql: constraintExistsCheck({ constraintName, schema: this.schema }),
        },
      ],
    };
  }

  emitEnableExtension(
    input: EmitEnableExtensionInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { extension, dependencyId } = input;

    return {
      id: `extension.${extension}`,
      label: `Enable extension ${extension}`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('extension', extension),
      },
      precheck: [
        {
          description: `ensure extension "${extension}" is not installed`,
          sql: extensionExistsCheck(extension, false),
        },
      ],
      execute: [
        {
          description: `enable extension "${extension}"`,
          sql: `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extension)}`,
        },
      ],
      postcheck: [
        {
          description: `verify extension "${extension}" is installed`,
          sql: extensionExistsCheck(extension, true),
        },
      ],
      meta: { dependencyId },
    };
  }

  emitCreateStorageType(
    input: EmitCreateStorageTypeInput,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
    const { typeName, typeInstance } = input;
    const isEnum = typeInstance.codecId.includes('enum');
    const values = isEnum
      ? ((typeInstance.typeParams?.['values'] as string[] | undefined) ?? [])
      : [];

    const executeSql = isEnum
      ? `CREATE TYPE ${quoteIdentifier(typeInstance.nativeType)} AS ENUM (${values.map((v) => `'${escapeLiteral(v)}'`).join(', ')})`
      : `CREATE TYPE ${quoteIdentifier(typeInstance.nativeType)}`;

    return {
      id: `storageType.${typeName}`,
      label: `Create storage type ${typeName}`,
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: this.targetDetails('type', typeName),
      },
      precheck: [],
      execute: [
        {
          description: `create type "${typeInstance.nativeType}"`,
          sql: executeSql,
        },
      ],
      postcheck: [],
      meta: {
        codecId: typeInstance.codecId,
        nativeType: typeInstance.nativeType,
        typeParams: typeInstance.typeParams,
      },
    };
  }

  private qualifyTable(table: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(table)}`;
  }

  private toRegclassLiteral(name: string): string {
    const regclass = `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`;
    return `'${escapeLiteral(regclass)}'`;
  }

  private targetDetails(
    objectType: OperationClass,
    name: string,
    table?: string,
  ): PostgresPlanTargetDetails {
    return {
      schema: this.schema,
      objectType,
      name,
      ...ifDefined('table', table),
    };
  }
}

// ============================================================================
// SQL generation helpers (extracted from planner.ts)
// ============================================================================

function buildCreateTableSql(qualifiedTableName: string, table: StorageTable): string {
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

  const allDefinitions = [...columnDefinitions, ...constraintDefinitions];
  return `CREATE TABLE ${qualifiedTableName} (\n  ${allDefinitions.join(',\n  ')}\n)`;
}

function buildColumnTypeSql(column: StorageColumn): string {
  const columnDefault = column.default;

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

  return renderParameterizedTypeSql(column) ?? column.nativeType;
}

function renderParameterizedTypeSql(column: StorageColumn): string | null {
  if (!column.typeParams) {
    return null;
  }

  const expanded = expandParameterizedNativeType({
    nativeType: column.nativeType,
    codecId: column.codecId,
    typeParams: column.typeParams,
  });

  return expanded !== column.nativeType ? expanded : null;
}

function buildColumnDefaultSql(columnDefault: PostgresColumnDefault | undefined): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${columnDefault.expression}`;
    case 'function': {
      if (columnDefault.expression === 'autoincrement()') {
        return '';
      }
      return `DEFAULT ${columnDefault.expression}`;
    }
    case 'sequence':
      return `DEFAULT nextval(${quoteIdentifier(columnDefault.name)}::regclass)`;
  }
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
  return `SELECT ${existsClause} (\n  SELECT 1 FROM pg_constraint c\n  JOIN pg_namespace n ON c.connamespace = n.oid\n  WHERE c.conname = '${escapeLiteral(constraintName)}'\n  AND n.nspname = '${escapeLiteral(schema)}'\n)`;
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
  return `SELECT ${existsClause}EXISTS (\n  SELECT 1\n  FROM information_schema.columns\n  WHERE table_schema = '${escapeLiteral(schema)}'\n    AND table_name = '${escapeLiteral(table)}'\n    AND column_name = '${escapeLiteral(column)}'\n)`;
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
  return `SELECT EXISTS (\n  SELECT 1\n  FROM information_schema.columns\n  WHERE table_schema = '${escapeLiteral(schema)}'\n    AND table_name = '${escapeLiteral(table)}'\n    AND column_name = '${escapeLiteral(column)}'\n    AND is_nullable = 'NO'\n)`;
}

function tableIsEmptyCheck(qualifiedTableName: string): string {
  return `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedTableName} LIMIT 1)`;
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
  return `SELECT ${comparison}EXISTS (\n  SELECT 1\n  FROM pg_index i\n  JOIN pg_class c ON c.oid = i.indrelid\n  JOIN pg_namespace n ON n.oid = c.relnamespace\n  LEFT JOIN pg_class c2 ON c2.oid = i.indexrelid\n  WHERE n.nspname = '${escapeLiteral(schema)}'\n    AND c.relname = '${escapeLiteral(table)}'\n    AND i.indisprimary\n    ${constraintFilter}\n)`;
}

function extensionExistsCheck(extension: string, exists: boolean): string {
  const clause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${clause} (\n  SELECT 1 FROM pg_extension WHERE extname = '${escapeLiteral(extension)}'\n)`;
}
