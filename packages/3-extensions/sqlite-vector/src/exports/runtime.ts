import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeExtensionInstance,
} from '@prisma-next/sql-runtime';
import { codecDefinitions } from '../core/codecs';
import { sqliteVectorPackMeta, sqliteVectorRuntimeOperation } from '../core/descriptor-meta';

/**
 * sqlite-vector SQL runtime extension instance.
 * Provides codecs and operations for vector data type and similarity operations.
 */
class SqliteVectorRuntimeExtensionInstance implements SqlRuntimeExtensionInstance<'sqlite'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  codecs(): CodecRegistry {
    const registry = createCodecRegistry();
    // Register all codecs from codecDefinitions
    for (const def of Object.values(codecDefinitions)) {
      registry.register(def.codec);
    }
    return registry;
  }

  operations(): ReadonlyArray<SqlOperationSignature> {
    return [sqliteVectorRuntimeOperation];
  }
}

/**
 * sqlite-vector SQL runtime extension descriptor.
 * Provides metadata and factory for creating runtime extension instances.
 */
const sqliteVectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'sqlite'> = {
  kind: 'extension' as const,
  id: sqliteVectorPackMeta.id,
  version: sqliteVectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'sqlite' as const,
  create(): SqlRuntimeExtensionInstance<'sqlite'> {
    return new SqliteVectorRuntimeExtensionInstance();
  },
};

export default sqliteVectorRuntimeDescriptor;
