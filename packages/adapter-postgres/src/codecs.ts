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

import { codec, defineCodecs } from '@prisma-next/sql-target';

// Create individual codec instances
const pgTextCodec = codec({
  typeId: 'pg/text@1',
  targetTypes: ['text'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
});

const pgInt4Codec = codec<'pg/int4@1', number, number>({
  typeId: 'pg/int4@1',
  targetTypes: ['int4'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgInt2Codec = codec<'pg/int2@1', number, number>({
  typeId: 'pg/int2@1',
  targetTypes: ['int2'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgInt8Codec = codec<'pg/int8@1', number, number>({
  typeId: 'pg/int8@1',
  targetTypes: ['int8'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgFloat4Codec = codec<'pg/float4@1', number, number>({
  typeId: 'pg/float4@1',
  targetTypes: ['float4'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgFloat8Codec = codec<'pg/float8@1', number, number>({
  typeId: 'pg/float8@1',
  targetTypes: ['float8'],
  encode: (value) => value,
  decode: (wire) => wire,
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
});

const pgBoolCodec = codec<'pg/bool@1', boolean, boolean>({
  typeId: 'pg/bool@1',
  targetTypes: ['bool'],
  encode: (value) => value,
  decode: (wire) => wire,
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
  .add('bool', pgBoolCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
