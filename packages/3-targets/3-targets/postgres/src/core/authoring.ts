import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';

export const postgresAuthoringTypes = {
  enum: {
    kind: 'typeConstructor',
    args: [{ kind: 'string' }, { kind: 'stringArray' }],
    output: {
      codecId: 'pg/enum@1',
      nativeType: { kind: 'arg', index: 0 },
      typeParams: {
        values: { kind: 'arg', index: 1 },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
