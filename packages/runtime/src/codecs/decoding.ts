import type { Codec, CodecRegistry } from '@prisma-next/sql-target';
import type { Plan, DslPlan } from '@prisma-next/sql/types';

/**
 * Resolves a codec for row decoding using precedence rules.
 *
 * Precedence:
 * 1. Plan hint: `annotations.codecs[alias]` → select by id
 * 2. Runtime overrides: `overrides[alias]` or `overrides['table.column']` → select by id
 * 3. Projection type: `projectionTypes[alias]` → `byScalar.get(scalar)` → first candidate
 * 4. Fallback: null (pass through driver value)
 */
function resolveRowCodec(
  alias: string,
  plan: Plan,
  registry: CodecRegistry,
  overrides?: Record<string, string>,
): Codec | null {
  // 1. Plan hint: annotations.codecs[alias]
  const planCodecId = plan.meta.annotations?.codecs?.[alias] as string | undefined;
  if (planCodecId) {
    const codec = registry.byId.get(planCodecId);
    if (codec) {
      return codec;
    }
  }

  // 2. Runtime overrides: check alias first, then table.column if DSL plan
  if (overrides) {
    const overrideId = overrides[alias];
    if (overrideId) {
      const codec = registry.byId.get(overrideId);
      if (codec) {
        return codec;
      }
    }

    // Check table.column for DSL plans
    if (plan.meta.lane === 'dsl') {
      const dslPlan = plan as DslPlan;
      const tableColumn = dslPlan.meta.projection[alias];
      if (tableColumn) {
        const overrideId = overrides[tableColumn];
        if (overrideId) {
          const codec = registry.byId.get(overrideId);
          if (codec) {
            return codec;
          }
        }
      }
    }
  }

  // 3. Projection type: projectionTypes[alias] → byScalar
  if (plan.meta.lane === 'dsl') {
    const dslPlan = plan as DslPlan;
    const scalarType = dslPlan.meta.projectionTypes?.[alias];
    if (scalarType) {
      const candidates = registry.byScalar.get(scalarType);
      if (candidates && candidates.length > 0) {
        return candidates[0];
      }
    }
  }

  // 4. Fallback: no codec
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
  overrides?: Record<string, string>,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};

  // Get projection aliases
  let aliases: readonly string[];
  if (plan.meta.lane === 'dsl') {
    const dslPlan = plan as DslPlan;
    aliases = Object.keys(dslPlan.meta.projection);
  } else {
    // Raw plan: use projection array or row keys
    const rawPlan = plan;
    const rawProjection = rawPlan.meta.projection;
    if (rawProjection && Array.isArray(rawProjection)) {
      // Raw plan projection is ReadonlyArray<string>
      aliases = rawProjection;
    } else {
      aliases = Object.keys(row);
    }
  }

  for (const alias of aliases) {
    const wireValue = row[alias];

    // Null short-circuit: pass through without decoding
    if (wireValue === null || wireValue === undefined) {
      decoded[alias] = wireValue;
      continue;
    }

    // Resolve codec
    const codec = resolveRowCodec(alias, plan, registry, overrides);

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
      ) as Error & { code: string; category: string; severity: string; details?: Record<string, unknown> };
      decodeError.code = 'RUNTIME.DECODE_FAILED';
      decodeError.category = 'RUNTIME';
      decodeError.severity = 'error';
      decodeError.details = {
        alias,
        codec: codec.id,
        wirePreview: typeof wireValue === 'string' && wireValue.length > 100
          ? wireValue.substring(0, 100) + '...'
          : String(wireValue).substring(0, 100),
      };
      throw decodeError;
    }
  }

  return decoded;
}

