import type { Contract, ContractField, ContractModel } from '@prisma-next/contract/types';
import { ContractValidationError } from '@prisma-next/contract/validate-contract';
import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { type } from 'arktype';
import {
  type ForeignKeyInput,
  type ForeignKeyReferenceInput,
  type ForeignKeySource,
  findTableByCoord,
  findTableByName,
  iterateTablesWithCoords,
  type PrimaryKeyInput,
  type ReferentialAction,
  type SqlModelStorage,
  SqlStorage,
  type SqlStorageInput,
  type StorageTypeInstanceInput,
  type UniqueConstraintInput,
} from './types';

type ColumnDefaultLiteral = {
  readonly kind: 'literal';
  readonly value: string | number | boolean | Record<string, unknown> | unknown[] | null;
};
type ColumnDefaultFunction = { readonly kind: 'function'; readonly expression: string };
const literalKindSchema = type("'literal'");
const functionKindSchema = type("'function'");
const generatorKindSchema = type("'generator'");
const generatorIdSchema = type('string').narrow((value, ctx) => {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? true : ctx.mustBe('a flat generator id');
});

export const ColumnDefaultLiteralSchema = type.declare<ColumnDefaultLiteral>().type({
  kind: literalKindSchema,
  value: 'string | number | boolean | null | unknown[] | Record<string, unknown>',
});

export const ColumnDefaultFunctionSchema = type.declare<ColumnDefaultFunction>().type({
  kind: functionKindSchema,
  expression: 'string',
});

export const ColumnDefaultSchema = ColumnDefaultLiteralSchema.or(ColumnDefaultFunctionSchema);

const ExecutionMutationDefaultValueSchema = type({
  '+': 'reject',
  kind: generatorKindSchema,
  id: generatorIdSchema,
  'params?': 'Record<string, unknown>',
});

const ExecutionMutationDefaultSchema = type({
  '+': 'reject',
  ref: {
    '+': 'reject',
    table: 'string',
    column: 'string',
  },
  'onCreate?': ExecutionMutationDefaultValueSchema,
  'onUpdate?': ExecutionMutationDefaultValueSchema,
});

const ExecutionSchema = type({
  '+': 'reject',
  executionHash: 'string',
  mutations: {
    '+': 'reject',
    defaults: ExecutionMutationDefaultSchema.array().readonly(),
  },
});

const StorageColumnSchema = type({
  '+': 'reject',
  nativeType: 'string',
  codecId: 'string',
  nullable: 'boolean',
  'typeParams?': 'Record<string, unknown>',
  'typeRef?': 'string',
  'default?': ColumnDefaultSchema,
}).narrow((col, ctx) => {
  if (col.typeParams !== undefined && col.typeRef !== undefined) {
    return ctx.mustBe('a column with either typeParams or typeRef, not both');
  }
  return true;
});

/**
 * Codec-triple entry persisted under `storage.types[name]`. Carries an
 * enumerable literal `kind: 'codec-instance'` discriminator so the
 * polymorphic slot dispatch can distinguish codec triples from
 * class-instance kinds (e.g. `'postgres-enum'`) sharing the slot.
 */
const StorageTypeInstanceSchema = type
  .declare<StorageTypeInstanceInput & { kind: 'codec-instance' }>()
  .type({
    kind: "'codec-instance'",
    codecId: 'string',
    nativeType: 'string',
    typeParams: 'Record<string, unknown>',
  });

/**
 * Polymorphic enum-type entry under `storage.types[name]`. Carries an
 * enumerable literal `kind: 'postgres-enum'` discriminator so the
 * per-target hydration walker can dispatch cleanly back to a typed
 * IR-class instance during `deserializeContract`. The discriminator
 * reflects target-level behaviour (Postgres-native enums versus
 * family-layer codec triples) — not the family abstract altitude alone.
 *
 * The schema literal lives at the family layer today because
 * registry-driven validation for arbitrary slot shapes is not wired
 * yet; once a second polymorphic kind ships through the slot, this
 * structural enumeration can move to the registry-dispatch site and
 * per-target schemas can live in their target packages.
 */
