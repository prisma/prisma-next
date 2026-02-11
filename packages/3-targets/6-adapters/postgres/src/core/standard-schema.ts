type UnknownRecord = Record<string, unknown>;

type StandardSchemaJsonSchemaField = {
  readonly output?: unknown;
};

/**
 * Runtime view of the Standard Schema protocol.
 * Reads `~standard.jsonSchema.output` for the serializable JSON Schema representation,
 * and `.expression` for an optional TypeScript type expression string (Arktype-specific).
 *
 * This differs from the compile-time `StandardSchemaLike` in `codec-types.ts`, which reads
 * `~standard.types.output` for TypeScript type narrowing in contract.d.ts.
 */
export type StandardSchemaLike = {
  readonly '~standard'?: {
    readonly version?: number;
    readonly jsonSchema?: StandardSchemaJsonSchemaField;
  };
  readonly expression?: unknown;
};

function isObjectLike(value: unknown): value is UnknownRecord {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function resolveOutputJsonSchemaField(schema: StandardSchemaLike): unknown {
  const jsonSchema = schema['~standard']?.jsonSchema;
  if (!jsonSchema) {
    return undefined;
  }

  if (typeof jsonSchema.output === 'function') {
    return jsonSchema.output({
      target: 'draft-07',
    });
  }

  return jsonSchema.output;
}

export function extractStandardSchemaOutputJsonSchema(
  schema: StandardSchemaLike,
): UnknownRecord | undefined {
  const outputSchema = resolveOutputJsonSchemaField(schema);
  if (!isObjectLike(outputSchema)) {
    return undefined;
  }

  return outputSchema;
}

export function extractStandardSchemaTypeExpression(
  schema: StandardSchemaLike,
): string | undefined {
  const expression = schema.expression;
  if (typeof expression !== 'string') {
    return undefined;
  }

  const trimmedExpression = expression.trim();
  if (trimmedExpression.length === 0) {
    return undefined;
  }

  return trimmedExpression;
}

export function isStandardSchemaLike(value: unknown): value is StandardSchemaLike {
  return isObjectLike(value) && isObjectLike((value as StandardSchemaLike)['~standard']);
}
