/**
 * Vector codec implementation for pgvector extension.
 *
 * Provides encoding/decoding for the `vector` PostgreSQL type.
 * Wire format is a string like `[1,2,3]` (PostgreSQL vector text format).
 */

import { codec, defineCodecs } from '@prisma-next/sql-relational-core/ast';

const pgVectorCodec = codec<'pg/vector@1', string, number[]>({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  encode: (value: number[]): string => {
    // Validate that value is an array of numbers
    if (!Array.isArray(value)) {
      throw new Error('Vector value must be an array of numbers');
    }
    if (!value.every((v) => typeof v === 'number')) {
      throw new Error('Vector value must contain only numbers');
    }
    // Format as PostgreSQL vector text format: [1,2,3]
    // PostgreSQL's pg library requires the vector format string
    return `[${value.join(',')}]`;
  },
  decode: (wire: string): number[] => {
    // Handle string format from PostgreSQL: [1,2,3]
    if (typeof wire !== 'string') {
      throw new Error('Vector wire value must be a string');
    }
    // Parse PostgreSQL vector format: [1,2,3]
    if (!wire.startsWith('[') || !wire.endsWith(']')) {
      throw new Error(`Invalid vector format: expected "[...]", got "${wire}"`);
    }
    const content = wire.slice(1, -1).trim();
    if (content === '') {
      return [];
    }
    const values = content.split(',').map((v) => {
      const num = Number.parseFloat(v.trim());
      if (Number.isNaN(num)) {
        throw new Error(`Invalid vector value: "${v}" is not a number`);
      }
      return num;
    });
    return values;
  },
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: 'vector',
        },
      },
    },
  },
});

// Build codec definitions using the builder DSL
const codecs = defineCodecs().add('vector', pgVectorCodec);

// Export derived structures directly from codecs builder
export const codecDefinitions = codecs.codecDefinitions;
export const dataTypes = codecs.dataTypes;

// Export types derived from codecs builder
export type CodecTypes = typeof codecs.CodecTypes;
