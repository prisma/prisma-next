import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type {
  PostgresEnumStorageEntry,
  StorageColumn,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { postgresCreateNamespace } from '../postgres-schema';
import { escapeLiteral, quoteIdentifier } from '../sql-utils';
import { resolveColumnTypeMetadata } from './planner-type-resolution';

/**
 * String-keyed entry points the migration ops use to render
 * schema-qualified DDL and catalog checks. The `schema` argument is
 * interpreted as a namespace coordinate: the framework `__unbound__`
 * sentinel resolves to the late-bound `PostgresUnboundSchema` singleton
 * (which elides the qualifier so `search_path` decides at runtime); any
 * other id materialises a `PostgresSchema(id)` whose qualifier is the
 * named schema. Helpers route through these `Namespace` concretions so
 * the unbound branch lives in the polymorphic override, not the call
 * site.
 */
export function qualifyTableName(schema: string, table: string): string {
  return postgresCreateNamespace({ id: schema, entries: { table: {} } }).qualifyTable(table);
}

export function toRegclassLiteral(schema: string, name: string): string {
  return postgresCreateNamespace({ id: schema, entries: { table: {} } }).regclassLiteral(name);
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
  const namespace = postgresCreateNamespace({ id: schema, entries: { table: {} } });
  const existsClause = exists ? '' : 'NOT ';
  return `SELECT ${existsClause}EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = ${namespace.schemaSqlExpression()}
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
  const namespace = postgresCreateNamespace({ id: schema, entries: { table: {} } });
  const expected = nullable ? 'YES' : 'NO';
  return `SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = ${namespace.schemaSqlExpression()}
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
  const namespace = postgresCreateNamespace({ id: opts.schema, entries: { table: {} } });
  return `SELECT NOT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = ${namespace.schemaSqlExpression()}
    AND table_name = '${escapeLiteral(opts.table)}'
    AND column_name = '${escapeLiteral(opts.column)}'
    AND column_default IS NOT NULL
)`;
}

export function tableHasPrimaryKeyCheck(
  schema: string,
  table: string,
  exists: boolean,
  constraintName?: string,
): string {
  const namespace = postgresCreateNamespace({ id: schema, entries: { table: {} } });
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
  WHERE n.nspname = ${namespace.schemaSqlExpression()}
    AND c.relname = '${escapeLiteral(table)}'
    AND i.indisprimary
    ${constraintFilter}
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
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);

  if (resolved.typeParams && resolved.codecId) {
    const hooks = codecHooks.get(resolved.codecId);
    if (hooks?.expandNativeType) {
      return hooks.expandNativeType({
        nativeType: resolved.nativeType,
        codecId: resolved.codecId,
        typeParams: resolved.typeParams,
      });
    }
  }

  if (column.typeRef) {
    return formatUserDefinedTypeName(resolved.nativeType);
  }

  return FORMAT_TYPE_DISPLAY.get(resolved.nativeType) ?? resolved.nativeType;
}