const PostgresEnumTypeSchema = type({
  kind: "'postgres-enum'",
  name: 'string',
  nativeType: 'string',
  values: type.string.array().readonly(),
});

/**
 * Family-layer arktype validation enumerates the polymorphic shapes the
 * SQL family ships today (codec-instance + Postgres-enum). Pack-contributed
 * entity types ship a parallel arktype schema entry here when they
 * introduce a new persisted shape; the registry-driven hydration seam at
 * `SqlContractSerializerBase.hydrateStorageTypeEntry` is open, but the
 * family-layer structural validator is closed by design — extension
 * packs cannot inject arbitrary persisted shapes through the slot
 * without their structural shape being known at the family layer.
 *
 * A future refinement is to lift `StorageTypeEntrySchema` toward an
 * `unknown` fallback and move structural diagnostics to the
 * registry-dispatch site at hydration time, earned once a non-enum
 * storage shape needs to flow through the slot without growing another
 * closed union arm here first.
 */
const StorageTypeEntrySchema = PostgresEnumTypeSchema.or(StorageTypeInstanceSchema);

const PrimaryKeySchema = type.declare<PrimaryKeyInput>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const UniqueConstraintSchema = type.declare<UniqueConstraintInput>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

export const IndexSchema = type({
  columns: type.string.array().readonly(),
  'name?': 'string',
  'type?': 'string',
  'options?': 'Record<string, unknown>',
});

export const ForeignKeyReferenceSchema = type.declare<ForeignKeyReferenceInput>().type({
  namespaceId: 'string',
  table: 'string',
  columns: type.string.array().readonly(),
});

export const ForeignKeySourceSchema = type.declare<ForeignKeySource>().type({
  columns: type.string.array().readonly(),
});

export const ReferentialActionSchema = type
  .declare<ReferentialAction>()
  .type("'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'");

export const ForeignKeySchema = type.declare<ForeignKeyInput>().type({
  source: ForeignKeySourceSchema,
  target: ForeignKeyReferenceSchema,
  'name?': 'string',
  'onDelete?': ReferentialActionSchema,
  'onUpdate?': ReferentialActionSchema,
  constraint: 'boolean',
  index: 'boolean',
});

const StorageTableSchema = type({
  '+': 'reject',
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
  // Required namespace back-pointer. The JSON envelope keys each
  // table under its namespace bucket and the hydrator stamps the
  // outer key onto the StorageTable input, so every persisted row
  // carries an unambiguous coordinate.
  namespaceId: 'string',
});

/**
 * Namespace entry under `storage.namespaces[id]`. SQL contracts honour
 * the framework `Storage.namespaces` invariant from PR1; today every
 * contract binds to the singleton placeholder
 * (`SqlUnboundNamespace.instance`) and the persisted shape carries
 * just the namespace id. Per-target namespace concretions
 * (`PostgresSchema`, `SqliteUnboundDatabase`) can additively grow
 * the persisted shape when they earn their slots.
 */
const NamespaceEntrySchema = type({
  id: 'string',
});

const FlatStorageSchema = type({
  '+': 'reject',
  storageHash: 'string',
  tables: type({ '[string]': StorageTableSchema }),
  'types?': type({ '[string]': StorageTypeEntrySchema }),
  'namespaces?': type({ '[string]': NamespaceEntrySchema }),
});

/**
 * FR15 nested-by-namespace envelope. Multi-namespace contracts persist
 * `tables` as `{ [namespaceId]: { [tableName]: StorageTable } }` (and
 * the same dual shape for `types`). `validateStorage` discriminates
 * between the two shapes at the runtime entry point and routes through
 * the matching arktype schema.
 */
