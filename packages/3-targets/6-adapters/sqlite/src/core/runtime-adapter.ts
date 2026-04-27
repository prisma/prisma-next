import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@prisma-next/sql-runtime';
import { createSqliteAdapter } from './adapter';
import { codecDefinitions } from './codecs';
import { sqliteAdapterDescriptorMeta } from './descriptor-meta';

export type SqliteRuntimeAdapterInstance = RuntimeAdapterInstance<'sql', 'sqlite'> &
  ReturnType<typeof createSqliteAdapter>;

function createSqliteCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

function createSqliteMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => {
      const spec: GeneratedValueSpec = params ? { id, params } : { id };
      return generateId(spec);
    },
  }));
}

const sqliteRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<
  'sqlite',
  SqliteRuntimeAdapterInstance
> = {
  ...sqliteAdapterDescriptorMeta,
  codecs: createSqliteCodecRegistry,
  parameterizedCodecs: () => [],
  mutationDefaultGenerators: createSqliteMutationDefaultGenerators,
  create(_stack): SqliteRuntimeAdapterInstance {
    return createSqliteAdapter();
  },
};

export default sqliteRuntimeAdapterDescriptor;
