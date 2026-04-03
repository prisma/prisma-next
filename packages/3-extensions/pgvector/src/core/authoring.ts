import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import { VECTOR_MAX_DIM } from './constants';

export const pgvectorAuthoringTypes = {
  pgvector: {
    vector: {
      kind: 'typeConstructor',
      args: [{ kind: 'number', integer: true, minimum: 1, maximum: VECTOR_MAX_DIM }],
      output: {
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: {
          length: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
