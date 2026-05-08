import { sqliteAuthoringFieldPresets } from './authoring';
import type { CodecTypes } from './codecs';

const sqliteTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
  authoring: {
    field: sqliteAuthoringFieldPresets,
  },
} as const;

export const sqliteTargetDescriptorMeta: typeof sqliteTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = sqliteTargetDescriptorMetaBase;
