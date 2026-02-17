import { runtimeError } from '@prisma-next/runtime-executor';
import type {
  JsonSchemaValidationError,
  JsonSchemaValidatorRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';

/**
 * Validates a JSON value against its column's JSON Schema, if a validator exists.
 *
 * Throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on validation failure.
 * No-ops if no validator is registered for the column.
 */
export function validateJsonValue(
  registry: JsonSchemaValidatorRegistry,
  table: string,
  column: string,
  value: unknown,
  direction: 'encode' | 'decode',
  codecId?: string,
): void {
  const key = `${table}.${column}`;
  const validate = registry.get(key);
  if (!validate) return;

  const result = validate(value);
  if (result.valid) return;

  throw createJsonSchemaValidationError(table, column, direction, result.errors, codecId);
}

function createJsonSchemaValidationError(
  table: string,
  column: string,
  direction: 'encode' | 'decode',
  errors: ReadonlyArray<JsonSchemaValidationError>,
  codecId?: string,
): Error {
  const summary = formatErrorSummary(errors);
  return runtimeError(
    'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
    `JSON schema validation failed for column '${table}.${column}' (${direction}): ${summary}`,
    {
      table,
      column,
      codecId,
      direction,
      errors: [...errors],
    },
  );
}

function formatErrorSummary(errors: ReadonlyArray<JsonSchemaValidationError>): string {
  if (errors.length === 0) return 'unknown validation error';
  if (errors.length === 1) {
    const err = errors[0] as JsonSchemaValidationError;
    return err.path === '/' ? err.message : `${err.path}: ${err.message}`;
  }
  return errors
    .map((err) => (err.path === '/' ? err.message : `${err.path}: ${err.message}`))
    .join('; ');
}
