import type { RuntimeAdapterInstance } from '@prisma-next/core-execution-plane/types';
import type { Adapter, CodecRegistry, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@prisma-next/sql-runtime';
import { createPostgresAdapter } from '../core/adapter';
import { codecDefinitions } from '../core/codecs';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

/**
 * SQL runtime adapter interface for Postgres.
 * Extends RuntimeAdapterInstance with SQL-specific adapter methods.
 */
export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<QueryAst, PostgresContract, PostgresLoweredStatement> {}

/**
 * Creates the codec registry from codec definitions.
 * Used for both static contributions and adapter instance.
 */
function createPostgresCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

/**
 * Postgres adapter descriptor for runtime plane.
 * Implements SqlRuntimeAdapterDescriptor with required static contributions.
 *
 * The adapter contributes codecs for all postgres native types.
 * Operations and parameterized codecs are not contributed by the adapter.
 */
const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: createPostgresCodecRegistry,
    operationSignatures: () => [],
    parameterizedCodecs: () => [],
    create(): SqlRuntimeAdapter {
      return createPostgresAdapter();
    },
  };

export default postgresRuntimeAdapterDescriptor;
