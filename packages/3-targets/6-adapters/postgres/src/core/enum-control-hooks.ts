import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { arraysEqual } from '@prisma-next/family-sql/schema-verify';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { escapeLiteral, qualifyName, quoteIdentifier } from './sql-utils';

/**
 * Postgres enum control hooks.
 *
 * - Plans enum type operations for migrations
 * - Verifies enum types in schema IR
 * - Introspects enum types from the database
 */
const ENUM_CODEC_ID = 'pg/enum@1';

type EnumRow = {
  schema_name: string;
  type_name: string;
  values: string[];
};

type EnumDiff =
  | { kind: 'unchanged' }
  | { kind: 'add_values'; values: readonly string[] }
  | { kind: 'rebuild' };

// ============================================================================
// Introspection SQL
// ============================================================================

const ENUM_INTROSPECT_QUERY = `
  SELECT
    n.nspname AS schema_name,
    t.typname AS type_name,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
  FROM pg_type t
  JOIN pg_namespace n ON t.typnamespace = n.oid
  JOIN pg_enum e ON t.oid = e.enumtypid
  WHERE n.nspname = $1
  GROUP BY n.nspname, t.typname
  ORDER BY n.nspname, t.typname
`;

// ============================================================================
// Schema Helpers (Simplified)
// ============================================================================

/**
 * Type guard for string arrays. Used for runtime validation of introspected data.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Extracts enum values from a StorageTypeInstance.
 * Returns null if values are missing or invalid.
 */
function getEnumValues(typeInstance: StorageTypeInstance): readonly string[] | null {
  const values = typeInstance.typeParams?.['values'];
  return isStringArray(values) ? values : null;
}

/**
 * Reads existing enum values from the schema IR for a given native type.
 * Uses optional chaining to simplify navigation through the annotations structure.
 */
function readExistingEnumValues(schema: SqlSchemaIR, nativeType: string): readonly string[] | null {
  // Schema annotations.pg.storageTypes is populated by introspection
  const storageTypes = (schema.annotations?.['pg'] as Record<string, unknown> | undefined)?.[
    'storageTypes'
  ] as Record<string, StorageTypeInstance> | undefined;

  const existing = storageTypes?.[nativeType];
  if (!existing || existing.codecId !== ENUM_CODEC_ID) {
    return null;
  }
  return getEnumValues(existing);
}

function determineEnumDiff(existing: readonly string[], desired: readonly string[]): EnumDiff {
  if (arraysEqual(existing, desired)) {
    return { kind: 'unchanged' };
  }

  const missingValues = desired.filter((value) => !existing.includes(value));
  const removedValues = existing.filter((value) => !desired.includes(value));
  const orderMismatch =
    missingValues.length === 0 && removedValues.length === 0 && !arraysEqual(existing, desired);

  if (removedValues.length > 0 || orderMismatch) {
    return { kind: 'rebuild' };
  }

  return { kind: 'add_values', values: missingValues };
}

// ============================================================================
// SQL Helpers
// ============================================================================

