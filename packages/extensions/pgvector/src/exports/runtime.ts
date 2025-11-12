import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { Extension } from '@prisma-next/sql-runtime';
import { codecDefinitions } from '../core/codecs';

/**
 * Creates a pgvector extension instance for runtime registration.
 * Provides codecs and operations for vector data type and similarity operations.
 */
export default function pgvector(): Extension {
  return {
    codecs(): CodecRegistry {
      const registry = createCodecRegistry();
      // Register all codecs from codecDefinitions
      for (const codec of codecDefinitions.values()) {
        registry.register(codec);
      }
      return registry;
    },
    operations(): ReadonlyArray<SqlOperationSignature> {
      return [
        {
          forTypeId: 'pg/vector@1',
          method: 'cosineDistance',
          args: [{ kind: 'typeId', type: 'pg/vector@1' }],
          returns: { kind: 'builtin', type: 'number' },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: '1 - ({{self}} <=> {{arg0}})',
          },
        },
      ];
    },
  };
}
