import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { arraysEqual } from '@prisma-next/family-sql/schema-verify';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { PG_ENUM_CODEC_ID } from './codec-ids';
import { escapeLiteral, qualifyName, quoteIdentifier, validateEnumValueLength } from './sql-utils';

/**
 * Postgres enum control hooks.
 *
 * - Plans enum type operations for migrations
 * - Verifies enum types in schema IR
 * - Introspects enum types from the database
 */
type EnumRow = {
  schema_name: string;
  type_name: string;
  values: string[];
};

type EnumDiff =
  | { kind: 'unchanged' }
  | { kind: 'add_values'; values: readonly string[] }
  | { kind: 'rebuild'; removedValues: readonly string[] };

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
 * Parses a PostgreSQL array value into a JavaScript string array.
 *
 * PostgreSQL's `pg` library may return `array_agg` results either as:
 * - A JavaScript array (when type parsers are configured)
 * - A string in PostgreSQL array literal format: `{value1,value2,...}`
 *
 * Handles PostgreSQL's quoting rules for array elements:
 * - Elements containing commas, double quotes, backslashes, or whitespace are double-quoted
 * - Inside quoted elements, `\"` represents `"` and `\\` represents `\`
 *
 * @param value - The value to parse (array or PostgreSQL array string)
 * @returns A string array, or null if the value cannot be parsed
 */
export function parsePostgresArray(value: unknown): string[] | null {
  if (isStringArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    if (inner === '') {
      return [];
    }
    return parseArrayElements(inner);
  }
  return null;
}

function parseArrayElements(input: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === ',') {
      i++;
      continue;
    }
    if (input[i] === '"') {
      i++;
      let element = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          i++;
          element += input[i];
        } else {
          element += input[i];
        }
        i++;
      }
      i++;
      result.push(element);
    } else {
      const nextComma = input.indexOf(',', i);
      if (nextComma === -1) {
        result.push(input.slice(i).trim());
        i = input.length;
      } else {
        result.push(input.slice(i, nextComma).trim());
        i = nextComma;
      }
    }
  }
  return result;
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
  if (!existing || existing.codecId !== PG_ENUM_CODEC_ID) {
    return null;
  }
  return getEnumValues(existing);
}

/**
 * Determines what changes are needed to transform existing enum values to desired values.
 *
 * Returns one of:
 * - `unchanged`: No changes needed, values match exactly
 * - `add_values`: New values can be safely appended (PostgreSQL supports this)
 * - `rebuild`: Full enum rebuild required (value removal, reordering, or both)
 *
 * Note: PostgreSQL enums can only have values added (not removed or reordered) without
 * a full type rebuild involving temp type creation and column migration.
 *
 * @param existing - Current enum values in the database
 * @param desired - Target enum values from the contract
 * @returns The type of change required
 */
function determineEnumDiff(existing: readonly string[], desired: readonly string[]): EnumDiff {
  if (arraysEqual(existing, desired)) {
    return { kind: 'unchanged' };
  }

  // Use Sets for O(1) lookups instead of O(n) array.includes()
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);

  const missingValues = desired.filter((value) => !existingSet.has(value));
  const removedValues = existing.filter((value) => !desiredSet.has(value));
  const orderMismatch =
    missingValues.length === 0 && removedValues.length === 0 && !arraysEqual(existing, desired);

  if (removedValues.length > 0 || orderMismatch) {
    return { kind: 'rebuild', removedValues };
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
  // Validate all enum values don't exceed PostgreSQL's label length limit
  for (const value of values) {
    validateEnumValueLength(value, typeName);
  }
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

/**
 * Computes the optimal position for inserting a new enum value to maintain
 * the desired order relative to existing values.
 *
 * PostgreSQL's `ALTER TYPE ADD VALUE` supports BEFORE/AFTER positioning.
 * This function finds the best reference value by:
 * 1. Looking for the nearest preceding value that already exists
 * 2. Falling back to the nearest following value if no preceding exists
 * 3. Defaulting to end-of-list if no reference is found
 *
 * @param options.desired - The target ordered list of all enum values
 * @param options.desiredIndex - Index of the value being inserted in the desired list
 * @param options.current - Current list of enum values (being built up incrementally)
 * @returns SQL clause (e.g., " AFTER 'x'") and insert position for tracking
 */
function computeInsertPosition(options: {
  desired: readonly string[];
  desiredIndex: number;
  current: readonly string[];
}): { clause: string; insertAt: number } {
  const { desired, desiredIndex, current } = options;
  const currentSet = new Set(current);
  const previous = desired
    .slice(0, desiredIndex)
    .reverse()
    .find((candidate) => currentSet.has(candidate));
  const next = desired.slice(desiredIndex + 1).find((candidate) => currentSet.has(candidate));
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

/**
 * Builds operations to add new enum values to an existing PostgreSQL enum type.
 *
 * Each new value is added with `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for idempotency.
 * Values are inserted in the correct order using BEFORE/AFTER positioning to match
 * the desired final order.
 *
 * This is a safe, non-destructive operation - existing data is not affected.
 *
 * @param options.typeName - Contract-level type name (e.g., 'Role')
 * @param options.nativeType - PostgreSQL type name (e.g., 'role')
 * @param options.schemaName - PostgreSQL schema (e.g., 'public')
 * @param options.desired - Target ordered list of all enum values
 * @param options.existing - Current enum values in the database
 * @returns Array of migration operations to add each missing value
 */
