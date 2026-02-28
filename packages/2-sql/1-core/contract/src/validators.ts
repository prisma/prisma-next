import { type } from 'arktype';
import type {
  ForeignKey,
  ForeignKeyReferences,
  Index,
  ModelDefinition,
  ModelField,
  ModelStorage,
  PrimaryKey,
  ReferentialAction,
  SqlContract,
  SqlStorage,
  StorageTypeInstance,
  UniqueConstraint,
} from './types';

type ColumnDefaultLiteral = {
  readonly kind: 'literal';
  readonly value: string | number | boolean | Record<string, unknown> | unknown[] | null;
};
type ColumnDefaultFunction = { readonly kind: 'function'; readonly expression: string };
const literalKindSchema = type("'literal'");
const functionKindSchema = type("'function'");
const generatorKindSchema = type("'generator'");
const generatorIdSchema = type("'ulid' | 'nanoid' | 'uuidv7' | 'uuidv4' | 'cuid2' | 'ksuid'");

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

const StorageTypeInstanceSchema = type.declare<StorageTypeInstance>().type({
  codecId: 'string',
  nativeType: 'string',
  typeParams: 'Record<string, unknown>',
});

const PrimaryKeySchema = type.declare<PrimaryKey>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const UniqueConstraintSchema = type.declare<UniqueConstraint>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const IndexSchema = type.declare<Index>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

export const ForeignKeyReferencesSchema = type.declare<ForeignKeyReferences>().type({
  table: 'string',
  columns: type.string.array().readonly(),
});

export const ReferentialActionSchema = type
  .declare<ReferentialAction>()
  .type("'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'");

export const ForeignKeySchema = type.declare<ForeignKey>().type({
  columns: type.string.array().readonly(),
  references: ForeignKeyReferencesSchema,
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
});

const StorageSchema = type({
  '+': 'reject',
  tables: type({ '[string]': StorageTableSchema }),
  'types?': type({ '[string]': StorageTypeInstanceSchema }),
});

const ModelFieldSchema = type.declare<ModelField>().type({
  column: 'string',
});

const ModelStorageSchema = type.declare<ModelStorage>().type({
  table: 'string',
});

const ModelSchema = type.declare<ModelDefinition>().type({
  storage: ModelStorageSchema,
  fields: type({ '[string]': ModelFieldSchema }),
  relations: type({ '[string]': 'unknown' }),
});

const MappingsSchema = type({
  '+': 'reject',
  'modelToTable?': 'null | Record<string, string>',
  'tableToModel?': 'null | Record<string, string>',
  'fieldToColumn?': 'null | Record<string, Record<string, string>>',
  'columnToField?': 'null | Record<string, Record<string, string>>',
  'codecTypes?': 'null | Record<string, unknown>',
  'operationTypes?': 'null | Record<string, Record<string, unknown>>',
});

const ContractMetaSchema = type({
  '[string]': 'unknown',
});

const SqlContractSchema = type({
  '+': 'reject',
  'schemaVersion?': "'1'",
  target: 'string',
  targetFamily: "'sql'",
  'coreHash?': 'string',
  storageHash: 'string',
  'executionHash?': 'string',
  'profileHash?': 'string',
  '_generated?': 'Record<string, unknown>',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': ContractMetaSchema,
  'sources?': 'Record<string, unknown>',
  'relations?': type({ '[string]': 'unknown' }),
  'mappings?': MappingsSchema,
  models: type({ '[string]': ModelSchema }),
  storage: StorageSchema,
  'execution?': ExecutionSchema,
});

// NOTE: StorageColumnSchema, StorageTableSchema, and StorageSchema use bare type()
// instead of type.declare<T>().type() because the ColumnDefault union's value field
// includes bigint | Date (runtime-only types after decoding) which cannot be expressed
// in Arktype's JSON validation DSL. The `as SqlStorage` cast in validateStorage() bridges
// the gap between the JSON-safe Arktype output and the runtime TypeScript type.
// See decodeContractDefaults() in validate.ts for the decoding step.

/**
 * Validates the structural shape of SqlStorage using Arktype.
 *
 * @param value - The storage value to validate
 * @returns The validated storage if structure is valid
 * @throws Error if the storage structure is invalid
 */
export function validateStorage(value: unknown): SqlStorage {
  const result = StorageSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Storage validation failed: ${messages}`);
  }
  return result as SqlStorage;
}

/**
 * Validates the structural shape of ModelDefinition using Arktype.
 *
 * @param value - The model value to validate
 * @returns The validated model if structure is valid
 * @throws Error if the model structure is invalid
 */
export function validateModel(value: unknown): ModelDefinition {
  const result = ModelSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Model validation failed: ${messages}`);
  }
  return result;
}

/**
 * Validates the structural shape of a SqlContract using Arktype.
 *
 * **Responsibility: Validation Only**
 * This function validates that the contract has the correct structure and types.
 * It does NOT normalize the contract - normalization must happen in the contract builder.
 *
 * The contract passed to this function must already be normalized (all required fields present).
 * If normalization is needed, it should be done by the contract builder before calling this function.
 *
 * This ensures all required fields are present and have the correct types.
 *
 * @param value - The contract value to validate (typically from a JSON import)
 * @returns The validated contract if structure is valid
 * @throws Error if the contract structure is invalid
 */
export function validateSqlContract<T extends SqlContract<SqlStorage>>(value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Contract structural validation failed: value must be an object');
  }

  // Check targetFamily first to provide a clear error message for unsupported target families
  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
    throw new Error(`Unsupported target family: ${rawValue.targetFamily}`);
  }

  const contractResult = SqlContractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Contract structural validation failed: ${messages}`);
  }

  // After validation, contractResult matches the schema and preserves the input structure
  // TypeScript needs an assertion here due to exactOptionalPropertyTypes differences
  // between Arktype's inferred type and the generic T, but runtime-wise they're compatible
  return contractResult as T;
}

/**
 * Validates semantic constraints on SqlStorage that cannot be expressed in Arktype schemas.
 *
 * Returns an array of human-readable error strings. Empty array = valid.
 *
 * Currently checks:
 * - `setNull` referential action on a non-nullable FK column (would fail at runtime)
 * - `setDefault` referential action on a non-nullable FK column without a DEFAULT (would fail at runtime)
 */
export function validateStorageSemantics(storage: SqlStorage): string[] {
  const errors: string[] = [];

  for (const [tableName, table] of Object.entries(storage.tables)) {
    for (const fk of table.foreignKeys) {
      for (const colName of fk.columns) {
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
