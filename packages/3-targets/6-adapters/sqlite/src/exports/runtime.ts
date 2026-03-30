import type { RuntimeAdapterInstance } from '@prisma-next/core-execution-plane/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@prisma-next/sql-runtime';
import { createSqliteAdapter } from '../core/adapter';
import { codecDefinitions } from '../core/codecs';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';

export type SqliteRuntimeAdapterInstance = RuntimeAdapterInstance<'sql', 'sqlite'> &
  ReturnType<typeof createSqliteAdapter>;

function createSqliteCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

const sqliteRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<
  'sqlite',
  SqliteRuntimeAdapterInstance
> = {
  ...sqliteAdapterDescriptorMeta,
  codecs: createSqliteCodecRegistry,
  operationSignatures: () => [],
  parameterizedCodecs: () => [],
  mutationDefaultGenerators: () => [],
  create(): SqliteRuntimeAdapterInstance {
    return createSqliteAdapter();
  },
};

export default sqliteRuntimeAdapterDescriptor;
