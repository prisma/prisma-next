/**
 * Vector codec implementation for pgvector extension.
 *
 * Provides encoding/decoding for the `vector` PostgreSQL type.
 * Wire format is `number[]` (array of numbers).
 */

import { codec, defineCodecs } from '@prisma-next/sql-relational-core/ast';

const pgVectorCodec = codec<'pg/vector@1', number[], number[]>({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  encode: (value: number[]): number[] => {
    // Validate that value is an array of numbers
    if (!Array.isArray(value)) {
      throw new Error('Vector value must be an array of numbers');
    }
    if (!value.every((v) => typeof v === 'number')) {
      throw new Error('Vector value must contain only numbers');
    }
    return value;
  },
  decode: (wire: number[]): number[] => {
    // Validate wire format
    if (!Array.isArray(wire)) {
      throw new Error('Vector wire value must be an array');
    }
    if (!wire.every((v) => typeof v === 'number')) {
      throw new Error('Vector wire value must contain only numbers');
    }
    return wire;
  },
});

// Build codec definitions using the builder DSL
const codecs = defineCodecs().add('vector', pgVectorCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
