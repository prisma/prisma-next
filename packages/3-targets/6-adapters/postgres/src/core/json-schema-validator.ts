import type {
  JsonSchemaValidateFn,
  JsonSchemaValidationError,
  JsonSchemaValidationResult,
} from '@prisma-next/sql-relational-core/query-lane-context';
import Ajv from 'ajv';

export type { JsonSchemaValidateFn, JsonSchemaValidationError, JsonSchemaValidationResult };

/**
 * Shared Ajv instance for all JSON Schema validators.
 * Reusing a single instance avoids ~50-100KB memory overhead per compiled schema.
 */
let sharedAjv: Ajv | undefined;

function getSharedAjv(): Ajv {
  if (!sharedAjv) {
    sharedAjv = new Ajv({ allErrors: false, strict: false });
  }
  return sharedAjv;
}

/**
 * Compiles a JSON Schema object into a reusable validate function using Ajv.
 *
 * The returned function validates a value against the schema and returns
 * a structured result with error details on failure.
 *
 * Uses a shared Ajv instance and fail-fast mode (`allErrors: false`)
 * to minimize memory and CPU overhead.
 *
 * @param schema - A JSON Schema object (draft-07 compatible)
 * @returns A validate function
 */
export function compileJsonSchemaValidator(schema: Record<string, unknown>): JsonSchemaValidateFn {
  const ajv = getSharedAjv();
  const validate = ajv.compile(schema);

  return (value: unknown): JsonSchemaValidationResult => {
    const valid = validate(value);
    if (valid) {
      return { valid: true };
    }

    // Defensive `??` fallbacks: Ajv populates `validate.errors` and `err.message`
    // for every failed validation under our config (`strict: false`, default
    // messages enabled), so these `??` right-hand branches are unreachable but
    // kept for type narrowing.
    const errors: JsonSchemaValidationError[] =
      /* v8 ignore next */
      (validate.errors ?? []).map((err) => ({
        path: err.instancePath || '/',
        message:
          /* v8 ignore next */
          err.message ?? 'unknown validation error',
        keyword: err.keyword,
      }));

    return { valid: false, errors };
  };
}
