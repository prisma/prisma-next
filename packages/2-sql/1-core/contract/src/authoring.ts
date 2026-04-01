import type { AuthoringFieldNamespace } from '@prisma-next/contract/framework-components';

const CHARACTER_CODEC_ID = 'sql/char@1';
const CHARACTER_NATIVE_TYPE = 'character';

const nanoidOptionsArgument = {
  kind: 'object',
  optional: true,
  properties: {
    size: {
      kind: 'number',
      optional: true,
      integer: true,
      minimum: 2,
      maximum: 255,
    },
  },
} as const;

export const portableSqlAuthoringFieldPresets = {
  text: {
    kind: 'fieldPreset',
    output: {
      codecId: 'sql/text@1',
      nativeType: 'text',
    },
  },
  timestamp: {
    kind: 'fieldPreset',
    output: {
      codecId: 'sql/timestamp@1',
      nativeType: 'timestamp',
    },
  },
  createdAt: {
    kind: 'fieldPreset',
    output: {
      codecId: 'sql/timestamp@1',
      nativeType: 'timestamp',
      default: {
        kind: 'function',
        expression: 'CURRENT_TIMESTAMP',
      },
    },
  },
  uuid: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      nativeType: CHARACTER_NATIVE_TYPE,
      typeParams: {
        length: 36,
      },
    },
  },
  ulid: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      nativeType: CHARACTER_NATIVE_TYPE,
      typeParams: {
        length: 26,
      },
    },
  },
  nanoid: {
    kind: 'fieldPreset',
    args: [nanoidOptionsArgument],
    output: {
      codecId: CHARACTER_CODEC_ID,
      nativeType: CHARACTER_NATIVE_TYPE,
      typeParams: {
        length: {
          kind: 'arg',
          index: 0,
          path: ['size'],
          default: 21,
        },
      },
    },
  },
  cuid2: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      nativeType: CHARACTER_NATIVE_TYPE,
      typeParams: {
        length: 24,
      },
    },
  },
  ksuid: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      nativeType: CHARACTER_NATIVE_TYPE,
      typeParams: {
        length: 27,
      },
    },
  },
  id: {
    uuidv4: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        nativeType: CHARACTER_NATIVE_TYPE,
        typeParams: {
          length: 36,
        },
        executionDefault: {
          kind: 'generator',
          id: 'uuidv4',
        },
        id: true,
      },
    },
    uuidv7: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        nativeType: CHARACTER_NATIVE_TYPE,
        typeParams: {
          length: 36,
        },
        executionDefault: {
          kind: 'generator',
          id: 'uuidv7',
        },
        id: true,
      },
    },
    ulid: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        nativeType: CHARACTER_NATIVE_TYPE,
        typeParams: {
          length: 26,
        },
        executionDefault: {
          kind: 'generator',
          id: 'ulid',
        },
        id: true,
      },
    },
    nanoid: {
      kind: 'fieldPreset',
      args: [nanoidOptionsArgument],
      output: {
        codecId: CHARACTER_CODEC_ID,
        nativeType: CHARACTER_NATIVE_TYPE,
        typeParams: {
          length: {
            kind: 'arg',
            index: 0,
            path: ['size'],
            default: 21,
          },
        },
        executionDefault: {
          kind: 'generator',
          id: 'nanoid',
          params: {
            size: {
              kind: 'arg',
              index: 0,
              path: ['size'],
            },
          },
        },
        id: true,
      },
    },
    cuid2: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        nativeType: CHARACTER_NATIVE_TYPE,
        typeParams: {
          length: 24,
        },
        executionDefault: {
          kind: 'generator',
          id: 'cuid2',
        },
        id: true,
      },
    },
    ksuid: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        nativeType: CHARACTER_NATIVE_TYPE,
        typeParams: {
          length: 27,
        },
        executionDefault: {
          kind: 'generator',
          id: 'ksuid',
        },
        id: true,
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;