function buildAddValueOperations(options: {
  typeName: string;
  nativeType: string;
  schemaName: string;
  desired: readonly string[];
  existing: readonly string[];
}): SqlMigrationPlanOperation<unknown>[] {
  const { typeName, nativeType, schemaName } = options;
  const current = [...options.existing];
  const currentSet = new Set(current);
  const operations: SqlMigrationPlanOperation<unknown>[] = [];
  for (let index = 0; index < options.desired.length; index += 1) {
    const value = options.desired[index];
    if (value === undefined) {
      continue;
    }
    if (currentSet.has(value)) {
      continue;
    }
    // Validate the new value doesn't exceed PostgreSQL's label length limit
    validateEnumValueLength(value, typeName);
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
    currentSet.add(value);
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
        (column.nativeType === nativeType && column.codecId === PG_ENUM_CODEC_ID)
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

/**
 * Builds an SQL check to verify no rows contain any of the removed enum values.
 * This prevents data loss during enum rebuild operations.
 *
 * @param schemaName - PostgreSQL schema name
 * @param tableName - Table containing the enum column
 * @param columnName - Column using the enum type
 * @param removedValues - Array of enum values being removed
 * @returns SQL query that returns true if no rows contain removed values
 */
function noRemovedValuesExistCheck(
  schemaName: string,
  tableName: string,
  columnName: string,
  removedValues: readonly string[],
): string {
  if (removedValues.length === 0) {
    // No values being removed, always passes
    return 'SELECT true';
  }
  const valuesList = removedValues.map((v) => `'${escapeLiteral(v)}'`).join(', ');
  return `SELECT NOT EXISTS (
  SELECT 1 FROM ${qualifyName(schemaName, tableName)}
  WHERE ${quoteIdentifier(columnName)}::text IN (${valuesList})
  LIMIT 1
)`;
}

/**
 * Builds a migration operation to recreate a PostgreSQL enum type with updated values.
 *
 * This is required when:
 * - Enum values are removed (PostgreSQL doesn't support direct removal)
 * - Enum values are reordered (PostgreSQL doesn't support reordering)
 *
 * The operation:
 * 1. Creates a new enum type with the desired values (temp name)
 * 2. Migrates all columns to use the new type via text cast
 * 3. Drops the original type
 * 4. Renames the temp type to the original name
 *
 * IMPORTANT: If values are being removed and data exists using those values,
 * the operation will fail at the precheck stage with a clear error message.
 * This prevents silent data loss.
 *
 * @param options.typeName - Contract-level type name
 * @param options.nativeType - PostgreSQL type name
 * @param options.schemaName - PostgreSQL schema
 * @param options.values - Desired final enum values
 * @param options.removedValues - Values being removed (for data loss checks)
 * @param options.contract - Full contract for column discovery
 * @param options.schema - Current schema IR for column discovery
 * @returns Migration operation for full enum rebuild
 */
function buildRecreateEnumOperation(options: {
  typeName: string;
  nativeType: string;
  schemaName: string;
  values: readonly string[];
  removedValues: readonly string[];
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

      // CRITICAL: If values are being removed, verify no data exists using those values.
      // This prevents silent data loss during the rebuild - the USING cast would fail
      // at runtime if rows contain values that don't exist in the new enum.
      ...(options.removedValues.length > 0
        ? columnRefs.map((ref) => ({
            description: `ensure no rows in ${ref.table}.${ref.column} contain removed values (${options.removedValues.join(', ')})`,
            sql: noRemovedValuesExistCheck(
              options.schemaName,
              ref.table,
              ref.column,
              options.removedValues,
            ),
          }))
        : []),
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
            removedValues: diff.removedValues,
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
          typeName,
          message: `Type "${typeName}" is missing from database`,
        },
      ];
    }
    if (!arraysEqual(existing, desired)) {
      return [
        {
          kind: 'type_values_mismatch',
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
      const values = parsePostgresArray(row.values);
      if (!values) {
        throw new Error(
          `Failed to parse enum values for type "${row.type_name}": ` +
            `unexpected format: ${JSON.stringify(row.values)}`,
        );
      }
      types[row.type_name] = {
        codecId: PG_ENUM_CODEC_ID,
        nativeType: row.type_name,
        typeParams: { values },
      };
    }
    return types;
  },
};
