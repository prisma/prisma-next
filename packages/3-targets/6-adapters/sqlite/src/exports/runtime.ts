import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { codecDefinitions } from '../core/codecs';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';

function createSqliteCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

const sqliteRuntimeAdapterDescriptor = {
  ...sqliteAdapterDescriptorMeta,
  codecs: createSqliteCodecRegistry,
  operationSignatures: () => [],
  parameterizedCodecs: () => [],
  mutationDefaultGenerators: () => [],
};

export default sqliteRuntimeAdapterDescriptor;
