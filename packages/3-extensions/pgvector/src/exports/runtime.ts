import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeExtensionInstance,
} from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { codecDefinitions } from '../core/codecs';
import { pgvectorPackMeta, pgvectorRuntimeOperation } from '../core/descriptor-meta';

const vectorTypeId = 'pg/vector@1' as const;
const vectorParamsSchema = arktype({
  length: 'number',
}).narrow((params, ctx) => {
  const { length } = params;
  if (!Number.isInteger(length)) {
    return ctx.mustBe('an integer');
  }
  if (length < 1 || length > 16000) {
    return ctx.mustBe('in the range [1, 16000]');
  }
  return true;
});

/**
 * pgvector SQL runtime extension instance.
 * Provides codecs and operations for vector data type and similarity operations.
 */
class PgVectorRuntimeExtensionInstance implements SqlRuntimeExtensionInstance<'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  codecs(): CodecRegistry {
    const registry = createCodecRegistry();
    // Register all codecs from codecDefinitions
    for (const def of Object.values(codecDefinitions)) {
      registry.register(def.codec);
    }
    return registry;
  }

  operations(): ReadonlyArray<SqlOperationSignature> {
    return [pgvectorRuntimeOperation];
  }

  parameterizedCodecs(): ReadonlyArray<
    RuntimeParameterizedCodecDescriptor<{ readonly length: number }>
  > {
    return [
      {
        codecId: vectorTypeId,
        paramsSchema: vectorParamsSchema,
      },
    ];
  }
}

/**
 * pgvector SQL runtime extension descriptor.
 * Provides metadata and factory for creating runtime extension instances.
 */
const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  create(): SqlRuntimeExtensionInstance<'postgres'> {
    return new PgVectorRuntimeExtensionInstance();
  },
};

export default pgvectorRuntimeDescriptor;