function enumTypeExistsCheck(schemaName: string, typeName: string, exists = true): string {
  const existsClause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${existsClause} (
  SELECT 1
  FROM pg_type t
  JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = '${escapeLiteral(schemaName)}'
    AND t.typname = '${escapeLiteral(typeName)}'
)`;
}

// ============================================================================
// Operation Builders
// ============================================================================

function buildCreateEnumOperation(
  typeName: string,
  nativeType: string,
  schemaName: string,
  values: readonly string[],
): SqlMigrationPlanOperation<unknown> {
  const literalValues = values.map((value) => `'${escapeLiteral(value)}'`).join(', ');
  const qualifiedType = qualifyName(schemaName, nativeType);
  return {
    id: `type.${typeName}`,
    label: `Create type ${typeName}`,
    summary: `Creates enum type ${typeName}`,
    operationClass: 'additive',
    target: { id: 'postgres' },
    precheck: [
      {
        description: `ensure type "${nativeType}" does not exist`,
        sql: enumTypeExistsCheck(schemaName, nativeType, false),
      },
    ],
    execute: [
      {
        description: `create type "${nativeType}"`,
        sql: `CREATE TYPE ${qualifiedType} AS ENUM (${literalValues})`,
      },
    ],
    postcheck: [
      {
        description: `verify type "${nativeType}" exists`,
        sql: enumTypeExistsCheck(schemaName, nativeType),
      },
    ],
  };
}

function computeInsertPosition(options: {
  desired: readonly string[];
  desiredIndex: number;
  current: readonly string[];
}): { clause: string; insertAt: number } {
  const { desired, desiredIndex, current } = options;
  const previous = desired
    .slice(0, desiredIndex)
    .reverse()
    .find((candidate) => current.includes(candidate));
  const next = desired.slice(desiredIndex + 1).find((candidate) => current.includes(candidate));
  const clause = previous
    ? ` AFTER '${escapeLiteral(previous)}'`
    : next
      ? ` BEFORE '${escapeLiteral(next)}'`
      : '';
  const insertAt = previous
    ? current.indexOf(previous) + 1
    : next
      ? current.indexOf(next)
      : current.length;

  return { clause, insertAt };
}

function buildAddValueOperations(options: {
  typeName: string;
  nativeType: string;
  schemaName: string;
  desired: readonly string[];
  existing: readonly string[];
}): SqlMigrationPlanOperation<unknown>[] {
  const { typeName, nativeType, schemaName } = options;
  const current = [...options.existing];
  const operations: SqlMigrationPlanOperation<unknown>[] = [];
  for (let index = 0; index < options.desired.length; index += 1) {
    const value = options.desired[index];
    if (value === undefined) {
      continue;
    }
    if (current.includes(value)) {
      continue;
    }
    const { clause, insertAt } = computeInsertPosition({
      desired: options.desired,
      desiredIndex: index,
      current,
    });
    // Use IF NOT EXISTS for idempotency - safe to re-run after partial failures.
    // Supported in PostgreSQL 9.3+, and we require PostgreSQL 12+.
    operations.push({
      id: `type.${typeName}.value.${value}`,
      label: `Add value ${value} to ${typeName}`,
      summary: `Adds enum value ${value} to ${typeName}`,
      operationClass: 'widening',
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `add value "${value}" if not exists`,
          sql: `ALTER TYPE ${qualifyName(schemaName, nativeType)} ADD VALUE IF NOT EXISTS '${escapeLiteral(
            value,
          )}'${clause}`,
        },
      ],
      postcheck: [],
    });
    current.splice(insertAt, 0, value);
  }
  return operations;
}

/**
 * Collects columns using the enum type from the contract (desired state).
 * Used for type-safe reference tracking.
 */
function collectEnumColumnsFromContract(
  contract: SqlContract<SqlStorage>,
  typeName: string,
  nativeType: string,
): ReadonlyArray<{ table: string; column: string }> {
  const columns: Array<{ table: string; column: string }> = [];
  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (
        column.typeRef === typeName ||
        (column.nativeType === nativeType && column.codecId === ENUM_CODEC_ID)
      ) {
        columns.push({ table: tableName, column: columnName });
      }
    }
  }
  return columns;
}

/**
 * Collects columns using the enum type from the schema IR (live database state).
 * This ensures we find ALL dependent columns, including those added outside the contract
 * (e.g., manual DDL), which is critical for safe enum rebuild operations.
 */
function collectEnumColumnsFromSchema(
  schema: SqlSchemaIR,
  nativeType: string,
): ReadonlyArray<{ table: string; column: string }> {
  const columns: Array<{ table: string; column: string }> = [];
  for (const [tableName, table] of Object.entries(schema.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      // Match by nativeType since schema IR doesn't have codecId/typeRef
      if (column.nativeType === nativeType) {
        columns.push({ table: tableName, column: columnName });
      }
    }
  }
  return columns;
}

/**
 * Collects all columns using the enum type from both contract AND live database.
 * Merges and deduplicates to ensure we migrate ALL dependent columns during rebuild.
 *
 * This is critical for data integrity: if a column exists in the database using
 * this enum but is not in the contract (e.g., added via manual DDL), we must
 * still migrate it to avoid DROP TYPE failures.
 */
