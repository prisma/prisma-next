import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { validateJsonValue } from './json-schema-validation';

function resolveRowCodec(
  alias: string,
  plan: ExecutionPlan,
  registry: CodecRegistry,
): Codec | null {
  const planCodecId = plan.meta.annotations?.codecs?.[alias] as string | undefined;
  if (planCodecId) {
    const codec = registry.get(planCodecId);
    if (codec) {
      return codec;
    }
  }

  if (plan.meta.projectionTypes) {
    const typeId = plan.meta.projectionTypes[alias];
    if (typeId) {
      const codec = registry.get(typeId);
      if (codec) {
        return codec;
      }
    }
  }

  return null;
}

/**
 * Resolves the column reference for a projection alias.
 * Uses plan.meta.refs.columns to find the { table, column } for a given alias.
 *
 * Aliases in SQL query plans typically match the column name directly.
 */
function resolveColumnRef(
  alias: string,
  plan: ExecutionPlan,
): { table: string; column: string } | null {
  const columns = plan.meta.refs?.columns;
  if (!columns) return null;

  // Match alias to column name in refs
  for (const ref of columns) {
    if (ref.column === alias) {
      return ref;
    }
  }

  return null;
}

export function decodeRow(
  row: Record<string, unknown>,
  plan: ExecutionPlan,
  registry: CodecRegistry,
  jsonValidators?: JsonSchemaValidatorRegistry,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};

  let aliases: readonly string[];
  const projection = plan.meta.projection;
  if (projection && !Array.isArray(projection)) {
    aliases = Object.keys(projection);
  } else if (projection && Array.isArray(projection)) {
    aliases = projection;
  } else {
    aliases = Object.keys(row);
  }

  for (const alias of aliases) {
    const wireValue = row[alias];

    const projection = plan.meta.projection;
    const projectionValue =
      projection && typeof projection === 'object' && !Array.isArray(projection)
        ? (projection as Record<string, string>)[alias]
        : undefined;

    if (typeof projectionValue === 'string' && projectionValue.startsWith('include:')) {
      if (wireValue === null || wireValue === undefined) {
        decoded[alias] = [];
        continue;
      }

      try {
        let parsed: unknown;
        if (typeof wireValue === 'string') {
          parsed = JSON.parse(wireValue);
        } else if (Array.isArray(wireValue)) {
          parsed = wireValue;
        } else {
          parsed = JSON.parse(String(wireValue));
        }

        if (!Array.isArray(parsed)) {
          throw new Error(`Expected array for include alias '${alias}', got ${typeof parsed}`);
        }

        decoded[alias] = parsed;
      } catch (error) {
        const decodeError = new Error(
          `Failed to parse JSON array for include alias '${alias}': ${error instanceof Error ? error.message : String(error)}`,
        ) as Error & {
          code: string;
          category: string;
          severity: string;
          details?: Record<string, unknown>;
        };
        decodeError.code = 'RUNTIME.DECODE_FAILED';
        decodeError.category = 'RUNTIME';
        decodeError.severity = 'error';
        decodeError.details = {
          alias,
          wirePreview:
            typeof wireValue === 'string' && wireValue.length > 100
              ? `${wireValue.substring(0, 100)}...`
              : String(wireValue).substring(0, 100),
        };
        throw decodeError;
      }
      continue;
    }

    if (wireValue === null || wireValue === undefined) {
      decoded[alias] = wireValue;
      continue;
    }

    const codec = resolveRowCodec(alias, plan, registry);

    if (!codec) {
      decoded[alias] = wireValue;
      continue;
    }

    try {
      const decodedValue = codec.decode(wireValue);

      // Validate decoded JSON value against schema
      if (jsonValidators) {
        const ref = resolveColumnRef(alias, plan);
        if (ref) {
          validateJsonValue(
            jsonValidators,
            ref.table,
            ref.column,
            decodedValue,
            'decode',
            codec.id,
          );
        }
      }

      decoded[alias] = decodedValue;
    } catch (error) {
      // Re-throw JSON schema validation errors as-is
      if (
        error instanceof Error &&
        'code' in error &&
        (error as Error & { code: string }).code === 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED'
      ) {
        throw error;
      }

      const decodeError = new Error(
        `Failed to decode row alias '${alias}' with codec '${codec.id}': ${error instanceof Error ? error.message : String(error)}`,
      ) as Error & {
        code: string;
        category: string;
        severity: string;
        details?: Record<string, unknown>;
      };
      decodeError.code = 'RUNTIME.DECODE_FAILED';
      decodeError.category = 'RUNTIME';
      decodeError.severity = 'error';
      decodeError.details = {
        alias,
        codec: codec.id,
        wirePreview:
          typeof wireValue === 'string' && wireValue.length > 100
            ? `${wireValue.substring(0, 100)}...`
            : String(wireValue).substring(0, 100),
      };
      throw decodeError;
    }
  }

  return decoded;
}