const NestedStorageSchema = type({
  '+': 'reject',
  storageHash: 'string',
  tables: type({ '[string]': type({ '[string]': StorageTableSchema }) }),
  'types?': type({ '[string]': type({ '[string]': StorageTypeEntrySchema }) }),
  'namespaces?': type({ '[string]': NamespaceEntrySchema }),
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findDuplicateValue(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function isContractFieldType(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const kind = value['kind'];
  if (kind === 'scalar') {
    if (typeof value['codecId'] !== 'string') return false;
    const typeParams = value['typeParams'];
    if (typeParams !== undefined && !isPlainRecord(typeParams)) return false;
    return true;
  }
  if (kind === 'valueObject') {
    return typeof value['name'] === 'string';
  }
  if (kind === 'union') {
    const members = value['members'];
    if (!Array.isArray(members)) return false;
    return members.every((m) => isContractFieldType(m));
  }
  return false;
}

const ContractFieldTypeSchema = type('unknown').narrow((value, ctx) =>
  isContractFieldType(value) ? true : ctx.mustBe('scalar, valueObject, or union field type'),
);

const ModelFieldSchema = type({
  '+': 'reject',
  nullable: 'boolean',
  type: ContractFieldTypeSchema,
  'many?': 'true',
  'dict?': 'true',
});

const ModelStorageFieldSchema = type({
  column: 'string',
  'codecId?': 'string',
  'nullable?': 'boolean',
});

const ModelStorageSchema = type({
  table: 'string',
  fields: type({ '[string]': ModelStorageFieldSchema }),
});

const ModelSchema = type({
  storage: ModelStorageSchema,
  'fields?': type({ '[string]': ModelFieldSchema }),
  'relations?': type({ '[string]': 'unknown' }),
  'discriminator?': 'unknown',
  'variants?': 'unknown',
  'base?': 'string',
  'owner?': 'string',
});

const ContractMetaSchema = type({
  '[string]': 'unknown',
});

const sqlContractBaseShape = {
  '+': 'reject',
  target: 'string',
  targetFamily: "'sql'",
  'coreHash?': 'string',
  profileHash: 'string',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': ContractMetaSchema,
  'roots?': 'Record<string, string>',
  models: type({ '[string]': ModelSchema }),
  'valueObjects?': 'Record<string, unknown>',
  'execution?': ExecutionSchema,
} as const;

const FlatSqlContractSchema = type({
  ...sqlContractBaseShape,
  storage: FlatStorageSchema,
});

const NestedSqlContractSchema = type({
  ...sqlContractBaseShape,
  storage: NestedStorageSchema,
});

// NOTE: StorageColumnSchema, StorageTableSchema, and StorageSchema use bare type()
// instead of type.declare<T>().type() because the ColumnDefault union's value field
// includes bigint | Date (runtime-only types after decoding) which cannot be expressed
// in Arktype's JSON validation DSL. The `as SqlStorage` cast in validateStorage() bridges
// the gap between the JSON-safe Arktype output and the runtime TypeScript type.

/**
 * Validates the structural shape of SqlStorage using Arktype.
 *
 * @param value - The storage value to validate
 * @returns The validated storage if structure is valid
 * @throws Error if the storage structure is invalid
 */
export function validateStorage(value: unknown): SqlStorage {
  const schema = isNestedTablesEnvelope(value) ? NestedStorageSchema : FlatStorageSchema;
  const result = schema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Storage validation failed: ${messages}`);
  }
  // The arktype-validated shape matches `SqlStorageInput`
  // structurally. Funnel through the constructor so nested IR fields
  // (`tables`, `types`) are normalised into class instances and the
  // branded `storageHash` is preserved on the returned `SqlStorage`.
  return new SqlStorage(result as SqlStorageInput);
}

/**
 * Peek at the envelope's `tables` shape. A flat envelope has values
 * carrying `columns` directly (the StorageTable shape). A nested
 * envelope has values that are namespace buckets — i.e. records whose
 * own values carry `columns`. An empty `tables` map is treated as flat
 * (the legacy default).
 */
function isNestedTablesEnvelope(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const tables = value['tables'];
  if (!isPlainRecord(tables)) return false;
  for (const tableEntry of Object.values(tables)) {
    if (!isPlainRecord(tableEntry)) return false;
    if ('columns' in tableEntry) return false;
    return true;
  }
  return false;
}

export function validateModel(value: unknown): unknown {
  const result = ModelSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Model validation failed: ${messages}`);
  }
  return result;
}

/**
 * Validates the structural shape of an SQL contract using Arktype.
 *
 * Ensures all required fields are present and have the correct types,
 * including SQL-specific storage structure (tables, columns, constraints).
 *
 * @param value - The contract value to validate (typically from a JSON import)
 * @returns The validated contract if structure is valid
 * @throws ContractValidationError if the contract structure is invalid
 */
export function validateSqlContract<T extends Contract<SqlStorage>>(value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    throw new ContractValidationError(
      'Contract structural validation failed: value must be an object',
      'structural',
    );
  }

  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
    throw new ContractValidationError(
      `Unsupported target family: ${rawValue.targetFamily}`,
      'structural',
    );
  }

  const storageEnvelope = isPlainRecord(value) ? value['storage'] : undefined;
  const contractSchema = isNestedTablesEnvelope(storageEnvelope)
    ? NestedSqlContractSchema
    : FlatSqlContractSchema;
  const contractResult = contractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new ContractValidationError(
      `Contract structural validation failed: ${messages}`,
      'structural',
    );
  }

  // Arktype's inferred output type differs from T due to exactOptionalPropertyTypes
  // and branded hash types — the runtime value is structurally compatible after validation
  return contractResult as unknown as T;
}