function collectAllEnumColumns(
  contract: SqlContract<SqlStorage>,
  schema: SqlSchemaIR,
  typeName: string,
  nativeType: string,
): ReadonlyArray<{ table: string; column: string }> {
  const contractColumns = collectEnumColumnsFromContract(contract, typeName, nativeType);
  const schemaColumns = collectEnumColumnsFromSchema(schema, nativeType);

  // Merge and deduplicate using a Set of "table.column" keys
  const seen = new Set<string>();
  const result: Array<{ table: string; column: string }> = [];

  for (const col of [...contractColumns, ...schemaColumns]) {
    const key = `${col.table}.${col.column}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(col);
    }
  }

  // Sort for deterministic operation order
  return result.sort((a, b) => {
    const tableCompare = a.table.localeCompare(b.table);
    return tableCompare !== 0 ? tableCompare : a.column.localeCompare(b.column);
  });
}

/**
 * Builds a SQL check to verify a column's type matches an expected type.
 */
function columnTypeCheck(options: {
  schemaName: string;
  tableName: string;
  columnName: string;
  expectedType: string;
}): string {
  return `SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = '${escapeLiteral(options.schemaName)}'
    AND table_name = '${escapeLiteral(options.tableName)}'
    AND column_name = '${escapeLiteral(options.columnName)}'
    AND udt_name = '${escapeLiteral(options.expectedType)}'
)`;
}

/** PostgreSQL maximum identifier length (NAMEDATALEN - 1) */
const MAX_IDENTIFIER_LENGTH = 63;

/** Suffix added to enum type names during rebuild operations */
const REBUILD_SUFFIX = '__pn_rebuild';

function buildRecreateEnumOperation(options: {
  typeName: string;
  nativeType: string;
  schemaName: string;
  values: readonly string[];
  contract: SqlContract<SqlStorage>;
  schema: SqlSchemaIR;
}): SqlMigrationPlanOperation<unknown> {
  const tempTypeName = `${options.nativeType}${REBUILD_SUFFIX}`;

  // Validate temp type name length won't exceed PostgreSQL's 63-character limit.
  // If it would, PostgreSQL silently truncates which could cause conflicts.
  if (tempTypeName.length > MAX_IDENTIFIER_LENGTH) {
    const maxBaseLength = MAX_IDENTIFIER_LENGTH - REBUILD_SUFFIX.length;
    throw new Error(
      `Enum type name "${options.nativeType}" is too long for rebuild operation. ` +
        `Maximum length is ${maxBaseLength} characters (type name + "${REBUILD_SUFFIX}" suffix ` +
        `must fit within PostgreSQL's ${MAX_IDENTIFIER_LENGTH}-character identifier limit).`,
    );
  }

  const qualifiedOriginal = qualifyName(options.schemaName, options.nativeType);
  const qualifiedTemp = qualifyName(options.schemaName, tempTypeName);
  const literalValues = options.values.map((value) => `'${escapeLiteral(value)}'`).join(', ');

  // CRITICAL: Collect columns from BOTH contract AND live database.
  // This ensures we migrate ALL dependent columns, including those added
  // outside of Prisma Next (e.g., manual DDL). Without this, DROP TYPE
  // would fail if the database has columns not tracked in the contract.
  const columnRefs = collectAllEnumColumns(
    options.contract,
    options.schema,
    options.typeName,
    options.nativeType,
  );

  const alterColumns = columnRefs.map((ref) => ({
    description: `alter ${ref.table}.${ref.column} to ${tempTypeName}`,
    sql: `ALTER TABLE ${qualifyName(options.schemaName, ref.table)}
ALTER COLUMN ${quoteIdentifier(ref.column)}
TYPE ${qualifiedTemp}
USING ${quoteIdentifier(ref.column)}::text::${qualifiedTemp}`,
  }));

  // Build postchecks to verify:
  // 1. The final type exists with the correct name
  // 2. The temp type was cleaned up (renamed away)
  // 3. All migrated columns now reference the final type
  const postchecks = [
    {
      description: `verify type "${options.nativeType}" exists`,
      sql: enumTypeExistsCheck(options.schemaName, options.nativeType),
    },
    {
      description: `verify temp type "${tempTypeName}" was removed`,
      sql: enumTypeExistsCheck(options.schemaName, tempTypeName, false),
    },
    // Verify each column was successfully migrated to the final type
    ...columnRefs.map((ref) => ({
      description: `verify ${ref.table}.${ref.column} uses type "${options.nativeType}"`,
      sql: columnTypeCheck({
        schemaName: options.schemaName,
        tableName: ref.table,
        columnName: ref.column,
        expectedType: options.nativeType,
      }),
    })),
  ];

  return {
    id: `type.${options.typeName}.rebuild`,
    label: `Rebuild type ${options.typeName}`,
    summary: `Recreates enum type ${options.typeName} with updated values`,
    operationClass: 'destructive',
    target: { id: 'postgres' },
    precheck: [
      {
        description: `ensure type "${options.nativeType}" exists`,
        sql: enumTypeExistsCheck(options.schemaName, options.nativeType),
      },
      // Note: We don't precheck that temp type doesn't exist because we handle
      // orphaned temp types in the execute step below.
    ],
    execute: [
      // Clean up any orphaned temp type from a previous failed migration.
      // This makes the operation recoverable without manual intervention.
      // DROP TYPE IF EXISTS is safe - it's a no-op if the type doesn't exist.
      {
        description: `drop orphaned temp type "${tempTypeName}" if exists`,
        sql: `DROP TYPE IF EXISTS ${qualifiedTemp}`,
      },
      {
        description: `create temp type "${tempTypeName}"`,
        sql: `CREATE TYPE ${qualifiedTemp} AS ENUM (${literalValues})`,
      },
      ...alterColumns,
      {
        description: `drop type "${options.nativeType}"`,
        sql: `DROP TYPE ${qualifiedOriginal}`,
      },
      {
        description: `rename type "${tempTypeName}" to "${options.nativeType}"`,
        sql: `ALTER TYPE ${qualifiedTemp} RENAME TO ${quoteIdentifier(options.nativeType)}`,
      },
    ],
    postcheck: postchecks,
  };
}

