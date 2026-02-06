/**
 * Unified codec definitions for SQLite adapter.
 *
 * Single source of truth for:
 * - Scalar names
 * - Type IDs
 * - Codec implementations (runtime)
 * - Type information (compile-time)
 */

import { codec, defineCodecs } from '@prisma-next/sql-relational-core/ast';

const sqliteTextCodec = codec<'sqlite/text@1', string, string>({
  typeId: 'sqlite/text@1',
  targetTypes: ['text'],
  encode: (value) => value,
  decode: (wire) => String(wire),
  meta: {
    db: {
      sql: {
        sqlite: {
          nativeType: 'text',
        },
      },
    },
  },
});

const sqliteIntCodec = codec<'sqlite/int@1', number, number>({
  typeId: 'sqlite/int@1',
  targetTypes: ['int'],
  encode: (value) => value,
  decode: (wire) => (typeof wire === 'number' ? wire : Number(wire)),
  meta: {
    db: {
      sql: {
        sqlite: {
          nativeType: 'integer',
        },
      },
    },
  },
});

const sqliteRealCodec = codec<'sqlite/real@1', number, number>({
  typeId: 'sqlite/real@1',
  targetTypes: ['real'],
  encode: (value) => value,
  decode: (wire) => (typeof wire === 'number' ? wire : Number(wire)),
  meta: {
    db: {
      sql: {
        sqlite: {
          nativeType: 'real',
        },
      },
    },
  },
});

const sqliteDatetimeCodec = codec<'sqlite/datetime@1', string, string | Date>({
  typeId: 'sqlite/datetime@1',
  targetTypes: ['datetime'],
  encode: (value) => (value instanceof Date ? value.toISOString() : String(value)),
  decode: (wire) => String(wire),
  meta: {
    db: {
      sql: {
        sqlite: {
          // SQLite doesn't enforce types; store datetimes as ISO-ish TEXT.
          nativeType: 'text',
        },
      },
    },
  },
});

const sqliteBoolCodec = codec<'sqlite/bool@1', number, boolean>({
  typeId: 'sqlite/bool@1',
  targetTypes: ['bool'],
  encode: (value) => (value ? 1 : 0),
  decode: (wire) => Boolean(wire),
  meta: {
    db: {
      sql: {
        sqlite: {
          nativeType: 'integer',
        },
      },
    },
  },
});

const codecs = defineCodecs()
  .add('text', sqliteTextCodec)
  .add('int', sqliteIntCodec)
  .add('real', sqliteRealCodec)
  .add('datetime', sqliteDatetimeCodec)
  .add('bool', sqliteBoolCodec);

export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

export type CodecTypes = typeof codecs.CodecTypes;
