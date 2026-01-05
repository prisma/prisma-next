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

/**
 * Generic codec for Postgres enum types.
 * Enums are wire-encoded as strings and JS-typed as strings.
 * The specific enum type name is provided via nativeType in the storage column.
 *
 * Note: Runtime validation of enum values is not performed at the codec level
 * because codecs are designed to be stateless and context-free. The valid enum
 * values are defined per-column in the contract, which is not accessible here.
 * TypeScript types provide compile-time safety. Future enhancement: add an
 * optional validation layer at the encoding step that has contract context.
 */
const pgEnumCodec = codec<'pg/enum@1', string, string>({
  typeId: 'pg/enum@1',
  targetTypes: [], // Enum types are dynamically determined by nativeType
  encode: (value) => value,
  decode: (wire) => wire,
  meta: {
    db: {
      sql: {
        postgres: {
          // The actual enum type name is specified per-column via nativeType.
          // This placeholder indicates it's an enum without specifying which one.
          nativeType: 'enum',
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
  .add('enum', pgEnumCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
