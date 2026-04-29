/**
 * Runtime-plane extension descriptor for pgvector.
 *
 * Composes pack metadata, query operations, the parameterized codec
 * descriptor, and the legacy `codecs:` registry into the runtime-plane
 * shape the SQL runtime consumes.
 *
 * The legacy `codecs:` registration is preserved (Phase 1 of codec-registry-
 * unification): the runtime dispatch path still consumes
 * `codecRegistry.get(codecId)` for parameterized codecs. Phase 3 retires this
 * for parameterized codecs in favour of consuming the resolved codec from
 * `pgVectorCodec.factory(typeParams)(ctx)` per `storage.types` instance. The
 * representative instance comes from `pgVectorRepresentativeCodec`, which
 * sources from the same factory the runtime materialization invokes — single
 * source of truth for encode/decode, no parallel `codec(...)` declaration.
 */

import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { pgvectorPackMeta } from './pack-meta';
import { pgvectorQueryOperations } from './query-operations';
import { pgVectorCodec, pgVectorRepresentativeCodec } from './vector-codec';

function createPgvectorCodecRegistry() {
  const registry = createCodecRegistry();
  registry.register(pgVectorRepresentativeCodec);
  return registry;
}

export const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: createPgvectorCodecRegistry,
  queryOperations: () => pgvectorQueryOperations(),
  parameterizedCodecs: () => [pgVectorCodec],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};
