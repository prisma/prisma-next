import type { Codec, CodecRegistry } from '@prisma-next/sql-target';
import type { Plan } from '@prisma-next/sql-query/types';

/**
 * Resolves a codec for row decoding using precedence rules.
 *
 * Precedence:
 * 1. Plan hint: `annotations.codecs[alias]` → select by id
 * 2. Projection type: `projectionTypes[alias]` → select by typeId
 * 3. Fallback: null (pass through driver value)
 */
function resolveRowCodec(alias: string, plan: Plan, registry: CodecRegistry): Codec | null {
  // 1. Plan hint: annotations.codecs[alias]
  const planCodecId = plan.meta.annotations?.codecs?.[alias] as string | undefined;
  if (planCodecId) {
    const codec = registry.get(planCodecId);
    if (codec) {
      return codec;
    }
  }

  // 2. Projection type: projectionTypes[alias] → registry.get(typeId)
  if (plan.meta.projectionTypes) {
    const typeId = plan.meta.projectionTypes[alias];
    if (typeId) {
      const codec = registry.get(typeId);
      if (codec) {
        return codec;
      }
    }
  }

  // 3. Fallback: no codec
  return null;
}

/**
 * Decodes a single row using codec registry.
 *
 * For each alias in the projection:
 * - Resolve codec using precedence
 * - Null short-circuit before decode
 * - Apply decode; wrap errors in RUNTIME.DECODE_FAILED
 * - If no codec found, pass through driver value (log warning in MVP)
 */
export function decodeRow(
  row: Record<string, unknown>,
  plan: Plan,
  registry: CodecRegistry,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};

  // Get projection aliases
  let aliases: readonly string[];
  const projection = plan.meta.projection;
  if (projection && !Array.isArray(projection)) {
    // DSL plan: projection is Record<string, string>
    aliases = Object.keys(projection);
  } else if (projection && Array.isArray(projection)) {
    // Raw plan: projection is ReadonlyArray<string>
    aliases = projection;
  } else {
    // No projection: use row keys
    aliases = Object.keys(row);
  }

  for (const alias of aliases) {
    const wireValue = row[alias];

    // Null short-circuit: pass through without decoding
    if (wireValue === null || wireValue === undefined) {
      decoded[alias] = wireValue;
      continue;
    }

    // Resolve codec
    const codec = resolveRowCodec(alias, plan, registry);

    if (!codec) {
      // No codec: pass through driver value (fallback in MVP)
      // TODO: log warning in debug mode
      decoded[alias] = wireValue;
      continue;
    }

    // Apply decode
    try {
      decoded[alias] = codec.decode(wireValue);
    } catch (error) {
      // Wrap error in RUNTIME.DECODE_FAILED envelope
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
            ? wireValue.substring(0, 100) + '...'
            : String(wireValue).substring(0, 100),
      };
      throw decodeError;
    }
  }

  return decoded;
}
