import { runtimeError } from '@prisma-next/framework-components/runtime';
import type {
  JsonSchemaValidationError,
  JsonSchemaValidatorRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';

/**
 * Validates a JSON value against its column's JSON Schema, if a validator exists.
 *
 * Throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on validation failure.
 * No-ops if no validator is registered for the column.
 *
 * When `redactValues` is true, validator-supplied `message` strings are dropped
 * from both the thrown error's human-readable message and the `details.errors`
 * array. This is required for async/encryption codecs whose decoded value may
 * be sensitive: third-party validators (ajv, @cfworker/json-schema, etc.) often
 * embed the offending value in `err.message`, which would otherwise flow into
 * telemetry. See spec `projects/async-codecs/spec.md` NFR-4.
 */
export function validateJsonValue(
  registry: JsonSchemaValidatorRegistry,
  table: string,
  column: string,
  value: unknown,
  direction: 'encode' | 'decode',
  codecId?: string,
  redactValues = false,
): void {
  const key = `${table}.${column}`;
  const validate = registry.get(key);
  if (!validate) return;

  const result = validate(value);
  if (result.valid) return;

  throw createJsonSchemaValidationError(
    table,
    column,
    direction,
    result.errors,
    codecId,
    redactValues,
  );
}

function createJsonSchemaValidationError(
  table: string,
  column: string,
  direction: 'encode' | 'decode',
  errors: ReadonlyArray<JsonSchemaValidationError>,
  codecId: string | undefined,
  redactValues: boolean,
): Error {
  const safeErrors = redactValues ? errors.map(redactErrorMessage) : [...errors];
  const summary = formatErrorSummary(safeErrors);
  return runtimeError(
    'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
    `JSON schema validation failed for column '${table}.${column}' (${direction}): ${summary}`,
    {
      table,
      column,
      codecId,
      direction,
      errors: safeErrors,
    },
  );
}

function redactErrorMessage(err: JsonSchemaValidationError): JsonSchemaValidationError {
  return {
    path: err.path,
    keyword: err.keyword,
    message: err.keyword ? `schema violation (${err.keyword})` : 'schema violation',
  };
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