// ============================================================================
// Codec Control Hooks
// ============================================================================

/**
 * Postgres enum hooks for planning, verifying, and introspecting `storage.types`.
 */
export const pgEnumControlHooks: CodecControlHooks = {
  planTypeOperations: ({ typeName, typeInstance, contract, schema, schemaName }) => {
    const desired = getEnumValues(typeInstance);
    if (!desired || desired.length === 0) {
      return { operations: [] };
    }

    const schemaNamespace = schemaName ?? 'public';
    const existing = readExistingEnumValues(schema, typeInstance.nativeType);
    if (!existing) {
      return {
        operations: [
          buildCreateEnumOperation(typeName, typeInstance.nativeType, schemaNamespace, desired),
        ],
      };
    }

    const diff = determineEnumDiff(existing, desired);
    if (diff.kind === 'unchanged') {
      return { operations: [] };
    }

    if (diff.kind === 'rebuild') {
      return {
        operations: [
          buildRecreateEnumOperation({
            typeName,
            nativeType: typeInstance.nativeType,
            schemaName: schemaNamespace,
            values: desired,
            contract,
            schema,
          }),
        ],
      };
    }

    return {
      operations: buildAddValueOperations({
        typeName,
        nativeType: typeInstance.nativeType,
        schemaName: schemaNamespace,
        desired,
        existing,
      }),
    };
  },
  verifyType: ({ typeName, typeInstance, schema }) => {
    const desired = getEnumValues(typeInstance);
    if (!desired) {
      return [];
    }
    const existing = readExistingEnumValues(schema, typeInstance.nativeType);
    if (!existing) {
      return [
        {
          kind: 'type_missing',
          table: '',
          typeName,
          message: `Type "${typeName}" is missing from database`,
        },
      ];
    }
    if (!arraysEqual(existing, desired)) {
      return [
        {
          kind: 'type_values_mismatch',
          table: '',
          typeName,
          expected: desired.join(', '),
          actual: existing.join(', '),
          message: `Type "${typeName}" values do not match contract`,
        },
      ];
    }
    return [];
  },
  introspectTypes: async ({ driver, schemaName }) => {
    const namespace = schemaName ?? 'public';
    const result = await driver.query<EnumRow>(ENUM_INTROSPECT_QUERY, [namespace]);
    const types: Record<string, StorageTypeInstance> = {};
    for (const row of result.rows) {
      if (!isStringArray(row.values)) {
        continue;
      }
      types[row.type_name] = {
        codecId: ENUM_CODEC_ID,
        nativeType: row.type_name,
        typeParams: { values: row.values },
      };
    }
    return types;
  },
};
