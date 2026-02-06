/**
 * Vector codec implementation for sqlite-vector extension.
 *
 * Stores vectors as JSON text, e.g. `[1,2,3]`.
 */

import { codec, defineCodecs } from '@prisma-next/sql-relational-core/ast';

const sqliteVectorCodec = codec<'sqlite/vector@1', string, number[]>({
  typeId: 'sqlite/vector@1',
  targetTypes: ['text'],
  encode: (value: number[]): string => {
    if (!Array.isArray(value)) {
      throw new Error('Vector value must be an array of numbers');
    }
    if (!value.every((v) => typeof v === 'number')) {
      throw new Error('Vector value must contain only numbers');
    }
    return JSON.stringify(value);
  },
  decode: (wire: string): number[] => {
    if (typeof wire !== 'string') {
      throw new Error('Vector wire value must be a string');
    }
    const parsed = JSON.parse(wire) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Vector wire value must be a JSON array');
    }
    if (!parsed.every((v) => typeof v === 'number')) {
      throw new Error('Vector wire value must contain only numbers');
    }
    return parsed as number[];
  },
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

// Build codec definitions using the builder DSL
const codecs = defineCodecs().add('vector', sqliteVectorCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
