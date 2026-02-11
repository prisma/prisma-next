/**
 * Unified codec definitions for Postgres adapter.
 *
 * This file contains a single source of truth for all codec information:
 * - Scalar names
 * - Type IDs
 * - Codec implementations (runtime)
 * - Type information (compile-time)
 *
 * This structure is used both at runtime (to populate the registry) and
 * at compile time (to derive CodecTypes).
 */

import { codec, defineCodecs } from '@prisma-next/sql-relational-core/ast';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

// Create individual codec instances
const pgTextCodec = codec({
  typeId: 'pg/text@1',
  targetTypes: ['text'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'text',
        },
      },
    },
  },
});

const pgInt4Codec = codec<'pg/int4@1', number, number>({
  typeId: 'pg/int4@1',
  targetTypes: ['int4'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'integer',
        },
      },
    },
  },
});

const pgInt2Codec = codec<'pg/int2@1', number, number>({
  typeId: 'pg/int2@1',
  targetTypes: ['int2'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'smallint',
        },
      },
    },
  },
});

const pgInt8Codec = codec<'pg/int8@1', number, number>({
  typeId: 'pg/int8@1',
  targetTypes: ['int8'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'bigint',
        },
      },
    },
  },
});

const pgFloat4Codec = codec<'pg/float4@1', number, number>({
  typeId: 'pg/float4@1',
  targetTypes: ['float4'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'real',
        },
      },
    },
  },
});

const pgFloat8Codec = codec<'pg/float8@1', number, number>({
  typeId: 'pg/float8@1',
  targetTypes: ['float8'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'double precision',
        },
      },
    },
  },
});

const pgTimestampCodec = codec<'pg/timestamp@1', string | Date, string>({
  typeId: 'pg/timestamp@1',
  targetTypes: ['timestamp'],
  encode: (value: string | Date): string => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return String(value);
  },
  decode: (wire: string | Date): string => {
    if (typeof wire === 'string') return wire;
    if (wire instanceof Date) return wire.toISOString();
    return String(wire);
  },
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'timestamp without time zone',
        },
      },
    },
  },
});

const pgTimestamptzCodec = codec<'pg/timestamptz@1', string | Date, string>({
  typeId: 'pg/timestamptz@1',
  targetTypes: ['timestamptz'],
  encode: (value: string | Date): string => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return String(value);
  },
  decode: (wire: string | Date): string => {
    if (typeof wire === 'string') return wire;
    if (wire instanceof Date) return wire.toISOString();
    return String(wire);
  },
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'timestamp with time zone',
        },
      },
    },
  },
});

const pgBoolCodec = codec<'pg/bool@1', boolean, boolean>({
  typeId: 'pg/bool@1',
  targetTypes: ['bool'],
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'boolean',
        },
      },
    },
  },
});

const pgEnumCodec = codec<'pg/enum@1', string, string>({
  typeId: 'pg/enum@1',
  targetTypes: ['enum'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgJsonCodec = codec<'pg/json@1', string | JsonValue, JsonValue>({
  typeId: 'pg/json@1',
  targetTypes: ['json'],
  encode: (value) => JSON.stringify(value),
  decode: (wire) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'json',
        },
      },
    },
  },
});

const pgJsonbCodec = codec<'pg/jsonb@1', string | JsonValue, JsonValue>({
  typeId: 'pg/jsonb@1',
  targetTypes: ['jsonb'],
  encode: (value) => JSON.stringify(value),
  decode: (wire) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'jsonb',
        },
      },
    },
  },
});

// Build codec definitions using the builder DSL
const codecs = defineCodecs()
  .add('text', pgTextCodec)
  .add('int4', pgInt4Codec)
  .add('int2', pgInt2Codec)
  .add('int8', pgInt8Codec)
  .add('float4', pgFloat4Codec)
  .add('float8', pgFloat8Codec)
  .add('timestamp', pgTimestampCodec)
  .add('timestamptz', pgTimestamptzCodec)
  .add('bool', pgBoolCodec)
  .add('enum', pgEnumCodec)
  .add('json', pgJsonCodec)
  .add('jsonb', pgJsonbCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
