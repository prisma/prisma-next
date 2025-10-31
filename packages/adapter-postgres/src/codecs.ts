import type { Codec, CodecRegistry } from '@prisma-next/runtime';

/**
 * Core string codec: text → string (pass-through)
 */
const stringCodec: Codec<string, string> = {
  id: 'core/string@1',
  targetTypes: ['text'],
  decode(wire: string): string {
    return wire;
  },
  encode(value: string): string {
    return value;
  },
};

/**
 * Core number codec: int4/float8 → number
 */
const numberCodec: Codec<number, number> = {
  id: 'core/number@1',
  targetTypes: ['int4', 'float8', 'int2', 'int8', 'float4'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

/**
 * Core ISO datetime codec: timestamp/timestamptz → ISO 8601 string
 * Encodes JS Date → ISO string for params
 */
const isoDatetimeCodec: Codec<string | Date, string> = {
  id: 'core/iso-datetime@1',
  targetTypes: ['timestamp', 'timestamptz'],
  decode(wire: string | Date): string {
    // If already a string (ISO format from DB), return as-is
    if (typeof wire === 'string') {
      return wire;
    }
    // If Date object, convert to ISO string
    if (wire instanceof Date) {
      return wire.toISOString();
    }
    // Fallback: convert to string
    return String(wire);
  },
  encode(value: string | Date): string {
    // If JS Date, convert to ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }
    // If already a string, assume it's ISO format and return as-is
    if (typeof value === 'string') {
      return value;
    }
    // Fallback: convert to string
    return String(value);
  },
};

/**
 * Creates a codec registry for Postgres adapter with core codecs.
 *
 * The registry maps:
 * - byId: direct codec lookup by namespaced ID
 * - byScalar: contract scalar type → ordered list of codec candidates
 */
export function createPostgresCodecRegistry(): CodecRegistry {
  const byId = new Map<string, Codec>();
  const byScalar = new Map<string, Codec[]>();

  // Register all codecs
  const codecs = [stringCodec, numberCodec, isoDatetimeCodec];

  // Populate byId map
  for (const codec of codecs) {
    byId.set(codec.id, codec);
  }

  // Populate byScalar map (each codec can handle multiple scalar types)
  for (const codec of codecs) {
    for (const scalarType of codec.targetTypes) {
      const existing = byScalar.get(scalarType);
      if (existing) {
        existing.push(codec);
      } else {
        byScalar.set(scalarType, [codec]);
      }
    }
  }

  // Freeze arrays in byScalar to prevent mutation
  const frozenByScalar = new Map<string, readonly Codec[]>();
  for (const [scalar, codecList] of byScalar.entries()) {
    frozenByScalar.set(scalar, Object.freeze([...codecList]));
  }

  return Object.freeze({
    byId: Object.freeze(byId),
    byScalar: Object.freeze(frozenByScalar),
  });
}

