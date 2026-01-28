import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

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
// Type Guards
// ============================================================================

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

// ============================================================================
// Contract and Schema Helpers
// ============================================================================

function getEnumValues(typeInstance: StorageTypeInstance): readonly string[] | null {
  const params = typeInstance.typeParams;
  if (!params || typeof params !== 'object') {
    return null;
  }
  const values = params['values'];
  if (!isStringArray(values)) {
    return null;
  }
  return values;
}

function isStorageTypeInstance(value: unknown): value is StorageTypeInstance {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value['codecId'] === 'string' &&
    typeof value['nativeType'] === 'string' &&
    isRecord(value['typeParams'])
  );
}

function readStorageTypesFromSchema(schema: SqlSchemaIR): Record<string, StorageTypeInstance> {
  const annotations = schema.annotations;
  if (!isRecord(annotations)) {
    return {};
  }
  if (!Object.hasOwn(annotations, 'pg')) {
    return {};
  }
  const pg = annotations['pg'];
  if (!isRecord(pg)) {
    return {};
  }
  if (!Object.hasOwn(pg, 'storageTypes')) {
    return {};
  }
  const storageTypes = pg['storageTypes'];
  if (!isRecord(storageTypes)) {
    return {};
  }
  const result: Record<string, StorageTypeInstance> = {};
  for (const [typeName, entry] of Object.entries(storageTypes)) {
    if (isStorageTypeInstance(entry)) {
      result[typeName] = entry;
    }
  }
  return result;
}

function readExistingEnumValues(schema: SqlSchemaIR, nativeType: string): readonly string[] | null {
  const storageTypes = readStorageTypesFromSchema(schema);
  const existing = storageTypes[nativeType];
  if (!existing || existing.codecId !== ENUM_CODEC_ID) {
    return null;
  }
  return getEnumValues(existing);
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
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

/** Quote a PostgreSQL identifier (table, column, type names). */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Escape a string literal for SQL. */
function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function qualifyTypeName(schemaName: string, typeName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(typeName)}`;
}

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
  const qualifiedType = qualifyTypeName(schemaName, nativeType);
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
    operations.push({
      id: `type.${typeName}.value.${value}`,
      label: `Add value ${value} to ${typeName}`,
      summary: `Adds enum value ${value} to ${typeName}`,
      operationClass: 'widening',
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `add value "${value}"`,
          sql: `ALTER TYPE ${qualifyTypeName(schemaName, nativeType)} ADD VALUE '${escapeLiteral(
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

function buildRecreateEnumOperation(options: {
  typeName: string;
  nativeType: string;
  schemaName: string;
  values: readonly string[];
  contract: SqlContract<SqlStorage>;
  schema: SqlSchemaIR;
}): SqlMigrationPlanOperation<unknown> {
  const tempTypeName = `${options.nativeType}__pn_rebuild`;
  const qualifiedOriginal = qualifyTypeName(options.schemaName, options.nativeType);
  const qualifiedTemp = qualifyTypeName(options.schemaName, tempTypeName);
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
    sql: `ALTER TABLE ${qualifyTypeName(options.schemaName, ref.table)}
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
      {
        description: `ensure temp type "${tempTypeName}" does not exist`,
        sql: enumTypeExistsCheck(options.schemaName, tempTypeName, false),
      },
    ],
    execute: [
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

/**
 * Convenience wrapper used by the Postgres control adapter.
 */
export async function introspectEnumStorageTypes(options: {
  readonly driver: ControlDriverInstance<'sql', string>;
  readonly schemaName?: string;
}): Promise<Record<string, StorageTypeInstance>> {
  return pgEnumControlHooks.introspectTypes?.(options) ?? {};
}
