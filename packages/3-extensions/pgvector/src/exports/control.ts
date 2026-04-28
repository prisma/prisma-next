import type {
  CodecControlHooks,
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';
import { pgVectorCodec } from './codecs';

const PGVECTOR_CODEC_ID = 'pg/vector@1' as const;

function buildVectorIdentityValue(typeParams: Record<string, unknown> | undefined): string | null {
  const length = typeParams?.['length'];
  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    return null;
  }

  const zeroVector = `[${new Array(length).fill('0').join(',')}]`;
  return `'${zeroVector}'::vector`;
}

const vectorControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) => {
    const length = typeParams?.['length'];
    if (typeof length === 'number' && Number.isInteger(length) && length > 0) {
      return `${nativeType}(${length})`;
    }
    return nativeType;
  },
  resolveIdentityValue: ({ typeParams }) => buildVectorIdentityValue(typeParams),
};

const pgvectorDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.vector',
      label: 'Enable vector extension',
      install: [
        {
          id: 'extension.vector',
          label: 'Enable extension "vector"',
          summary: 'Ensures the vector extension is available for pgvector operations',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify extension "vector" is not already enabled',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
          execute: [
            {
              description: 'create extension "vector"',
              sql: 'CREATE EXTENSION IF NOT EXISTS vector',
            },
          ],
          postcheck: [
            {
              description: 'confirm extension "vector" is enabled',
              sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
            },
          ],
        },
      ],
    },
  ],
};

const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...pgvectorPackMeta,
  types: {
    ...pgvectorPackMeta.types,
    codecTypes: {
      ...pgvectorPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [PGVECTOR_CODEC_ID]: vectorControlPlaneHooks,
      },
      // M4 cleanup F03: register the parameterized codec descriptor with the
      // control stack so the emitter can read `renderOutputType` off the
      // descriptor (the spec'"'"'s long-term home).
      parameterizedCodecs: [pgVectorCodec],
    },
  },
  queryOperations: () => pgvectorQueryOperations(),
  databaseDependencies: pgvectorDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { pgvectorExtensionDescriptor };
export default pgvectorExtensionDescriptor;
