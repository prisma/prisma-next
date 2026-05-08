import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';

export const postgisAuthoringTypes = {
  postgis: {
    Geometry: {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'srid', integer: true, minimum: 0 }],
      output: {
        codecId: 'pg/geometry@1',
        nativeType: 'geometry',
        typeParams: {
          srid: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
