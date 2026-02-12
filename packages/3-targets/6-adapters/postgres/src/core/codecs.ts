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

import type { Codec, CodecMeta } from '@prisma-next/sql-relational-core/ast';
import { codec, defineCodecs, sqlCodecDefinitions } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';
import { type as arktype } from 'arktype';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
} from './codec-ids';

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

const numericParamsSchema = arktype({
  precision: 'number.integer > 0 & number.integer <= 1000',
  'scale?': 'number.integer >= 0',
});

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

function aliasCodec<
  Id extends string,
  TWire,
  TJs,
  TParams = Record<string, unknown>,
  THelper = unknown,
>(
  base: Codec<string, TWire, TJs, TParams, THelper>,
  options: {
    readonly typeId: Id;
    readonly targetTypes: readonly string[];
    readonly meta?: CodecMeta;
  },
): Codec<Id, TWire, TJs, TParams, THelper> {
  return {
    id: options.typeId,
    targetTypes: options.targetTypes,
    ...ifDefined('meta', options.meta),
    ...ifDefined('paramsSchema', base.paramsSchema),
    ...ifDefined('init', base.init),
    ...ifDefined('encode', base.encode),
    decode: base.decode,
  };
}

const sqlCharCodec = sqlCodecDefinitions.char.codec;
const sqlVarcharCodec = sqlCodecDefinitions.varchar.codec;
const sqlIntCodec = sqlCodecDefinitions.int.codec;
const sqlFloatCodec = sqlCodecDefinitions.float.codec;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

// Create individual codec instances
const pgTextCodec = codec({
  typeId: PG_TEXT_CODEC_ID,
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

const pgCharCodec = aliasCodec(sqlCharCodec, {
  typeId: PG_CHAR_CODEC_ID,
  targetTypes: ['character'],
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'character',
        },
      },
    },
  },
});

const pgVarcharCodec = aliasCodec(sqlVarcharCodec, {
  typeId: PG_VARCHAR_CODEC_ID,
  targetTypes: ['character varying'],
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'character varying',
        },
      },
    },
  },
});

const pgIntCodec = aliasCodec(sqlIntCodec, {
  typeId: PG_INT_CODEC_ID,
  targetTypes: ['int4'],
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

const pgFloatCodec = aliasCodec(sqlFloatCodec, {
  typeId: PG_FLOAT_CODEC_ID,
  targetTypes: ['float8'],
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

const pgInt4Codec = codec<typeof PG_INT4_CODEC_ID, number, number>({
  typeId: PG_INT4_CODEC_ID,
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

const pgNumericCodec = codec<typeof PG_NUMERIC_CODEC_ID, string, string>({
  typeId: PG_NUMERIC_CODEC_ID,
  targetTypes: ['numeric', 'decimal'],
  encode: (value: string): string => value,
  decode: (wire: string | number): string => {
    if (typeof wire === 'number') return String(wire);
    return wire;
  },
  paramsSchema: numericParamsSchema,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'numeric',
        },
      },
    },
  },
});

const pgInt2Codec = codec<typeof PG_INT2_CODEC_ID, number, number>({
  typeId: PG_INT2_CODEC_ID,
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

const pgInt8Codec = codec<typeof PG_INT8_CODEC_ID, number, number>({
  typeId: PG_INT8_CODEC_ID,
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

const pgFloat4Codec = codec<typeof PG_FLOAT4_CODEC_ID, number, number>({
  typeId: PG_FLOAT4_CODEC_ID,
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

const pgFloat8Codec = codec<typeof PG_FLOAT8_CODEC_ID, number, number>({
  typeId: PG_FLOAT8_CODEC_ID,
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

const pgTimestampCodec = codec<typeof PG_TIMESTAMP_CODEC_ID, string | Date, string>({
  typeId: PG_TIMESTAMP_CODEC_ID,
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
  paramsSchema: precisionParamsSchema,
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

const pgTimestamptzCodec = codec<typeof PG_TIMESTAMPTZ_CODEC_ID, string | Date, string>({
  typeId: PG_TIMESTAMPTZ_CODEC_ID,
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
  paramsSchema: precisionParamsSchema,
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

const pgTimeCodec = codec<typeof PG_TIME_CODEC_ID, string, string>({
  typeId: PG_TIME_CODEC_ID,
  targetTypes: ['time'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: precisionParamsSchema,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'time',
        },
      },
    },
  },
});

const pgTimetzCodec = codec<typeof PG_TIMETZ_CODEC_ID, string, string>({
  typeId: PG_TIMETZ_CODEC_ID,
  targetTypes: ['timetz'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: precisionParamsSchema,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'timetz',
        },
      },
    },
  },
});

const pgBoolCodec = codec<typeof PG_BOOL_CODEC_ID, boolean, boolean>({
  typeId: PG_BOOL_CODEC_ID,
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

const pgBitCodec = codec<typeof PG_BIT_CODEC_ID, string, string>({
  typeId: PG_BIT_CODEC_ID,
  targetTypes: ['bit'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: lengthParamsSchema,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'bit',
        },
      },
    },
  },
});

const pgVarbitCodec = codec<typeof PG_VARBIT_CODEC_ID, string, string>({
  typeId: PG_VARBIT_CODEC_ID,
  targetTypes: ['bit varying'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: lengthParamsSchema,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'bit varying',
        },
      },
    },
  },
});

const pgEnumCodec = codec<typeof PG_ENUM_CODEC_ID, string, string>({
  typeId: PG_ENUM_CODEC_ID,
  targetTypes: ['enum'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgIntervalCodec = codec<typeof PG_INTERVAL_CODEC_ID, string, string>({
  typeId: PG_INTERVAL_CODEC_ID,
  targetTypes: ['interval'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: precisionParamsSchema,
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'interval',
        },
      },
    },
  },
});

const pgJsonCodec = codec<typeof PG_JSON_CODEC_ID, string | JsonValue, JsonValue>({
  typeId: PG_JSON_CODEC_ID,
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

const pgJsonbCodec = codec<typeof PG_JSONB_CODEC_ID, string | JsonValue, JsonValue>({
  typeId: PG_JSONB_CODEC_ID,
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
  .add('char', sqlCharCodec)
  .add('varchar', sqlVarcharCodec)
  .add('int', sqlIntCodec)
  .add('float', sqlFloatCodec)
  .add('text', pgTextCodec)
  .add('character', pgCharCodec)
  .add('character varying', pgVarcharCodec)
  .add('integer', pgIntCodec)
  .add('double precision', pgFloatCodec)
  .add('int4', pgInt4Codec)
  .add('int2', pgInt2Codec)
  .add('int8', pgInt8Codec)
  .add('float4', pgFloat4Codec)
  .add('float8', pgFloat8Codec)
  .add('numeric', pgNumericCodec)
  .add('timestamp', pgTimestampCodec)
  .add('timestamptz', pgTimestamptzCodec)
  .add('time', pgTimeCodec)
  .add('timetz', pgTimetzCodec)
  .add('bool', pgBoolCodec)
  .add('bit', pgBitCodec)
  .add('bit varying', pgVarbitCodec)
  .add('interval', pgIntervalCodec)
  .add('enum', pgEnumCodec)
  .add('json', pgJsonCodec)
  .add('jsonb', pgJsonbCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
