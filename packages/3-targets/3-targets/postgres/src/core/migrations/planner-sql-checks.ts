import { escapeLiteral, quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageColumn } from '@prisma-next/sql-contract/types';

export function qualifyTableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function toRegclassLiteral(schema: string, name: string): string {
  const regclass = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  return `'${escapeLiteral(regclass)}'`;
}

/**
 * When `table` is omitted the check matches by name + schema across all tables.
 * Pass `table` to scope the check to a single table (prevents false matches on
 * identically-named constraints in different tables).
 */
export function constraintExistsCheck({
  constraintName,
  schema,
  table,
  exists = true,
}: {
  constraintName: string;
  schema: string;
  table?: string;
  exists?: boolean;
}): string {
  const existsClause = exists ? 'EXISTS' : 'NOT EXISTS';
  const tableFilter = table
    ? `AND c.conrelid = to_regclass(${toRegclassLiteral(schema, table)})`
    : '';
  return `SELECT ${existsClause} (
  SELECT 1 FROM pg_constraint c
  JOIN pg_namespace n ON c.connamespace = n.oid
  WHERE c.conname = '${escapeLiteral(constraintName)}'
  AND n.nspname = '${escapeLiteral(schema)}'
  ${tableFilter}
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

export function tableIsEmptyCheck(qualifiedTableName: string): string {
  return `SELECT NOT EXISTS (SELECT 1 FROM ${qualifiedTableName} LIMIT 1)`;
}

export function columnHasNoDefaultCheck(opts: {
  schema: string;
  table: string;
  column: string;
}): string {
  return `SELECT NOT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = '${escapeLiteral(opts.schema)}'
    AND table_name = '${escapeLiteral(opts.table)}'
    AND column_name = '${escapeLiteral(opts.column)}'
    AND column_default IS NOT NULL
)`;
}

const FORMAT_TYPE_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['int2', 'smallint'],
  ['int4', 'integer'],
  ['int8', 'bigint'],
  ['float4', 'real'],
  ['float8', 'double precision'],
  ['bool', 'boolean'],
  ['timestamp', 'timestamp without time zone'],
  ['timestamptz', 'timestamp with time zone'],
  ['time', 'time without time zone'],
  ['timetz', 'time with time zone'],
]);

const UNQUOTED_POSTGRES_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_$]*$/;

const POSTGRES_RESERVED_IDENTIFIER_WORDS = new Set([
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'asymmetric',
  'authorization',
  'between',
  'binary',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'column',
  'constraint',
  'create',
  'current_catalog',
  'current_date',
  'current_role',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'freeze',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'ilike',
  'in',
  'initially',
  'inner',
  'intersect',
  'into',
  'is',
  'isnull',
  'join',
  'lateral',
  'leading',
  'left',
  'like',
  'limit',
  'localtime',
  'localtimestamp',
  'natural',
  'not',
  'notnull',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'overlaps',
  'placing',
  'primary',
  'references',
  'right',
  'select',
  'session_user',
  'similar',
  'some',
  'symmetric',
  'table',
  'then',
  'to',
  'trailing',
  'true',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'verbose',
  'when',
  'where',
  'window',
  'with',
]);

function formatUserDefinedTypeName(identifier: string): string {
  if (
    UNQUOTED_POSTGRES_IDENTIFIER_PATTERN.test(identifier) &&
    !POSTGRES_RESERVED_IDENTIFIER_WORDS.has(identifier)
  ) {
    return identifier;
  }

  return quoteIdentifier(identifier);
}

export function buildExpectedFormatType(
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
): string {
  if (column.typeParams && column.codecId) {
    const hooks = codecHooks.get(column.codecId);
    if (hooks?.expandNativeType) {
      return hooks.expandNativeType({
        nativeType: column.nativeType,
        codecId: column.codecId,
        typeParams: column.typeParams,
      });
    }
  }

  if (column.typeRef) {
    return formatUserDefinedTypeName(column.nativeType);
  }

  return FORMAT_TYPE_DISPLAY.get(column.nativeType) ?? column.nativeType;
}

export function columnTypeCheck({
  schema,
  table,
  column,
  expectedType,
}: {
  schema: string;
  table: string;
  column: string;
  expectedType: string;
}): string {
  return `SELECT EXISTS (
  SELECT 1
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '${escapeLiteral(schema)}'
    AND c.relname = '${escapeLiteral(table)}'
    AND a.attname = '${escapeLiteral(column)}'
    AND format_type(a.atttypid, a.atttypmod) = '${escapeLiteral(expectedType)}'
    AND NOT a.attisdropped
)`;
}

export function columnDefaultExistsCheck({
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
  const nullCheck = exists ? 'IS NOT NULL' : 'IS NULL';
  return `SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = '${escapeLiteral(schema)}'
    AND table_name = '${escapeLiteral(table)}'
    AND column_name = '${escapeLiteral(column)}'
    AND column_default ${nullCheck}
)`;
}

export function tableHasPrimaryKeyCheck(
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
