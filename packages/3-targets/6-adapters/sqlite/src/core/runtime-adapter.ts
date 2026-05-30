import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import { timestampNowRuntimeGenerator } from '@prisma-next/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@prisma-next/sql-runtime';
import { sqliteCodecRegistry } from '@prisma-next/target-sqlite/codecs';
import { createSqliteAdapter, sqliteRawCodecInferer } from './adapter';
import { sqliteAdapterDescriptorMeta } from './descriptor-meta';

export type SqliteRuntimeAdapterInstance = RuntimeAdapterInstance<'sql', 'sqlite'> &
  ReturnType<typeof createSqliteAdapter>;

function createSqliteMutationDefaultGenerators() {
  return [
    ...builtinGeneratorIds.map((id) => ({
      id,
      generate: (params?: Record<string, unknown>) => {
        const spec: GeneratedValueSpec = params ? { id, params } : { id };
        return generateId(spec);
      },
      stability: 'field' as const,
    })),
    timestampNowRuntimeGenerator(),
  ];
}

const sqliteRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<
  'sqlite',
  SqliteRuntimeAdapterInstance
> = {
  ...sqliteAdapterDescriptorMeta,
  codecs: () => Array.from(sqliteCodecRegistry.values()),
  mutationDefaultGenerators: createSqliteMutationDefaultGenerators,
  rawCodecInferer: sqliteRawCodecInferer,
  create(_stack): SqliteRuntimeAdapterInstance {
    return createSqliteAdapter();
  },
};

export default sqliteRuntimeAdapterDescriptor;
