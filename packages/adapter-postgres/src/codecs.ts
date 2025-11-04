import type { Codec } from '@prisma-next/sql-target';
import { CodecRegistry } from '@prisma-next/sql-target';

/**
 * Text codec: text → string (pass-through)
 */
const textCodec: Codec<string, string> = {
  id: 'pg/text@1',
  targetTypes: ['text'],
  decode(wire: string): string {
    return wire;
  },
  encode(value: string): string {
    return value;
  },
};

/**
 * Int4 codec: int4 → number
 */
const int4Codec: Codec<number, number> = {
  id: 'pg/int4@1',
  targetTypes: ['int4'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

/**
 * Int2 codec: int2 → number
 */
const int2Codec: Codec<number, number> = {
  id: 'pg/int2@1',
  targetTypes: ['int2'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

/**
 * Int8 codec: int8 → number
 */
const int8Codec: Codec<number, number> = {
  id: 'pg/int8@1',
  targetTypes: ['int8'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

/**
 * Float4 codec: float4 → number
 */
const float4Codec: Codec<number, number> = {
  id: 'pg/float4@1',
  targetTypes: ['float4'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

/**
 * Float8 codec: float8 → number
 */
const float8Codec: Codec<number, number> = {
  id: 'pg/float8@1',
  targetTypes: ['float8'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

/**
 * Timestamp codec: timestamp → ISO 8601 string
 * Encodes JS Date → ISO string for params
 */
const timestampCodec: Codec<string | Date, string> = {
  id: 'pg/timestamp@1',
  targetTypes: ['timestamp'],
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
 * Timestamptz codec: timestamptz → ISO 8601 string
 * Encodes JS Date → ISO string for params
 */
const timestamptzCodec: Codec<string | Date, string> = {
  id: 'pg/timestamptz@1',
  targetTypes: ['timestamptz'],
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
 * Bool codec: bool → boolean
 */
const boolCodec: Codec<boolean, boolean> = {
  id: 'pg/bool@1',
  targetTypes: ['bool'],
  decode(wire: boolean): boolean {
    return wire;
  },
  encode(value: boolean): boolean {
    return value;
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
  registry.register(textCodec);
  registry.register(int4Codec);
  registry.register(int2Codec);
  registry.register(int8Codec);
  registry.register(float4Codec);
  registry.register(float8Codec);
  registry.register(timestampCodec);
  registry.register(timestamptzCodec);
  registry.register(boolCodec);
  return registry;
}

