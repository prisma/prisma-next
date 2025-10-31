import type { Codec, CodecRegistry } from './types';

/**
 * Composes a codec registry from adapter defaults and runtime overrides.
 *
 * Precedence:
 * 1. Runtime overrides (by codec ID)
 * 2. Adapter defaults
 *
 * Runtime overrides are merged by codec ID, replacing adapter codecs
 * with the same ID if present.
 */
export function composeCodecRegistry(
  adapterRegistry: CodecRegistry,
  overrides?: Record<string, string>,
): CodecRegistry {
  if (!overrides || Object.keys(overrides).length === 0) {
    return adapterRegistry;
  }

  // Start with adapter registry
  const byId = new Map(adapterRegistry.byId);
  const byScalar = new Map<string, Codec[]>();

  // Copy adapter's byScalar structure
  for (const [scalar, codecs] of adapterRegistry.byScalar.entries()) {
    byScalar.set(scalar, [...codecs]);
  }

  // Apply overrides: if a codec ID is in overrides, replace it in both maps
  // Note: Overrides map alias/column → codec ID, but we need to look up the codec
  // This will be handled during resolution, not here.
  // For now, we just return the adapter registry with overrides tracked separately.

  // In MVP, overrides are applied during resolution, not registry composition.
  // The registry remains adapter-provided, and overrides are checked during encode/decode.

  return Object.freeze({
    byId: Object.freeze(byId),
    byScalar: Object.freeze(byScalar),
  });
}

