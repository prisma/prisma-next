import type { CodecTypes } from '../exports/codec-types';
import { sqliteAuthoringFieldPresets } from './authoring';
import { sqliteTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

const sqliteTargetDescriptorMetaBase = {
  ...sqliteTargetDescriptorMetaRuntime,
  authoring: {
    field: sqliteAuthoringFieldPresets,
  },
} as const;

export const sqliteTargetDescriptorMeta: typeof sqliteTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = sqliteTargetDescriptorMetaBase;
