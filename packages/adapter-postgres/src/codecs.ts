import type { Codec } from '@prisma-next/sql-target';
import { CodecRegistry } from '@prisma-next/sql-target';

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
  const registry = new CodecRegistry();
  registry.register(stringCodec);
  registry.register(numberCodec);
  registry.register(isoDatetimeCodec);
  return registry;
}