/**
 * Validates semantic constraints on SqlStorage that cannot be expressed in Arktype schemas.
 *
 * Returns an array of human-readable error strings. Empty array = valid.
 *
 * Currently checks:
 * - duplicate named primary key / unique / index / foreign key objects within a table
 * - duplicate unique, index, or foreign key declarations within a table
 * - duplicate columns within primary key / unique / index definitions
 * - nullable columns in primary key definitions
 * - `setNull` referential action on a non-nullable FK column (would fail at runtime)
 * - `setDefault` referential action on a non-nullable FK column without a DEFAULT (would fail at runtime)
 */
export function validateStorageSemantics(storage: SqlStorage): string[] {
  const errors: string[] = [];

  for (const { name: tableName, table } of iterateTablesWithCoords(storage)) {
    const namedObjects = new Map<string, string[]>();
    const registerNamedObject = (kind: string, name: string | undefined) => {
      if (!name) return;
      namedObjects.set(name, [...(namedObjects.get(name) ?? []), kind]);
    };

    registerNamedObject('primary key', table.primaryKey?.name);
    for (const unique of table.uniques) {
      registerNamedObject('unique constraint', unique.name);
    }
    for (const index of table.indexes) {
      registerNamedObject('index', index.name);
    }
    for (const fk of table.foreignKeys) {
      registerNamedObject('foreign key', fk.name);
    }

    for (const [name, kinds] of namedObjects) {
      if (kinds.length > 1) {
        errors.push(
          `Table "${tableName}": named object "${name}" is declared multiple times (${kinds.join(', ')})`,
        );
      }
    }

    if (table.primaryKey) {
      const duplicateColumn = findDuplicateValue(table.primaryKey.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Table "${tableName}": primary key contains duplicate column "${duplicateColumn}"`,
        );
      }

      for (const columnName of table.primaryKey.columns) {
        const column = table.columns[columnName];
        if (column?.nullable === true) {
          errors.push(
            `Table "${tableName}": primary key column "${columnName}" is nullable; primary key columns must be NOT NULL`,
          );
        }
      }
    }

    const seenUniqueDefinitions = new Set<string>();
    for (const unique of table.uniques) {
      const duplicateColumn = findDuplicateValue(unique.columns);
      if (duplicateColumn !== undefined) {
        errors.push(
          `Table "${tableName}": unique constraint contains duplicate column "${duplicateColumn}"`,
        );
      }

      const signature = JSON.stringify({ columns: unique.columns });
      if (seenUniqueDefinitions.has(signature)) {
        errors.push(
          `Table "${tableName}": duplicate unique constraint definition on columns [${unique.columns.join(', ')}]`,
        );
        continue;
      }
      seenUniqueDefinitions.add(signature);
    }

    const sortOptions = (o: Record<string, unknown> | undefined): Record<string, unknown> | null =>
      o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : null;

    const seenIndexDefinitions = new Set<string>();
    for (const index of table.indexes) {
      const duplicateColumn = findDuplicateValue(index.columns);
      if (duplicateColumn !== undefined) {
        errors.push(`Table "${tableName}": index contains duplicate column "${duplicateColumn}"`);
      }

      const signature = JSON.stringify({
        columns: index.columns,
        type: index.type ?? null,
        options: sortOptions(index.options),
      });
      if (seenIndexDefinitions.has(signature)) {
        errors.push(
          `Table "${tableName}": duplicate index definition on columns [${index.columns.join(', ')}]`,
        );
        continue;
      }
      seenIndexDefinitions.add(signature);
    }

    const seenForeignKeyDefinitions = new Set<string>();
    for (const fk of table.foreignKeys) {
      const signature = JSON.stringify({
        source: fk.source,
        target: fk.target,
        onDelete: fk.onDelete ?? null,
        onUpdate: fk.onUpdate ?? null,
        constraint: fk.constraint,
        index: fk.index,
      });
      if (seenForeignKeyDefinitions.has(signature)) {
        errors.push(
          `Table "${tableName}": duplicate foreign key definition on columns [${fk.source.columns.join(', ')}]`,
        );
        continue;
      }
      seenForeignKeyDefinitions.add(signature);
    }

    for (const fk of table.foreignKeys) {
      for (const colName of fk.source.columns) {
        const column = table.columns[colName];
        if (!column) continue;

        if (fk.onDelete === 'setNull' && !column.nullable) {
          errors.push(
            `Table "${tableName}": onDelete setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onUpdate === 'setNull' && !column.nullable) {
          errors.push(
            `Table "${tableName}": onUpdate setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onDelete === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Table "${tableName}": onDelete setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
        if (fk.onUpdate === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Table "${tableName}": onUpdate setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * SQL storage logical-consistency checks: every model.storage.table
 * resolves to a real table, every model.storage.fields[*].column
 * resolves to a real column, and value-object fields land on JSON-native
 * columns. Throws `ContractValidationError` on the first mismatch.
 */
export function validateModelStorageReferences(contract: Contract<SqlStorage>): void {
  const models = contract.models as Record<string, ContractModel<SqlModelStorage>>;
  for (const [modelName, model] of Object.entries(models)) {
    const storageTable = model.storage.table;

    const table = findTableByName(contract.storage, storageTable);
    if (!table) {
      throw new ContractValidationError(
        `Model "${modelName}" references non-existent table "${storageTable}"`,
        'storage',
      );
    }

    const columnNames = new Set(Object.keys(table.columns));
    for (const [fieldName, field] of Object.entries(model.storage.fields)) {
      if (!columnNames.has(field.column)) {
        throw new ContractValidationError(
          `Model "${modelName}" field "${fieldName}" references non-existent column "${field.column}" in table "${storageTable}"`,
          'storage',
        );
      }
    }

    const JSON_NATIVE_TYPES = new Set(['json', 'jsonb']);
    for (const [fieldName, domainField] of Object.entries(model.fields ?? {})) {
      const f = domainField as ContractField;
      if (f.type?.kind !== 'valueObject') continue;
      const storageField = model.storage.fields[fieldName];
      if (!storageField) continue;
      const column = table.columns[storageField.column];
      if (!column) continue;
      if (!JSON_NATIVE_TYPES.has(column.nativeType)) {
        throw new ContractValidationError(
          `Model "${modelName}" field "${fieldName}" is a value object but storage column "${storageField.column}" has nativeType "${column.nativeType}" (expected json or jsonb)`,
          'storage',
        );
      }
    }
  }
}

/**
 * Cross-table consistency checks for SQL storage: primary key, unique,
 * index, and foreign key column references resolve to real columns;
 * NOT NULL columns don't carry a literal `null` default; FK column
 * counts match their referenced columns. Throws on the first mismatch.
 */
export function validateSqlStorageConsistency(contract: Contract<SqlStorage>): void {
  const tableCoords = new Set<string>();
  const tableNames = new Set<string>();
  for (const { namespaceId, name } of iterateTablesWithCoords(contract.storage)) {
    tableCoords.add(`${namespaceId}\u0000${name}`);
    tableNames.add(name);
  }

  for (const { namespaceId: sourceNamespaceId, name: tableName, table } of iterateTablesWithCoords(
    contract.storage,
  )) {
    const columnNames = new Set(Object.keys(table.columns));

    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const unique of table.uniques) {
      for (const colName of unique.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const index of table.indexes) {
      for (const colName of index.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" index references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const [colName, column] of Object.entries(table.columns)) {
      if (!column.nullable && column.default?.kind === 'literal' && column.default.value === null) {
        throw new ContractValidationError(
          `Table "${tableName}" column "${colName}" is NOT NULL but has a literal null default`,
          'storage',
        );
      }
    }

    for (const fk of table.foreignKeys) {
      for (const colName of fk.source.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }

      // Cross-namespace FK lookup (FR16b): the target carries its own
      // namespace coordinate so resolution is namespace-aware. Same-namespace
      // FKs (the common case) leave `target.namespaceId` defaulted to the
      // source's namespace via the StorageTable constructor.
      const targetNamespaceId = fk.target.namespaceId ?? sourceNamespaceId;
      const referencedTable = findTableByCoord(
        contract.storage,
        targetNamespaceId,
        fk.target.table,
      );
      if (!referencedTable) {
        if (!tableNames.has(fk.target.table)) {
          throw new ContractValidationError(
            `Table "${tableName}" foreignKey references non-existent table "${fk.target.table}"`,
            'storage',
          );
        }
        // The table exists under a different namespace than declared; surface
        // the namespace mismatch with both coordinates explicit.
        throw new ContractValidationError(
          `Table "${tableName}" foreignKey references table "${fk.target.table}" in namespace "${targetNamespaceId}" but no such (namespace, table) pair exists in the contract`,
          'storage',
        );
      }
      const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
      for (const colName of fk.target.columns) {
        if (!referencedColumnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.target.table}"`,
            'storage',
          );
        }
      }

      if (fk.source.columns.length !== fk.target.columns.length) {
        throw new ContractValidationError(
          `Table "${tableName}" foreignKey column count (${fk.source.columns.length}) does not match referenced column count (${fk.target.columns.length})`,
          'storage',
        );
      }
    }
  }
}

/**
 * Full SQL contract validation: structural (arktype) +
 * framework-shared domain + SQL storage logical-consistency + SQL
 * storage semantic + model ↔ storage reference checks. Throws
 * `ContractValidationError` on the first failure. Returns the
 * validated flat-data shape; IR class hydration happens in the SPI
 * base on top of this helper.
 */
export function validateSqlContractFully<T extends Contract<SqlStorage>>(value: unknown): T {
  const stripped =
    typeof value === 'object' && value !== null
      ? (() => {
          const { schemaVersion: _, _generated: _g, ...rest } = value as Record<string, unknown>;
          return rest;
        })()
      : value;
  const validated = validateSqlContract<T>(stripped);
  validateContractDomain({
    roots: validated.roots,
    models: validated.models,
    ...(validated.valueObjects ? { valueObjects: validated.valueObjects } : {}),
  });
  validateSqlStorageConsistency(validated);
  const semanticErrors = validateStorageSemantics(validated.storage);
  if (semanticErrors.length > 0) {
    throw new ContractValidationError(
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      'storage',
    );
  }
  validateModelStorageReferences(validated);
  return validated;
}
