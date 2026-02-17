import Ajv from 'ajv';

/**
 * A single validation error from JSON Schema validation.
 */
export interface JsonSchemaValidationError {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
}

/**
 * Result of a JSON Schema validation.
 */
export type JsonSchemaValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: ReadonlyArray<JsonSchemaValidationError> };

/**
 * A compiled JSON Schema validate function.
 */
export type JsonSchemaValidateFn = (value: unknown) => JsonSchemaValidationResult;

/**
 * Compiles a JSON Schema object into a reusable validate function using Ajv.
 *
 * The returned function validates a value against the schema and returns
 * a structured result with error details on failure.
 *
 * @param schema - A JSON Schema object (draft-07 compatible)
 * @returns A validate function
 */
export function compileJsonSchemaValidator(
  schema: Record<string, unknown>,
): JsonSchemaValidateFn {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  return (value: unknown): JsonSchemaValidationResult => {
    const valid = validate(value);
    if (valid) {
      return { valid: true };
    }

    const errors: JsonSchemaValidationError[] = (validate.errors ?? []).map((err) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'unknown validation error',
      keyword: err.keyword,
    }));

    return { valid: false, errors };
  };
}

/**
 * Formats validation errors into a human-readable summary string.
 */
export function formatValidationErrors(
  errors: ReadonlyArray<JsonSchemaValidationError>,
): string {
  if (errors.length === 0) return 'unknown validation error';
  if (errors.length === 1) {
    const err = errors[0]!;
    return err.path === '/' ? err.message : `${err.path}: ${err.message}`;
  }
  return errors
    .map((err) => (err.path === '/' ? err.message : `${err.path}: ${err.message}`))
    .join('; ');
}
