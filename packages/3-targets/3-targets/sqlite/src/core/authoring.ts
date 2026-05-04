import type { AuthoringFieldNamespace } from '@prisma-next/framework-components/authoring';

export const sqliteAuthoringFieldPresets = {
  dateTime: {
    kind: 'fieldPreset',
    output: {
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
    },
  },
  createdAt: {
    kind: 'fieldPreset',
    output: {
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      default: {
        kind: 'function',
        expression: 'now()',
      },
    },
  },
  updatedAt: {
    kind: 'fieldPreset',
    output: {
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      executionDefaults: {
        onCreate: {
          kind: 'generator',
          id: 'timestampNow',
        },
        onUpdate: {
          kind: 'generator',
          id: 'timestampNow',
        },
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;
