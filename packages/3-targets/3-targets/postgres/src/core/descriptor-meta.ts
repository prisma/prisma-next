import { postgresAuthoringFieldPresets, postgresAuthoringTypes } from './authoring';

export const postgresTargetDescriptorMeta = {
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
