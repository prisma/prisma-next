import type { CodecTypes } from '../exports/codec-types';
import {
  postgresAuthoringEntities,
  postgresAuthoringFieldPresets,
  postgresAuthoringTypes,
} from './authoring';

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
    entities: postgresAuthoringEntities,
  },
} as const;

export const postgresTargetDescriptorMeta: typeof postgresTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = postgresTargetDescriptorMetaBase;
