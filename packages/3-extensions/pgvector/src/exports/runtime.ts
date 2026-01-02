import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { Extension } from '@prisma-next/sql-runtime';
import { codecDefinitions } from '../core/codecs';
import { pgvectorRuntimeOperation } from '../core/descriptor-meta';

/**
 * Creates a pgvector extension instance for runtime registration.
 * Provides codecs and operations for vector data type and similarity operations.
 */
export default function pgvector(): Extension {
  return {
    codecs(): CodecRegistry {
      const registry = createCodecRegistry();
      // Register all codecs from codecDefinitions
      for (const def of Object.values(codecDefinitions)) {
        registry.register(def.codec);
      }
      return registry;
    },
    operations(): ReadonlyArray<SqlOperationSignature> {
      return [pgvectorRuntimeOperation];
    },
  };
}
