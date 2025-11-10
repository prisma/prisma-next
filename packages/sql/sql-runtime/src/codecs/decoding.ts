import type { Plan } from '@prisma-next/contract/types';
import type { Codec, CodecRegistry } from '@prisma-next/sql-target';

function resolveRowCodec(alias: string, plan: Plan, registry: CodecRegistry): Codec | null {
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

export function decodeRow(
  row: Record<string, unknown>,
  plan: Plan,
  registry: CodecRegistry,
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
      decoded[alias] = codec.decode(wireValue);
    } catch (error) {
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
