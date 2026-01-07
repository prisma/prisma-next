import { type } from 'arktype';
import type {
  ForeignKey,
  ForeignKeyReferences,
  Index,
  ModelDefinition,
  ModelField,
  ModelStorage,
  PrimaryKey,
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
  UniqueConstraint,
} from './types.ts';

const StorageColumnSchema = type.declare<StorageColumn>().type({
  nativeType: 'string',
  codecId: 'string',
  nullable: 'boolean',
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

const ForeignKeyReferencesSchema = type.declare<ForeignKeyReferences>().type({
  table: 'string',
  columns: type.string.array().readonly(),
});

const ForeignKeySchema = type.declare<ForeignKey>().type({
  columns: type.string.array().readonly(),
  references: ForeignKeyReferencesSchema,
  'name?': 'string',
});

const StorageTableSchema = type.declare<StorageTable>().type({
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
});

const StorageSchema = type.declare<SqlStorage>().type({
  tables: type({ '[string]': StorageTableSchema }),
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

const SqlContractSchema = type({
  'schemaVersion?': "'1'",
  target: 'string',
  targetFamily: "'sql'",
  coreHash: 'string',
  'profileHash?': 'string',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  'sources?': 'Record<string, unknown>',
  models: type({ '[string]': ModelSchema }),
  storage: StorageSchema,
});

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
  return result;
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
