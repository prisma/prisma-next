import { temporalAuthoringPresets, temporalCodecPreset } from '@prisma-next/family-sql/control';
import type { AuthoringFieldNamespace } from '@prisma-next/framework-components/authoring';

export const sqliteAuthoringFieldPresets = {
  temporal: {
    .../* @__PURE__ */ temporalAuthoringPresets({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
    }),
    datetime: /* @__PURE__ */ temporalCodecPreset({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
    }),
  },
} as const satisfies AuthoringFieldNamespace;
