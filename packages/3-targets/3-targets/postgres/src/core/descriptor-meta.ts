import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { postgresAuthoringFieldPresets, postgresAuthoringTypes } from './authoring';

const postgresTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  authoring: {
    type: postgresAuthoringTypes,
    field: postgresAuthoringFieldPresets,
  },
} as const;

export const postgresTargetDescriptorMeta: typeof postgresTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = postgresTargetDescriptorMetaBase;
