/**
 * pgvector pack metadata + authoring contributions.
 *
 * The pack metadata is the framework-composition entry point: control-stack
 * assembly reads `types.codecTypes.codecInstances` to populate the codec
 * lookup, `types.codecTypes.import` / `typeImports` to thread the type-side
 * imports into emitted `contract.d.ts`, and `authoring.type` to expose the
 * `pgvector.Vector(N)` PSL type constructor at PSL-authoring time.
 *
 * `codecInstances` carries `pgVectorRepresentativeCodec`, which is sourced
 * from the same `vectorCodecForLength` factory the runtime uses — single
 * source of truth for the codec, no parallel `codec(...)` declaration.
 */

import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import type { CodecTypes } from '../types/codec-types';
import { pgVectorRepresentativeCodec, VECTOR_CODEC_ID, VECTOR_MAX_DIM } from './vector-codec';

/**
 * PSL authoring type constructor for `pgvector.Vector(N)`. Read by the PSL
 * parser to validate `pgvector.Vector(1536)` calls and to canonicalize the
 * resulting type into `storage.types`.
 */
export const pgvectorAuthoringTypes = {
  pgvector: {
    Vector: {
      kind: 'typeConstructor',
      args: [
        { kind: 'number', name: 'length', integer: true, minimum: 1, maximum: VECTOR_MAX_DIM },
      ],
      output: {
        codecId: VECTOR_CODEC_ID,
        nativeType: 'vector',
        typeParams: {
          length: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const pgvectorPackMetaBase = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'pgvector.cosine': true,
    },
  },
  authoring: {
    type: pgvectorAuthoringTypes,
  },
  types: {
    codecTypes: {
      codecInstances: [pgVectorRepresentativeCodec],
      import: {
        package: '@prisma-next/extension-pgvector/codec-types',
        named: 'CodecTypes',
        alias: 'PgVectorTypes',
      },
      typeImports: [
        {
          package: '@prisma-next/extension-pgvector/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
    operationTypes: {
      import: {
        package: '@prisma-next/extension-pgvector/operation-types',
        named: 'OperationTypes',
        alias: 'PgVectorOperationTypes',
      },
    },
    queryOperationTypes: {
      import: {
        package: '@prisma-next/extension-pgvector/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PgVectorQueryOperationTypes',
      },
    },
    storage: [
      { typeId: VECTOR_CODEC_ID, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' },
    ],
  },
} as const;

/**
 * Public pack metadata. The phantom `__codecTypes` field threads the codec-
 * types map's literal type into the pack ref so contract-builder generics
 * can pick it up; it is never accessed at runtime.
 */
export const pgvectorPackMeta: typeof pgvectorPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = pgvectorPackMetaBase;
