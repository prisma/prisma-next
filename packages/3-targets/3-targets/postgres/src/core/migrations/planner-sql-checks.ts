import { escapeLiteral, quoteIdentifier } from '@prisma-next/adapter-postgres/control';

export function qualifyTableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function toRegclassLiteral(schema: string, name: string): string {
  const regclass = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  return `'${escapeLiteral(regclass)}'`;
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
